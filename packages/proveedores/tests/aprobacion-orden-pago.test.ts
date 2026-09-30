import { describe, expect, it } from "vitest";
import { estadoInicialOp, requiereAprobacion } from "../src/aprobacion-orden-pago.js";

describe("requiereAprobacion", () => {
  it("sin umbral configurado nunca exige aprobación", () => {
    expect(requiereAprobacion(1_000_000_00n, null)).toBe(false);
  });

  it("por encima del umbral exige aprobación", () => {
    expect(requiereAprobacion(1_000_001n, 1_000_000n)).toBe(true);
  });

  it("exactamente en el umbral NO exige (estrictamente por encima)", () => {
    expect(requiereAprobacion(1_000_000n, 1_000_000n)).toBe(false);
  });
});

describe("estadoInicialOp", () => {
  it("sin aprobación requerida, queda aprobada directo", () => {
    expect(estadoInicialOp(false, false)).toBe("aprobada");
  });

  it("con aprobación requerida y sin el permiso, queda pendiente_aprobacion", () => {
    expect(estadoInicialOp(true, false)).toBe("pendiente_aprobacion");
  });

  it("con aprobación requerida pero quien crea ya puede aprobar, queda aprobada directo", () => {
    expect(estadoInicialOp(true, true)).toBe("aprobada");
  });
});
