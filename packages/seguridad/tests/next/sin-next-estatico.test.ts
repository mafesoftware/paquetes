import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Fix round 1 (M10): importar `@mafesoftware/seguridad/next` no puede cargar
 * `next` de forma EAGER. `autorizarCron`, `cabecerasSeguridad`,
 * `politicaCsp`, `generarNonce` e `ipDe` no necesitan Next para nada, y
 * `next` es un peerDependency OPCIONAL de este subpath — con `next` sin
 * instalar, esas funciones tienen que poder importarse y usarse igual.
 *
 * Es un test de CÓDIGO FUENTE, no de comportamiento en runtime: instalar (o
 * desinstalar) `next` en este monorepo para simular "no está" ensuciaría el
 * resto de la suite, así que en cambio se verifica ESTÁTICAMENTE que ningún
 * archivo de `src/next/` tiene un `import ... from "next..."` de nivel de
 * módulo — el único lugar permitido para tocar `next` es el
 * `await import("next/navigation.js")` DINÁMICO de `guard.ts`, adentro del
 * `catch` (ver su comentario "M10").
 */
const DIR_NEXT = fileURLToPath(new URL("../../src/next", import.meta.url));

// Un import estático de nivel de módulo: "import ... from '...'" o
// "export ... from '...'", en cualquiera de sus formas, al INICIO de línea
// (ignorando espacios) — no dentro de un `await import(...)` dinámico, que
// es una expresión, no una declaración, y nunca arranca la línea así.
const IMPORT_ESTATICO_DE_NEXT = /^\s*(?:import|export)\b[^;]*from\s+["']next(?:\/|["'])/m;

function archivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return archivosTs(ruta);
    return entrada.name.endsWith(".ts") ? [ruta] : [];
  });
}

describe("src/next/ no importa 'next' de forma estática", () => {
  const archivos = archivosTs(DIR_NEXT);

  it("hay archivos .ts para revisar (si esto falla, el test no está mirando nada)", () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it.each(archivos)("%s no tiene un import/export estático de 'next'", (archivo) => {
    const contenido = readFileSync(archivo, "utf8");
    expect(IMPORT_ESTATICO_DE_NEXT.test(contenido)).toBe(false);
  });

  it("guard.ts SÍ usa next/navigation, pero solo vía import() dinámico", () => {
    const contenido = readFileSync(join(DIR_NEXT, "guard.ts"), "utf8");
    expect(contenido).toContain('await import("next/navigation.js")');
  });
});
