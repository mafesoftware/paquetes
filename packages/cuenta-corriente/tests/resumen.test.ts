import { describe, expect, it } from "vitest";
import { resumenDe, montoVigente, type CuotaParaResumen } from "../src/resumen.js";

function cuota(parcial: Partial<CuotaParaResumen> & Pick<CuotaParaResumen, "vencimiento">): CuotaParaResumen {
  return {
    moneda: "ARS",
    montoBaseCentavos: 0n,
    montoAjustadoCentavos: null,
    tipo: "cuota",
    cobradaEn: null,
    ...parcial,
  };
}

describe("montoVigente", () => {
  it("cuota liquidada usa el monto ajustado, no el base", () => {
    expect(montoVigente(cuota({ vencimiento: "2026-01-15", montoBaseCentavos: 100_000n, montoAjustadoCentavos: 105_000n }))).toBe(105_000n);
  });
  it("cuota sin liquidar (montoAjustado null) usa el base", () => {
    expect(montoVigente(cuota({ vencimiento: "2026-01-15", montoBaseCentavos: 100_000n }))).toBe(100_000n);
  });
  it("un documento de ajuste (nota de débito) siempre usa su propio monto base, aunque tenga montoAjustado seteado", () => {
    expect(montoVigente(cuota({ vencimiento: "2026-01-15", tipo: "documento_ajuste", montoBaseCentavos: 4_000n, montoAjustadoCentavos: 999n }))).toBe(
      4_000n
    );
  });
});

describe("resumenDe", () => {
  it("cuotas liquidadas + nota de débito + bonificación (ya reflejada en el monto ajustado) + cobros, saldo por moneda", () => {
    const filas: CuotaParaResumen[] = [
      // Liquidada y ya cobrada (paga) → no debe, cuenta como cobrado a la fecha.
      cuota({ vencimiento: "2026-01-15", montoBaseCentavos: 100_000n, montoAjustadoCentavos: 100_000n, cobradaEn: "2026-01-15" }),
      // Liquidada, vencida, SIN cobrar → deuda vencida + mora.
      cuota({ vencimiento: "2026-02-15", montoBaseCentavos: 100_000n, montoAjustadoCentavos: 108_000n }),
      // Nota de débito por diferencia de índice, vencida, sin cobrar → deuda vencida también.
      cuota({ vencimiento: "2026-02-25", tipo: "documento_ajuste", montoBaseCentavos: 4_000n }),
      // A vencer (todavía no vence) → saldo, NO deuda vencida; es el próximo vencimiento.
      cuota({ vencimiento: "2026-04-15", montoBaseCentavos: 100_000n, montoAjustadoCentavos: 100_000n }),
      // En otra moneda, separado del resto.
      cuota({ vencimiento: "2026-05-15", moneda: "USD", montoBaseCentavos: 50_000n, montoAjustadoCentavos: 50_000n }),
    ];

    const resumen = resumenDe(filas, "2026-03-01");

    expect(resumen.cobradoAFecha).toEqual({ ARS: 100_000n });
    expect(resumen.saldoActual).toEqual({ ARS: 108_000n + 4_000n + 100_000n, USD: 50_000n });
    expect(resumen.deudaVencida).toEqual({ ARS: 108_000n + 4_000n });
    expect(resumen.diasMoraMax).toBe(14); // 2026-02-15 → 2026-03-01
    expect(resumen.proximoVencimiento).toBe("2026-04-15");
  });

  it("sin cuotas vencidas ni pendientes → sin mora, sin deuda, próximo vencimiento null si no hay ninguna", () => {
    const resumen = resumenDe([], "2026-03-01");
    expect(resumen).toEqual({ cobradoAFecha: {}, saldoActual: {}, deudaVencida: {}, diasMoraMax: 0, proximoVencimiento: null });
  });

  it("cobrada en el futuro respecto de `hoy` (fecha de corte) no cuenta como cobrada a la fecha", () => {
    const resumen = resumenDe([cuota({ vencimiento: "2026-01-01", montoBaseCentavos: 1_000n, cobradaEn: "2026-05-01" })], "2026-03-01");
    expect(resumen.cobradoAFecha).toEqual({});
  });

  it("una cuota cancelada (rescisión) no aporta ni a saldo ni a deuda ni a cobrado", () => {
    const resumen = resumenDe(
      [cuota({ vencimiento: "2026-01-01", montoBaseCentavos: 100_000n, estado: "cancelada" })],
      "2026-03-01"
    );
    expect(resumen).toEqual({ cobradoAFecha: {}, saldoActual: {}, deudaVencida: {}, diasMoraMax: 0, proximoVencimiento: null });
  });

  it("una cuota refinanciada (reemplazada por un nuevo plan) tampoco aporta", () => {
    const resumen = resumenDe(
      [cuota({ vencimiento: "2026-01-01", montoBaseCentavos: 100_000n, estado: "refinanciada" })],
      "2026-03-01"
    );
    expect(resumen).toEqual({ cobradoAFecha: {}, saldoActual: {}, deudaVencida: {}, diasMoraMax: 0, proximoVencimiento: null });
  });

  it("una cuota pendiente (estado explícito, no cancelada/refinanciada) sí aporta normalmente", () => {
    const resumen = resumenDe(
      [cuota({ vencimiento: "2026-04-01", montoBaseCentavos: 100_000n, estado: "pendiente" })],
      "2026-03-01"
    );
    expect(resumen.saldoActual).toEqual({ ARS: 100_000n });
  });
});
