import { describe, expect, it } from "vitest";
import { validarFechaDeposito, validarFechaPago, validarMonedaCajaValores } from "../src/validaciones.js";

describe("validarFechaPago", () => {
  it("emisión 20/09/2026, pago 15/10/2026 (25 días) → ok", () => {
    expect(validarFechaPago("2026-09-20", "2026-10-15")).toEqual({ ok: true });
  });

  it("fecha de pago > 360 días desde la emisión → error", () => {
    const resultado = validarFechaPago("2026-01-01", "2027-01-15");
    expect(resultado.ok).toBe(false);
  });

  it("diasLimite ajustable: 30 días excede un tope de 20", () => {
    const resultado = validarFechaPago("2026-01-01", "2026-01-31", 20);
    expect(resultado.ok).toBe(false);
  });
});

describe("validarFechaDeposito", () => {
  it("depósito el mismo día de la fecha de pago (fechaPago <= fecha) → ok", () => {
    expect(validarFechaDeposito("2026-10-15", "2026-10-15")).toEqual({ ok: true });
  });

  it("depósito antes de la fecha de pago → error", () => {
    const resultado = validarFechaDeposito("2026-10-15", "2026-10-01");
    expect(resultado.ok).toBe(false);
  });
});

describe("validarMonedaCajaValores", () => {
  it("cheque en USD solo en caja de valores USD", () => {
    expect(validarMonedaCajaValores("USD", "USD")).toEqual({ ok: true });
    expect(validarMonedaCajaValores("USD", "ARS").ok).toBe(false);
  });
});
