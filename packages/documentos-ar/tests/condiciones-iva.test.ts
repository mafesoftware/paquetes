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

  it("solo trae idArca donde está verificado con certeza; no_alcanzado no lo trae", () => {
    const noAlcanzado = CONDICIONES_IVA.find((c) => c.codigo === "no_alcanzado");
    expect(noAlcanzado?.idArca).toBeUndefined();

    const inscripto = CONDICIONES_IVA.find((c) => c.codigo === "responsable_inscripto");
    expect(inscripto?.idArca).toBe(1);
  });
});
