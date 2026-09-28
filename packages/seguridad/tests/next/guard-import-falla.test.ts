import { describe, expect, it, vi } from "vitest";

/**
 * Fix P.C (guard): si el import perezoso de `next/navigation` FALLA (`next`
 * no instalado, o roto de cualquier otra forma), `guard` tiene que rethrow
 * el error ORIGINAL (el que tiró `fn`), no el error del import fallido —
 * antes, el error del import (ej. "Cannot find module") pisaba al original
 * y quien llama nunca veía la causa real del fallo de su propia acción.
 *
 * Se mockea `next/navigation.js` para que EXPLOTE al cargarse, simulando el
 * import roto — el mock vive en un archivo separado de `guard.test.ts`
 * (donde `next/navigation` se importa normal para probar `redirect`/
 * `notFound`) para no pisar esos otros tests.
 */
vi.mock("next/navigation.js", () => {
  throw new Error("next/navigation.js no está disponible (simulado)");
});

describe("guard: el import perezoso de next/navigation falla", () => {
  it("rethrow el error ORIGINAL de fn, no el del import fallido", async () => {
    const { guard } = await import("../../src/next/guard.js");
    const errorOriginal = new TypeError("bug real de la acción");
    const accion = guard(async () => {
      throw errorOriginal;
    });
    await expect(accion()).rejects.toBe(errorOriginal);
  });

  it("también con un ErrorNegocio: el import roto no lo convierte en { ok: false }, propaga el original", async () => {
    const { guard, ErrorNegocio } = await import("../../src/next/guard.js");
    const errorOriginal = new ErrorNegocio("mensaje de negocio");
    const accion = guard(async () => {
      throw errorOriginal;
    });
    await expect(accion()).rejects.toBe(errorOriginal);
  });
});
