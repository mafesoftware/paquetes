import { describe, expect, it } from "vitest";
import { ErrorLimiteIntentos } from "../src/errores.js";

describe("ErrorLimiteIntentos", () => {
  it("es un Error real, con name/codigo/message", () => {
    const error = new ErrorLimiteIntentos("opciones_invalidas", "mensaje de prueba");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ErrorLimiteIntentos");
    expect(error.codigo).toBe("opciones_invalidas");
    expect(error.message).toBe("mensaje de prueba");
  });
});
