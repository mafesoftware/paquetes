import { describe, expect, it } from "vitest";
import { accionAlPublicarDefinitivo, type ModalidadAjuste } from "../src/modalidad.js";

describe("accionAlPublicarDefinitivo", () => {
  it("cuota NO cobrada: siempre se recalcula, sin importar la modalidad", () => {
    for (const modalidad of ["disponible", "provisorio", "definitivo"] as ModalidadAjuste[]) {
      expect(accionAlPublicarDefinitivo(modalidad, false)).toBe("recalcular");
    }
  });

  it("cuota cobrada, disponible: nada (queda firme)", () => {
    expect(accionAlPublicarDefinitivo("disponible", true)).toBe("nada");
  });

  it("cuota cobrada, provisorio: diferencia a la próxima cuota", () => {
    expect(accionAlPublicarDefinitivo("provisorio", true)).toBe("diferencia_proxima_cuota");
  });

  it("cuota cobrada, definitivo: documento de ajuste", () => {
    expect(accionAlPublicarDefinitivo("definitivo", true)).toBe("documento_ajuste");
  });
});
