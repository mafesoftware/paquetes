#!/usr/bin/env bun
/**
 * Reescribe el protocolo `"workspace:"` en `dependencies`/
 * `devDependencies`/`peerDependencies`/`optionalDependencies` de cada
 * `packages/*\/package.json` a la versión REAL del paquete referenciado:
 *
 * - `"workspace:*"` -> `"x.y.z"` (versión exacta)
 * - `"workspace:^"` -> `"^x.y.z"`
 * - `"workspace:~"` -> `"~x.y.z"`
 *
 * `changeset publish` corre por abajo `npm publish` (vía `bun run release`),
 * que NO entiende el protocolo `"workspace:"` de los gestores de paquetes
 * con workspaces (bun/pnpm/yarn) — lo publicaría LITERAL. Un consumidor real
 * (`npm install @mafesoftware/numeradores`) recibiría un `package.json` con
 * `"@mafesoftware/tenant": "workspace:*"`, que npm no sabe resolver, y la
 * instalación falla (o, peor, según el gestor, se resuelve a nada).
 *
 * Se corre en `bun run release` (script de la raíz), DESPUÉS de `build` y
 * ANTES de `changeset publish` — mutando los `package.json` REALES del
 * checkout. Eso es seguro ahí porque el job "Release" de CI no hace nada
 * más con el código fuente después de publicar (el checkout es descartable).
 * NO se corre nunca en el job "CI" (typecheck/test/build/lint): esos pasos
 * necesitan el `"workspace:*"` real para que bun resuelva las dependencias
 * de workspace en desarrollo.
 *
 * `scripts/lint-paquetes.ts` usa las funciones puras de este archivo para
 * verificar, contra una COPIA descartable de cada paquete, que después de
 * aplicar esta reescritura y empaquetar con `bun pm pack` no queda ningún
 * `"workspace:"` en el `package.json` empaquetado — una regresión acá
 * rompería la publicación sin que ningún test de este archivo lo note
 * (porque solo prueba la función pura, no el empaquetado real).
 *
 * **Invocado directamente (`bun scripts/reescribir-workspace.ts`), se
 * NIEGA a correr fuera de CI** (ver `estaEnCi()`) salvo que se le pase
 * `--forzar`. La reescritura muta los `package.json` REALES del checkout
 * IN PLACE — en el job "Release" de CI eso es descartable (nada corre
 * después que dependa del código fuente sin reescribir), pero en la
 * máquina de un desarrollador que corre `bun run release` a mano, esos
 * archivos quedan reescritos (`"workspace:*"` -> una versión exacta) en el
 * working tree, listos para commitearse sin querer o para confundir al
 * `bun install` siguiente. Si hace falta correrlo local de todos modos
 * (para probar el flujo de release, por ejemplo): `bun
 * scripts/reescribir-workspace.ts --forzar`, y `git checkout --
 * 'packages/*\/package.json'` después para revertir.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(RAIZ, "packages");

/**
 * Los cuatro campos de `package.json` donde puede aparecer un especificador
 * `"workspace:"`. Incluye `devDependencies` a propósito: un consumidor real
 * no las instala (`npm install` de un paquete ajeno ignora sus
 * devDependencies), pero `npm publish` las sube igual, TAL CUAL están en el
 * `package.json` — así que un `"workspace:*"` ahí queda publicado literal
 * lo mismo, aunque nunca rompa una instalación. Se reescribe para que el
 * `package.json` publicado no tenga NINGÚN `"workspace:"` en ningún campo,
 * ni siquiera uno inofensivo, y para que coincida con lo que
 * `scripts/lint-paquetes.ts` verifica (que mira el archivo entero, sin
 * distinguir el campo — ver su comentario).
 */
export const CAMPOS_CON_DEPENDENCIAS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Nombre -> versión de cada `packages/<nombre>/package.json` existente bajo `dirPackages`. */
export function versionesDeWorkspace(dirPackages: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  if (!existsSync(dirPackages)) return resultado;
  for (const nombre of readdirSync(dirPackages)) {
    const dir = join(dirPackages, nombre);
    if (!statSync(dir).isDirectory()) continue;
    const ruta = join(dir, "package.json");
    if (!existsSync(ruta)) continue;
    const pkg = JSON.parse(readFileSync(ruta, "utf8")) as { name?: string; version?: string };
    if (pkg.name && pkg.version) resultado[pkg.name] = pkg.version;
  }
  return resultado;
}

/**
 * Reescribe UN especificador de dependencia. Si no empieza con
 * `"workspace:"`, o si no hay una `version` conocida para reescribirlo
 * contra, lo devuelve tal cual (no rompe con un formato inesperado; en este
 * monorepo siempre debería ser `"workspace:*"`, pero por las dudas soporta
 * `^`/`~` también).
 */
export function reescribirEspecificador(specifier: string, version: string | undefined): string {
  if (!specifier.startsWith("workspace:") || !version) return specifier;
  const protocolo = specifier.slice("workspace:".length);
  if (protocolo === "*" || protocolo === "") return version;
  if (protocolo === "^") return `^${version}`;
  if (protocolo === "~") return `~${version}`;
  return specifier;
}

export interface CambioWorkspace {
  campo: (typeof CAMPOS_CON_DEPENDENCIAS)[number];
  paquete: string;
  de: string;
  a: string;
}

/**
 * Reescribe, IN PLACE, cada especificador `"workspace:"` de los cuatro
 * campos de `CAMPOS_CON_DEPENDENCIAS` del objeto `pkg` (el JSON ya parseado
 * de un `package.json`), usando `versiones`. Devuelve
 * la lista de cambios aplicados — vacía si no había ningún `"workspace:"`
 * o si no se pudo resolver la versión real de algún paquete referenciado.
 */
export function reescribirPackageJson(pkg: Record<string, unknown>, versiones: Record<string, string>): CambioWorkspace[] {
  const cambios: CambioWorkspace[] = [];
  for (const campo of CAMPOS_CON_DEPENDENCIAS) {
    const deps = pkg[campo] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [paquete, specifier] of Object.entries(deps)) {
      if (!specifier.startsWith("workspace:")) continue;
      const nuevo = reescribirEspecificador(specifier, versiones[paquete]);
      if (nuevo === specifier) continue;
      deps[paquete] = nuevo;
      cambios.push({ campo, paquete, de: specifier, a: nuevo });
    }
  }
  return cambios;
}

/**
 * Aplica `reescribirPackageJson` a cada `packages/<nombre>/package.json`
 * bajo `dirPackages`, ESCRIBIENDO el archivo si hubo cambios. Devuelve los
 * cambios por paquete (para el resumen que imprime la CLI, y para que
 * `lint-paquetes.ts`/los tests puedan chequear qué se tocó).
 */
export function reescribirTodos(dirPackages: string): Record<string, CambioWorkspace[]> {
  const versiones = versionesDeWorkspace(dirPackages);
  const resultado: Record<string, CambioWorkspace[]> = {};
  if (!existsSync(dirPackages)) return resultado;
  for (const nombre of readdirSync(dirPackages)) {
    const dir = join(dirPackages, nombre);
    if (!statSync(dir).isDirectory()) continue;
    const ruta = join(dir, "package.json");
    if (!existsSync(ruta)) continue;
    const pkg = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>;
    const cambios = reescribirPackageJson(pkg, versiones);
    if (cambios.length > 0) {
      writeFileSync(ruta, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    resultado[nombre] = cambios;
  }
  return resultado;
}

function esInvocacionDirecta(): boolean {
  const argvPrincipal = process.argv[1];
  return Boolean(argvPrincipal) && import.meta.url === new URL(argvPrincipal as string, "file://").href;
}

/**
 * ¿Estamos en un runner de CI? `CI=true` lo setean prácticamente todos
 * (GitHub Actions, entre otros) — no depende de una variable específica de
 * GitHub por si el día de mañana este repo corre en otro CI.
 */
function estaEnCi(): boolean {
  return process.env.CI === "true";
}

if (esInvocacionDirecta()) {
  const forzado = process.argv.includes("--forzar");
  if (!estaEnCi() && !forzado) {
    console.error(
      'reescribir-workspace.ts: te niego correr fuera de CI sin --forzar.\n\n' +
        'Este script reescribe los package.json REALES del checkout (\"workspace:*\" -> una versión\n' +
        'exacta), IN PLACE. Corriéndolo a mano quedan reescritos en tu working tree — fácil de\n' +
        'commitear sin querer, o de dejar así y que el próximo \"bun install\" se confunda.\n\n' +
        'Si de verdad querés correrlo local (por ejemplo, para probar el flujo de release):\n' +
        '  bun scripts/reescribir-workspace.ts --forzar\n' +
        'y después, para revertir:\n' +
        "  git checkout -- 'packages/*/package.json'\n",
    );
    process.exit(1);
  }

  const cambios = reescribirTodos(PACKAGES);
  let huboCambios = false;
  for (const [nombre, lista] of Object.entries(cambios)) {
    for (const c of lista) {
      huboCambios = true;
      console.log(`${nombre}: ${c.campo}."${c.paquete}" ${c.de} -> ${c.a}`);
    }
  }
  if (!huboCambios) {
    console.log('Sin dependencias "workspace:" que reescribir.');
  }

  if (!estaEnCi()) {
    console.warn(
      '\n⚠️  Corrido con --forzar fuera de CI: los package.json de arriba quedaron reescritos en\n' +
        "tu working tree. Para revertir: git checkout -- 'packages/*/package.json'\n",
    );
  }
}
