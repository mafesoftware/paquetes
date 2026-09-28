import { describe, expect, it } from "vitest";
import { ErrorLimiteIntentos as ErrorLimiteIntentosDelNucleo } from "../../src/errores.js";
import { ErrorLimiteIntentos as ErrorLimiteIntentosDeDrizzle } from "../../src/drizzle/index.js";

/**
 * `ErrorLimiteIntentos` se re-exporta desde `/drizzle` además del núcleo
 * (`@mafesoftware/limite-intentos`) — este test confirma que es la MISMA
 * clase en los dos entry points, no dos independientes: `instanceof` tiene
 * que funcionar cruzado, sin importar desde cuál de los dos se importe.
 */
describe("ErrorLimiteIntentos: mismo instanceof desde el núcleo y desde /drizzle", () => {
  it("es la MISMA clase, no dos independientes", () => {
    expect(ErrorLimiteIntentosDeDrizzle).toBe(ErrorLimiteIntentosDelNucleo);

    const error = new ErrorLimiteIntentosDelNucleo("opciones_invalidas", "x");
    expect(error).toBeInstanceOf(ErrorLimiteIntentosDelNucleo);
    expect(error).toBeInstanceOf(ErrorLimiteIntentosDeDrizzle);
  });
});
