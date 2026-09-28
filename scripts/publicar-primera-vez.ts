#!/usr/bin/env bun
/**
 * Primera publicación a npm de este monorepo. Corrido por el USUARIO desde
 * su propia terminal, con su propio login de npm (`mafe-software`) — nunca
 * en CI (ver README § "Publicar", secciones 1-3: de acá en más, cada PR
 * mergeado a `main` publica solo con `release.yml`).
 *
 * Qué hace, en orden:
 *
 * 1. Rechaza correr si `npm whoami` no devuelve exactamente "mafe-software"
 *    (imprime cómo hacer `npm login`).
 * 2. `bun run build`.
 * 3. Para cada `packages/*` no privado, consulta el registro de npm
 *    (`https://registry.npmjs.org/@mafesoftware%2f<nombre>`) y arma el plan
 *    con los paquetes cuya versión ACTUAL todavía no está publicada.
 *    Imprime el plan (`nombre@version`) y pide confirmación (y/N), salvo
 *    `--si`.
 * 4. Reescribe `"workspace:"` a versiones reales usando DIRECTAMENTE la
 *    función pura de `scripts/reescribir-workspace.ts` (no el guard de CI
 *    de su CLI: acá se llama la función, nunca se invoca ese script como
 *    subproceso) — sobre una base de BACKUP: antes de reescribir nada,
 *    guarda en memoria el contenido original de cada `packages/*\/package.json`.
 *    Publica cada paquete del plan, EN ORDEN DE DEPENDENCIAS (topológico:
 *    un paquete que depende de otro DEL PLAN se publica después), con
 *    `npm publish --access public --provenance=false` desde el directorio
 *    de cada paquete. SIEMPRE restaura los `package.json` originales al
 *    final (try/finally), incluso si un `npm publish` falla a mitad de
 *    camino.
 * 5. Si un paquete falla, corta ahí: reporta qué se publicó y qué no.
 *    Volver a correr el script es seguro — los que ya están publicados se
 *    saltean (paso 3 los saca del plan).
 *
 * `--dry-run`: pasa `--dry-run` a `npm publish` (no publica de verdad).
 * `--si`: no pide confirmación.
 *
 * Sin `--provenance` (no hay Trusted Publisher configurado todavía — recién
 * se puede configurar DESPUÉS de que el paquete exista, ver README).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { CAMPOS_CON_DEPENDENCIAS, reescribirTodos } from "./reescribir-workspace.js";

/**
 * `Bun.spawn` no tiene tipos propios en este monorepo (no depende de
 * `bun-types`/`@types/bun` — el resto del tooling usa `node:child_process`
 * a propósito, ver `reescribir-workspace.ts`/`lint-paquetes.ts`). Acá sí
 * hace falta `Bun.spawn` (pedido explícitamente: sin bloquear el hilo
 * principal esperando `npm whoami`/`npm publish` con `stdio: 'inherit'`
 * en un subproceso interactivo sería más incómodo con `spawnSync`). Esta
 * es la forma MÍNIMA del subconjunto de la API real que se usa acá, para
 * no arrastrar `bun-types` (que traería sus propios `lib`/globals) a un
 * tsconfig compartido por todo el monorepo.
 */
declare const Bun: {
  spawn(
    cmd: string[],
    opciones?: {
      cwd?: string;
      stdout?: "inherit" | "pipe" | "ignore";
      stderr?: "inherit" | "pipe" | "ignore";
    },
  ): {
    stdout: unknown;
    exited: Promise<number>;
  };
};

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(RAIZ, "packages");
const PREFIJO_SCOPE = "@mafesoftware/";

export interface InfoPaquete {
  /** Nombre sin scope, ej. "tenant". */
  nombre: string;
  /** Nombre completo con scope, ej. "@mafesoftware/tenant". */
  nombreNpm: string;
  /** Ruta absoluta a `packages/<nombre>`. */
  dir: string;
  /** Versión actual en su `package.json`. */
  version: string;
  /** Nombres (sin scope) de otros paquetes de ESTE monorepo de los que depende (en cualquiera de `CAMPOS_CON_DEPENDENCIAS`). */
  dependenciasInternas: string[];
  privado: boolean;
}

/** Lee `packages/<nombre>/package.json` de cada paquete bajo `dirPackages` y arma su `InfoPaquete`. */
export function leerInfoPaquetes(dirPackages: string): InfoPaquete[] {
  if (!existsSync(dirPackages)) return [];
  const resultado: InfoPaquete[] = [];
  for (const nombre of readdirSync(dirPackages)) {
    const dir = join(dirPackages, nombre);
    if (!statSync(dir).isDirectory()) continue;
    const rutaPkg = join(dir, "package.json");
    if (!existsSync(rutaPkg)) continue;
    const pkg = JSON.parse(readFileSync(rutaPkg, "utf8")) as Record<string, unknown>;
    const nombreNpm = pkg.name as string | undefined;
    const version = pkg.version as string | undefined;
    if (!nombreNpm || !version) continue;

    const dependenciasInternas = new Set<string>();
    for (const campo of CAMPOS_CON_DEPENDENCIAS) {
      const deps = pkg[campo] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        if (dep.startsWith(PREFIJO_SCOPE)) dependenciasInternas.add(dep.slice(PREFIJO_SCOPE.length));
      }
    }

    resultado.push({
      nombre,
      nombreNpm,
      dir,
      version,
      dependenciasInternas: [...dependenciasInternas],
      privado: pkg.private === true,
    });
  }
  return resultado;
}

/**
 * Ordena `infos` topológicamente por `dependenciasInternas`: un paquete
 * aparece DESPUÉS de cualquier otro del mismo `infos` del que dependa. Solo
 * cuenta como arista una dependencia que está DENTRO de `infos` — una
 * dependencia que quedó afuera (por ejemplo, porque ya está publicada y no
 * entró al plan) se asume ya resuelta, no bloquea el orden. Orden estable
 * (respeta el orden de entrada entre paquetes sin relación de dependencia).
 * Tira si hay un ciclo (no debería pasar: el diseño de este monorepo es un
 * DAG, pero mejor fallar ruidosamente que colgarse).
 */
export function ordenTopologico(infos: InfoPaquete[]): InfoPaquete[] {
  const porNombre = new Map(infos.map((info) => [info.nombre, info]));
  const gradoEntrada = new Map<string, number>(infos.map((info) => [info.nombre, 0]));
  const dependientesDe = new Map<string, string[]>();

  for (const info of infos) {
    for (const dependencia of info.dependenciasInternas) {
      if (!porNombre.has(dependencia)) continue;
      gradoEntrada.set(info.nombre, (gradoEntrada.get(info.nombre) ?? 0) + 1);
      const lista = dependientesDe.get(dependencia) ?? [];
      lista.push(info.nombre);
      dependientesDe.set(dependencia, lista);
    }
  }

  const cola = infos.filter((info) => (gradoEntrada.get(info.nombre) ?? 0) === 0).map((info) => info.nombre);
  const resultado: InfoPaquete[] = [];
  const visitado = new Set<string>();

  while (cola.length > 0) {
    const nombre = cola.shift() as string;
    if (visitado.has(nombre)) continue;
    visitado.add(nombre);
    resultado.push(porNombre.get(nombre) as InfoPaquete);
    for (const dependiente of dependientesDe.get(nombre) ?? []) {
      const nuevoGrado = (gradoEntrada.get(dependiente) ?? 0) - 1;
      gradoEntrada.set(dependiente, nuevoGrado);
      if (nuevoGrado === 0) cola.push(dependiente);
    }
  }

  if (resultado.length !== infos.length) {
    const faltantes = infos.filter((info) => !visitado.has(info.nombre)).map((info) => info.nombre);
    throw new Error(`Ciclo de dependencias internas entre: ${faltantes.join(", ")}`);
  }

  return resultado;
}

/**
 * Versiones ya publicadas de `nombreNpm` según el registro de npm. `404`
 * (el paquete todavía no existe en el registro — el caso normal, primera
 * publicación) se trata como "ningún version publicada", no como error.
 */
export async function versionesPublicadas(
  nombreNpm: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Set<string>> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(nombreNpm)}`;
  const respuesta = await fetchImpl(url);
  if (respuesta.status === 404) return new Set();
  if (!respuesta.ok) {
    throw new Error(`No se pudo consultar el registro de npm para ${nombreNpm}: HTTP ${respuesta.status}`);
  }
  const cuerpo = (await respuesta.json()) as { versions?: Record<string, unknown> };
  return new Set(Object.keys(cuerpo.versions ?? {}));
}

/**
 * El plan de publicación: los paquetes no privados cuya versión ACTUAL
 * todavía no está publicada, en orden topológico. `obtenerVersiones` es
 * inyectable (test: registro falso; real: `versionesPublicadas`).
 */
export async function calcularPlan(
  infos: InfoPaquete[],
  obtenerVersiones: (nombreNpm: string) => Promise<Set<string>> = (nombreNpm) => versionesPublicadas(nombreNpm),
): Promise<InfoPaquete[]> {
  const pendientes: InfoPaquete[] = [];
  for (const info of infos) {
    if (info.privado) continue;
    const publicadas = await obtenerVersiones(info.nombreNpm);
    if (!publicadas.has(info.version)) pendientes.push(info);
  }
  return ordenTopologico(pendientes);
}

export interface ResultadoPublicar {
  ok: boolean;
  mensaje?: string;
}

export interface ResultadoPublicarPlan {
  /** `"nombre@version"`, en el orden en que se publicaron. */
  publicados: string[];
  /** Nombres (sin scope) que NO llegaron a publicarse (por el error, o por no haber llegado a intentarlo). */
  restantes: string[];
  error?: string;
}

export interface OpcionesPublicarPlan {
  dirPackages: string;
  publicar: (info: InfoPaquete) => Promise<ResultadoPublicar>;
  /** Por defecto, `reescribirTodos` (la función pura real). Inyectable para tests. */
  reescribir?: (dirPackages: string) => void;
  leerArchivo?: (ruta: string) => string;
  escribirArchivo?: (ruta: string, contenido: string) => void;
}

/**
 * Publica `plan` (YA en orden topológico — ver `ordenTopologico`/`calcularPlan`)
 * uno por uno. Antes de reescribir nada, hace un BACKUP en memoria de cada
 * `packages/*\/package.json` bajo `dirPackages` (no solo los del plan:
 * `reescribirTodos` puede tocar cualquiera con una dependencia
 * `"workspace:"`); reescribe con la función pura de `reescribir-workspace.ts`
 * (nunca el CLI); publica en orden; y SIEMPRE restaura los backups al final
 * (`finally`), incluso si `publicar` falla o tira. Corta en el primer
 * fallo — el resto queda en `restantes`.
 */
export async function publicarPlan(plan: InfoPaquete[], opciones: OpcionesPublicarPlan): Promise<ResultadoPublicarPlan> {
  const leer = opciones.leerArchivo ?? ((ruta: string) => readFileSync(ruta, "utf8"));
  const escribir = opciones.escribirArchivo ?? ((ruta: string, contenido: string) => writeFileSync(ruta, contenido));
  const reescribir = opciones.reescribir ?? reescribirTodos;

  const backups = new Map<string, string>();
  if (existsSync(opciones.dirPackages)) {
    for (const nombre of readdirSync(opciones.dirPackages)) {
      const ruta = join(opciones.dirPackages, nombre, "package.json");
      if (existsSync(ruta)) backups.set(ruta, leer(ruta));
    }
  }

  const publicados: string[] = [];
  let error: string | undefined;

  try {
    reescribir(opciones.dirPackages);

    for (let indice = 0; indice < plan.length; indice++) {
      const info = plan[indice] as InfoPaquete;
      let resultado: ResultadoPublicar;
      try {
        resultado = await opciones.publicar(info);
      } catch (excepcion) {
        resultado = { ok: false, mensaje: excepcion instanceof Error ? excepcion.message : String(excepcion) };
      }

      if (!resultado.ok) {
        error = resultado.mensaje ?? `falló "npm publish" para ${info.nombreNpm}@${info.version}`;
        return { publicados, restantes: plan.slice(indice).map((p) => p.nombre), error };
      }

      publicados.push(`${info.nombreNpm}@${info.version}`);
    }

    return { publicados, restantes: [] };
  } finally {
    for (const [ruta, contenido] of backups) {
      escribir(ruta, contenido);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Junta un stream (WHATWG `ReadableStream<Uint8Array>`, lo que devuelve `Bun.spawn` con `stdout: "pipe"`) en un string. */
async function leerStreamComoTexto(stream: unknown): Promise<string> {
  const decoder = new TextDecoder();
  let texto = "";
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    texto += decoder.decode(chunk as Uint8Array, { stream: true });
  }
  texto += decoder.decode();
  return texto;
}

async function npmWhoami(): Promise<string | null> {
  const proceso = Bun.spawn(["npm", "whoami"], { stdout: "pipe", stderr: "pipe" });
  const salida = await leerStreamComoTexto(proceso.stdout);
  const codigo = await proceso.exited;
  if (codigo !== 0) return null;
  return salida.trim();
}

async function leerRespuestaSiNo(pregunta: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const respuesta = await rl.question(pregunta);
    return respuesta.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

/** `npm publish` real, vía `Bun.spawn` (pedido explícitamente — ver el comentario de arriba sobre por qué acá y no `spawnSync`). */
async function publicarConNpm(info: InfoPaquete, dryRun: boolean): Promise<ResultadoPublicar> {
  const args = ["publish", "--access", "public", "--provenance=false"];
  if (dryRun) args.push("--dry-run");
  console.log(`\n$ npm ${args.join(" ")}   (en packages/${info.nombre})`);
  const proceso = Bun.spawn(["npm", ...args], { cwd: info.dir, stdout: "inherit", stderr: "inherit" });
  const codigo = await proceso.exited;
  if (codigo !== 0) {
    return { ok: false, mensaje: `"npm publish" salió con código ${codigo} para ${info.nombreNpm}@${info.version}` };
  }
  return { ok: true };
}

function imprimirAyuda(): void {
  console.log(`Uso: bun scripts/publicar-primera-vez.ts [--dry-run] [--si]

Primera publicación a npm de los paquetes de este monorepo (@mafesoftware/*)
que todavía no están en el registro. Correr desde tu propia terminal, ya
logueado en npm como "mafe-software":

  npm whoami   # tiene que decir "mafe-software"; si no, npm login

Qué hace:
  1. Rechaza correr si "npm whoami" no es exactamente "mafe-software".
  2. bun run build
  3. Para cada packages/* no privado, consulta
     https://registry.npmjs.org/@mafesoftware%2f<nombre> y arma el plan con
     los paquetes cuya versión actual TODAVÍA no está publicada. Imprime el
     plan (nombre@version) y pide confirmación (y/N), salvo --si.
  4. Reescribe "workspace:" a versiones reales (misma función pura que usa
     "bun run release"), sobre una base de backup; publica cada paquete del
     plan EN ORDEN DE DEPENDENCIAS con
     "npm publish --access public --provenance=false"; SIEMPRE restaura los
     package.json originales al final, incluso si algo falla a mitad de
     camino.
  5. Si un paquete falla, corta ahí y reporta qué se publicó y qué no.
     Volver a correrlo es seguro: lo ya publicado se saltea.

Opciones:
  --dry-run   Pasa --dry-run a "npm publish" (no publica de verdad).
  --si        No pide confirmación antes de publicar.
  --help      Muestra esta ayuda.
`);
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes("--help") || argumentos.includes("-h")) {
    imprimirAyuda();
    return;
  }

  const dryRun = argumentos.includes("--dry-run");
  const si = argumentos.includes("--si");

  const usuario = await npmWhoami();
  if (usuario !== "mafe-software") {
    console.error(
      `npm whoami devolvió "${usuario ?? "(nada — no hay sesión de npm)"}"; se esperaba "mafe-software".\n\n` +
        "Iniciá sesión con esa cuenta primero:\n  npm login\n",
    );
    process.exit(1);
  }

  console.log("bun run build...");
  const build = spawnSync("bun", ["run", "build"], { cwd: RAIZ, stdio: "inherit" });
  if (build.status !== 0) {
    console.error('"bun run build" falló; abortando antes de tocar el registro.');
    process.exit(1);
  }

  const infos = leerInfoPaquetes(PACKAGES);
  console.log("\nConsultando el registro de npm para cada paquete...");
  const plan = await calcularPlan(infos);

  if (plan.length === 0) {
    console.log("Nada para publicar: la versión actual de todos los paquetes ya está en el registro.");
    return;
  }

  console.log("\nPlan de publicación (orden de dependencias):");
  for (const info of plan) console.log(`  ${info.nombreNpm}@${info.version}`);

  if (!si) {
    const confirmado = await leerRespuestaSiNo(`\n¿Publicar ${plan.length} paquete(s)? (y/N) `);
    if (!confirmado) {
      console.log("Cancelado.");
      return;
    }
  }

  const resultado = await publicarPlan(plan, {
    dirPackages: PACKAGES,
    publicar: (info) => publicarConNpm(info, dryRun),
  });

  if (resultado.publicados.length > 0) {
    console.log("\nPublicados:");
    for (const p of resultado.publicados) console.log(`  ${p}`);
  }
  if (resultado.restantes.length > 0) {
    console.log("\nNO publicados:");
    for (const nombre of resultado.restantes) console.log(`  ${nombre}`);
  }

  if (resultado.error) {
    console.error(`\nError: ${resultado.error}`);
    console.error("Podés volver a correr el script: lo ya publicado se saltea.");
    process.exit(1);
  }
}

function esInvocacionDirecta(): boolean {
  const argvPrincipal = process.argv[1];
  return Boolean(argvPrincipal) && import.meta.url === new URL(argvPrincipal as string, "file://").href;
}

if (esInvocacionDirecta()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
