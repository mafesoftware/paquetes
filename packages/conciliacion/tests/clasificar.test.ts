import { describe, expect, it } from "vitest";
import { clasificarSoloExtracto } from "../src/clasificar.js";

/** Reglas por defecto. */
describe("clasificarSoloExtracto — reglas por defecto", () => {
  it("'IMP.LEY 25413 DEB' → impuesto_debitos_creditos", () => {
    expect(clasificarSoloExtracto("IMP.LEY 25413 DEB")).toBe("impuesto_debitos_creditos");
  });

  it("'IMP.LEY 25413 CRED' → impuesto_debitos_creditos", () => {
    expect(clasificarSoloExtracto("IMP.LEY 25413 CRED")).toBe("impuesto_debitos_creditos");
  });

  it("'COMISION MANTENIMIENTO CTA' → comision_bancaria", () => {
    expect(clasificarSoloExtracto("COMISION MANTENIMIENTO CTA")).toBe("comision_bancaria");
  });

  it("'INTERESES ACREDITADOS' → interes_ganado", () => {
    expect(clasificarSoloExtracto("INTERESES ACREDITADOS")).toBe("interes_ganado");
  });

  it("'IVA BASICO 21%' → iva_gastos_bancarios", () => {
    expect(clasificarSoloExtracto("IVA BASICO 21%")).toBe("iva_gastos_bancarios");
  });

  it("'IMPUESTO DE SELLOS' → impuesto_sellos", () => {
    expect(clasificarSoloExtracto("IMPUESTO DE SELLOS")).toBe("impuesto_sellos");
  });

  it("descripción sin patrón conocido → null", () => {
    expect(clasificarSoloExtracto("TRANSFERENCIA RECIBIDA")).toBeNull();
  });

  it("acepta reglas propias en vez de las por defecto", () => {
    const reglas = [{ patron: /CUSTOM/i, tipoOperacion: "propio" }];
    expect(clasificarSoloExtracto("MOVIMIENTO CUSTOM", reglas)).toBe("propio");
    expect(clasificarSoloExtracto("COMISION MANTENIMIENTO", reglas)).toBeNull();
  });
});
