import { describe, expect, it } from "vitest";
import { refundicionDe } from "../src/refundicion.js";

describe("refundicionDe", () => {
  it("ventas 10.000.000, costo 6.000.000, gastos 1.000.000 → D 4.1 10.000.000 / H 5.1 6.000.000, H 5.6 1.000.000, H 3.3 3.000.000 (caso del brief)", () => {
    const resultado = refundicionDe(
      [
        { cuentaId: "4.1", naturaleza: "resultado_positivo", saldo: 10_000_000_00n },
        { cuentaId: "5.1", naturaleza: "resultado_negativo", saldo: 6_000_000_00n },
        { cuentaId: "5.6", naturaleza: "resultado_negativo", saldo: 1_000_000_00n },
      ],
      "3.3"
    );

    expect(resultado.resultadoNeto).toBe(3_000_000_00n);
    expect(resultado.lineas).toEqual([
      { cuentaId: "4.1", debe: 10_000_000_00n, haber: 0n, detalle: "Refundición — cancelación de saldo" },
      { cuentaId: "5.1", debe: 0n, haber: 6_000_000_00n, detalle: "Refundición — cancelación de saldo" },
      { cuentaId: "5.6", debe: 0n, haber: 1_000_000_00n, detalle: "Refundición — cancelación de saldo" },
      { cuentaId: "3.3", debe: 0n, haber: 3_000_000_00n, detalle: "Refundición — resultado del ejercicio (ganancia)" },
    ]);

    const debe = resultado.lineas.reduce((a, l) => a + l.debe, 0n);
    const haber = resultado.lineas.reduce((a, l) => a + l.haber, 0n);
    expect(debe).toBe(haber);
  });

  it("gastos superan a las ventas → pérdida, contrapartida al DEBE de 3.3", () => {
    const resultado = refundicionDe(
      [
        { cuentaId: "4.1", naturaleza: "resultado_positivo", saldo: 1_000_000_00n },
        { cuentaId: "5.1", naturaleza: "resultado_negativo", saldo: 1_500_000_00n },
      ],
      "3.3"
    );
    expect(resultado.resultadoNeto).toBe(-500_000_00n);
    expect(resultado.lineas.at(-1)).toEqual({ cuentaId: "3.3", debe: 500_000_00n, haber: 0n, detalle: "Refundición — resultado del ejercicio (pérdida)" });
  });

  it("resultado exactamente en cero → sin línea de contrapartida", () => {
    const resultado = refundicionDe(
      [
        { cuentaId: "4.1", naturaleza: "resultado_positivo", saldo: 1_000_000_00n },
        { cuentaId: "5.1", naturaleza: "resultado_negativo", saldo: 1_000_000_00n },
      ],
      "3.3"
    );
    expect(resultado.resultadoNeto).toBe(0n);
    expect(resultado.lineas).toHaveLength(2);
  });

  it("cuenta con saldo 0 → no genera línea", () => {
    const resultado = refundicionDe([{ cuentaId: "4.1", naturaleza: "resultado_positivo", saldo: 0n }], "3.3");
    expect(resultado.lineas).toEqual([]);
    expect(resultado.resultadoNeto).toBe(0n);
  });
});
