#!/usr/bin/env bun
/**
 * Reescribe el protocolo `"workspace:"` en `dependencies`/
 * `peerDependencies`/`optionalDependencies` de cada `packages/*\/package.json`
 * a la versión REAL del paquete referenciado:
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
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(RAIZ, "packages");

/** Los tres campos de `package.json` donde puede aparecer un especificador `"workspace:"`. */
export const CAMPOS_CON_DEPENDENCIAS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

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
 * Reescribe, IN PLACE, cada especificador `"workspace:"` de
 * `dependencies`/`peerDependencies`/`optionalDependencies` del objeto `pkg`
 * (el JSON ya parseado de un `package.json`), usando `versiones`. Devuelve
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

if (esInvocacionDirecta()) {
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
}
