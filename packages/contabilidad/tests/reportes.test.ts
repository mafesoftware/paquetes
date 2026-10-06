import { describe, expect, it } from "vitest";
import {
  saldoDeCuenta,
  totalesSumasYSaldos,
  agruparPorNaturaleza,
  balanceCuadra,
  evaluarAgrupacion,
  estadoResultadosDeSumas,
  saldoCorrido,
  totalPorProyecto,
  calcularProporcionAB,
  type SumaCuenta,
} from "../src/reportes.js";

describe("saldoDeCuenta", () => {
  it("activo: saldo deudor (debe - haber)", () => {
    expect(saldoDeCuenta("activo", 1000n, 300n)).toBe(700n);
  });
  it("pasivo: saldo acreedor (haber - debe)", () => {
    expect(saldoDeCuenta("pasivo", 300n, 1000n)).toBe(700n);
  });
  it("resultado_negativo (gasto): saldo deudor", () => {
    expect(saldoDeCuenta("resultado_negativo", 500n, 0n)).toBe(500n);
  });
  it("resultado_positivo (ingreso): saldo acreedor", () => {
    expect(saldoDeCuenta("resultado_positivo", 0n, 500n)).toBe(500n);
  });
});

describe("totalesSumasYSaldos", () => {
  it("Σ debe = Σ haber en un escenario que cuadra (partida doble)", () => {
    const filas = [
      { debe: 1000n, haber: 0n },
      { debe: 0n, haber: 1000n },
      { debe: 500n, haber: 500n },
    ];
    const totales = totalesSumasYSaldos(filas);
    expect(totales.debe).toBe(totales.haber);
    expect(totales.debe).toBe(1500n);
  });
});

describe("agruparPorNaturaleza / balanceCuadra", () => {
  it("Activo = Pasivo + PN + Resultado del período", () => {
    const filas: SumaCuenta[] = [
      { cuentaId: "1", codigo: "1.1", naturaleza: "activo", debe: 10000n, haber: 0n },
      { cuentaId: "2", codigo: "2.1", naturaleza: "pasivo", debe: 0n, haber: 4000n },
      { cuentaId: "3", codigo: "3.1", naturaleza: "pn", debe: 0n, haber: 5000n },
      { cuentaId: "4", codigo: "4.1", naturaleza: "resultado_positivo", debe: 0n, haber: 2000n },
      { cuentaId: "5", codigo: "5.1", naturaleza: "resultado_negativo", debe: 1000n, haber: 0n },
    ];
    const hoja = agruparPorNaturaleza(filas);
    // resultado del período = 2000 (ingreso) - 1000 (gasto) = 1000
    expect(hoja.resultado).toBe(1000n);
    expect(hoja.activo).toBe(10000n);
    expect(hoja.pasivo).toBe(4000n);
    expect(hoja.pn).toBe(5000n);
    expect(balanceCuadra(hoja)).toBe(true);
  });

  it("no cuadra si falta un movimiento (detecta desbalance)", () => {
    const hoja = { activo: 10000n, pasivo: 4000n, pn: 5000n, resultado: 500n };
    expect(balanceCuadra(hoja)).toBe(false);
  });
});

describe("evaluarAgrupacion", () => {
  it('"Resultado bruto" = 4.1 + 4.2 − 5.1', () => {
    const filas: SumaCuenta[] = [
      { cuentaId: "a", codigo: "4.1", naturaleza: "resultado_positivo", debe: 0n, haber: 6000n },
      { cuentaId: "b", codigo: "4.1.01", naturaleza: "resultado_positivo", debe: 0n, haber: 1000n },
      { cuentaId: "c", codigo: "4.2", naturaleza: "resultado_positivo", debe: 0n, haber: 3000n },
      { cuentaId: "d", codigo: "4.3", naturaleza: "resultado_positivo", debe: 0n, haber: 999999n }, // no debe entrar
      { cuentaId: "e", codigo: "5.1", naturaleza: "resultado_negativo", debe: 2000n, haber: 0n },
    ];
    const formula = [
      { prefijoCodigo: "4.1", signo: 1 as const },
      { prefijoCodigo: "4.2", signo: 1 as const },
      { prefijoCodigo: "5.1", signo: -1 as const },
    ];
    // (6000+1000) + 3000 - 2000 = 8000
    expect(evaluarAgrupacion(formula, filas)).toBe(8000n);
  });
});

describe("estadoResultadosDeSumas", () => {
  it("estado de resultados = Σ cuentas 4 − Σ cuentas 5", () => {
    const filas: SumaCuenta[] = [
      { cuentaId: "a", codigo: "4.1", naturaleza: "resultado_positivo", debe: 0n, haber: 10000n },
      { cuentaId: "b", codigo: "5.1", naturaleza: "resultado_negativo", debe: 6000n, haber: 0n },
      { cuentaId: "c", codigo: "1.1", naturaleza: "activo", debe: 999999n, haber: 0n }, // no debe afectar
    ];
    expect(estadoResultadosDeSumas(filas)).toBe(4000n);
  });
});

describe("saldoCorrido", () => {
  it("saldo inicial + movimientos en orden, cuenta de activo (Banco Galicia)", () => {
    const movimientos = [
      { debe: 1000n, haber: 0n },
      { debe: 0n, haber: 300n },
      { debe: 500n, haber: 0n },
    ];
    const corrido = saldoCorrido("activo", 2000n, movimientos);
    expect(corrido).toEqual([3000n, 2700n, 3200n]);
  });

  it("cuenta de pasivo: el haber aumenta el saldo y el debe lo disminuye (signo invertido)", () => {
    const movimientos = [
      { debe: 0n, haber: 1000n },
      { debe: 300n, haber: 0n },
    ];
    const corrido = saldoCorrido("pasivo", 0n, movimientos);
    expect(corrido).toEqual([1000n, 700n]);
  });
});

describe("totalPorProyecto", () => {
  it('Σ de los proyectos + "sin proyecto" = total', () => {
    const filas = [
      { proyectoId: "p1", importe: 1000n },
      { proyectoId: "p2", importe: 2000n },
      { proyectoId: null, importe: 500n },
      { proyectoId: "p1", importe: 100n },
    ];
    const porProyecto = totalPorProyecto(filas);
    const total = porProyecto.reduce((acc, f) => acc + f.total, 0n);
    expect(total).toBe(3600n);
    expect(porProyecto.find((f) => f.proyectoId === null)?.total).toBe(500n);
  });
});

describe("calcularProporcionAB", () => {
  it("A 95%, B 5% (fixture del brief)", () => {
    const { pctA, pctB } = calcularProporcionAB(950000n, 50000n);
    expect(pctA).toBe(95);
    expect(pctB).toBe(5);
    expect(pctA + pctB).toBe(100);
  });

  it("sin movimientos → 0/0", () => {
    expect(calcularProporcionAB(0n, 0n)).toEqual({ pctA: 0, pctB: 0 });
  });
});
