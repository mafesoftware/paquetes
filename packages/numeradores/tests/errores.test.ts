import { describe, expect, it } from "vitest";
import { ErrorNumeradores } from "../src/errores.js";

describe("ErrorNumeradores", () => {
  it("expone el código sin necesidad de parsear el mensaje", () => {
    const error = new ErrorNumeradores("requiere_transaccion", "mensaje de prueba");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ErrorNumeradores");
    expect(error.codigo).toBe("requiere_transaccion");
    expect(error.message).toBe("mensaje de prueba");
  });

  it("admite el código retroceso_no_permitido", () => {
    const error = new ErrorNumeradores("retroceso_no_permitido", "no se puede bajar proximo");
    expect(error.codigo).toBe("retroceso_no_permitido");
  });
});
