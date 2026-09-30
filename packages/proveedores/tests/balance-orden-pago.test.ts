import { describe, expect, it } from "vitest";
import { excedeSaldoDocumento, saldoDisponibleAnticipo, totalPorMoneda, validarBalanceOp } from "../src/balance-orden-pago.js";

describe("totalPorMoneda", () => {
  it("agrupa por moneda sin mezclarlas", () => {
    expect(totalPorMoneda([{ monto: 1000n, moneda: "ARS" }, { monto: 500n, moneda: "ARS" }, { monto: 200n, moneda: "USD" }])).toEqual({
      ARS: 1500n,
      USD: 200n,
    });
  });
});

describe("validarBalanceOp", () => {
  it("ok cuando medios y requerido coinciden en cada moneda — multi-caja multi-moneda", () => {
    const medios = [
      { monto: 1000n, moneda: "ARS" as const },
      { monto: 500n, moneda: "ARS" as const },
      { monto: 200n, moneda: "USD" as const },
    ];
    const imputaciones = [
      { monto: 1500n, moneda: "ARS" as const, consumeAnticipo: false },
      { monto: 200n, moneda: "USD" as const, consumeAnticipo: false },
    ];
    expect(validarBalanceOp(medios, imputaciones)).toEqual({ ok: true });
  });

  it("error cuando los medios no cubren lo imputado", () => {
    const r = validarBalanceOp([{ monto: 1000n, moneda: "ARS" }], [{ monto: 1500n, moneda: "ARS", consumeAnticipo: false }]);
    expect(r.ok).toBe(false);
  });

  it("una imputación que consume un anticipo existente no exige plata nueva", () => {
    const r = validarBalanceOp([], [{ monto: 1000n, moneda: "ARS", consumeAnticipo: true }]);
    expect(r).toEqual({ ok: true });
  });

  it("mezclar plata nueva y anticipo consumido: solo la parte nueva exige medios de pago", () => {
    const medios = [{ monto: 300n, moneda: "ARS" as const }];
    const imputaciones = [
      { monto: 300n, moneda: "ARS" as const, consumeAnticipo: false },
      { monto: 700n, moneda: "ARS" as const, consumeAnticipo: true },
    ];
    expect(validarBalanceOp(medios, imputaciones)).toEqual({ ok: true });
  });
});

describe("excedeSaldoDocumento", () => {
  it("no deja pagar más que el saldo pendiente", () => {
    expect(excedeSaldoDocumento(1001n, 1000n)).toBe(true);
    expect(excedeSaldoDocumento(1000n, 1000n)).toBe(false);
  });
});

describe("saldoDisponibleAnticipo", () => {
  it("resta lo ya aplicado", () => {
    expect(saldoDisponibleAnticipo(1000n, 300n)).toBe(700n);
    expect(saldoDisponibleAnticipo(1000n, 1000n)).toBe(0n);
  });
});
