import { describe, expect, it } from "vitest";
import { EstadoCuota, EventoCuota, esEstadoCuota, transicionCuota } from "../src/estados.js";

describe("transicionCuota", () => {
  it("pendiente + liquidar -> liquidada", () => {
    expect(transicionCuota("pendiente", "liquidar")).toBe("liquidada");
  });

  it("pendiente + faltaIndice -> pendiente_indice", () => {
    expect(transicionCuota("pendiente", "faltaIndice")).toBe("pendiente_indice");
  });

  it("pendiente_indice + liquidar -> liquidada", () => {
    expect(transicionCuota("pendiente_indice", "liquidar")).toBe("liquidada");
  });

  it("liquidada + reliquidar -> liquidada (recálculo por definitivo)", () => {
    expect(transicionCuota("liquidada", "reliquidar")).toBe("liquidada");
  });

  it("pendiente_indice + faltaIndice es inválido", () => {
    expect(transicionCuota("pendiente_indice", "faltaIndice")).toBeInstanceOf(Error);
  });

  it("liquidada + liquidar es inválido (ya liquidada, no se reliquida sin evento explícito)", () => {
    expect(transicionCuota("liquidada", "liquidar")).toBeInstanceOf(Error);
  });

  it("liquidada + faltaIndice es inválido", () => {
    expect(transicionCuota("liquidada", "faltaIndice")).toBeInstanceOf(Error);
  });

  const TODOS_LOS_ESTADOS: EstadoCuota[] = ["pendiente", "pendiente_indice", "liquidada"];
  const TODOS_LOS_EVENTOS: EventoCuota[] = ["liquidar", "faltaIndice", "reliquidar"];
  it("toda combinación estado/evento devuelve un EstadoCuota válido o un Error (nunca undefined)", () => {
    for (const estado of TODOS_LOS_ESTADOS) {
      for (const evento of TODOS_LOS_EVENTOS) {
        const resultado = transicionCuota(estado, evento);
        expect(resultado instanceof Error || esEstadoCuota(resultado)).toBe(true);
      }
    }
  });
});
