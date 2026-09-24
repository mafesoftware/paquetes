import { describe, expect, it } from "vitest";
import { CONDICIONES_IVA } from "../src/condiciones-iva.ts";

describe("CONDICIONES_IVA", () => {
  it("incluye las cinco condiciones esperadas, sin repetidos", () => {
    const codigos = CONDICIONES_IVA.map((c) => c.codigo);
    expect(codigos).toEqual([
      "responsable_inscripto",
      "monotributo",
      "exento",
      "consumidor_final",
      "no_alcanzado",
    ]);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("cada condición tiene un nombre no vacío", () => {
    for (const c of CONDICIONES_IVA) {
      expect(c.nombre.length).toBeGreaterThan(0);
    }
  });

  it("los cinco idArca coinciden con la tabla FEParamGetCondicionIvaReceptor de WSFEv1", () => {
    // 1 Responsable Inscripto, 4 Exento, 5 Consumidor Final, 6 Monotributo,
    // 15 No Alcanzado — tabla del web service de factura electrónica de
    // ARCA (WSFEv1, método FEParamGetCondicionIvaReceptor).
    const idsPorCodigo: Record<string, number> = {
      responsable_inscripto: 1,
      exento: 4,
      consumidor_final: 5,
      monotributo: 6,
      no_alcanzado: 15,
    };
    for (const c of CONDICIONES_IVA) {
      expect(c.idArca, `idArca de ${c.codigo}`).toBe(idsPorCodigo[c.codigo]);
    }
  });
});
