import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guardia de la regla de spec 02 §6: "Un día de calendario se lee en UTC; un
 * instante en la zona del tenant. Prohibido `setHours`/`setUTCHours` en
 * `src/`". Se agrega `getHours` también: leer la hora local de un `Date` es
 * el mismo error que escribirla — ambos dependen de la zona del proceso que
 * corre el código, no de la del tenant.
 *
 * Nada en `src/` la usa hoy (ver `interno.ts`, `index.ts`: solo
 * `setUTCDate`/`getUTCDate`/`getUTCDay`, que son UTC puro y no matchean). Es
 * un test de regresión: si alguien agrega una función que las usa, este test
 * la para antes de que llegue a un review.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const PROHIBIDOS = ["setHours(", "setUTCHours(", "getHours("];

function archivosFuente(dir: string): string[] {
  const resultado: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) {
      resultado.push(...archivosFuente(ruta));
    } else if (nombre.endsWith(".ts")) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

describe("src/ nunca usa metodos de hora local de Date", () => {
  it("ningun archivo de src/ contiene setHours(/setUTCHours(/getHours(", () => {
    const fallas: string[] = [];
    for (const archivo of archivosFuente(SRC)) {
      const contenido = readFileSync(archivo, "utf8");
      for (const prohibido of PROHIBIDOS) {
        if (contenido.includes(prohibido)) {
          fallas.push(`${archivo.replace(SRC, "src")}: usa "${prohibido}"`);
        }
      }
    }
    expect(fallas).toEqual([]);
  });
});
