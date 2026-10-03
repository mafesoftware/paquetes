import { describe, expect, it } from "vitest";
import { costoPromedio, egresoAPromedio, egresoAValorFijo, ingresoAValorFijo, type SaldoStock } from "../src/costo-promedio.js";

/**
 * Costo promedio ponderado, sin perder el centavo. Todos los importes en
 * CENTAVOS (`bigint`): "$ 10.000" = 1.000.000 centavos.
 */
describe("costoPromedio / egresoAPromedio", () => {
  it("100 bolsas a $ 10.000 (valor $ 1.000.000) + ingreso 50 a $ 13.000 → 150 a $ 11.000 (valor $ 1.650.000)", () => {
    const vacio: SaldoStock = { cantidad: "0", valor: 0n };
    const s1 = costoPromedio(vacio, { cantidad: "100", costoUnitario: 1_000_000n });
    expect(s1.cantidad).toBe("100.0000");
    expect(s1.valor).toBe(100_000_000n); // $ 1.000.000

    const s2 = costoPromedio(s1, { cantidad: "50", costoUnitario: 1_300_000n });
    expect(s2.cantidad).toBe("150.0000");
    expect(s2.valor).toBe(165_000_000n); // $ 1.650.000
    expect(s2.costoUnitario).toBe(1_100_000n); // $ 11.000
  });

  it("egreso 30 → valor $ 330.000, quedan 120 por $ 1.320.000", () => {
    const s: SaldoStock = { cantidad: "150.0000", valor: 165_000_000n };
    const resultado = egresoAPromedio(s, "30");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.valorEgreso).toBe(33_000_000n); // $ 330.000
    expect(resultado.resto.cantidad).toBe("120.0000");
    expect(resultado.resto.valor).toBe(132_000_000n); // $ 1.320.000
  });

  it("egreso de 200 con 120 → stock_insuficiente con disponible 120", () => {
    const s: SaldoStock = { cantidad: "120.0000", valor: 132_000_000n };
    const resultado = egresoAPromedio(s, "200");
    expect(resultado).toEqual({ ok: false, error: "stock_insuficiente", disponible: "120.0000" });
  });

  it("costo con centavos: 3 u por $ 1.000 (total) + 1 u por $ 1/u → promedio $ 250,25 y el egreso de las 4 vale exactamente $ 1.001,00 (sin perder el centavo)", () => {
    // Saldo inicial: 3 unidades que ya valen $ 1.000 en total (100.000 centavos) —
    // el punto del test es que `valor` es la fuente de verdad, no un costo
    // unitario recalculado y redondeado.
    const saldoInicial: SaldoStock = { cantidad: "3", valor: 100_000n };
    const s = costoPromedio(saldoInicial, { cantidad: "1", costoUnitario: 100n }); // 1 u a $ 1 (100 centavos)
    expect(s.cantidad).toBe("4.0000");
    expect(s.valor).toBe(100_100n); // $ 1.001,00
    expect(s.costoUnitario).toBe(25_025n); // $ 250,25

    const egreso = egresoAPromedio({ cantidad: s.cantidad, valor: s.valor }, "4");
    expect(egreso.ok).toBe(true);
    if (!egreso.ok) throw new Error("no debería fallar");
    expect(egreso.valorEgreso).toBe(100_100n); // $ 1.001,00 exactos, sin perder el centavo
    expect(egreso.resto).toEqual({ cantidad: "0.0000", valor: 0n });
  });

  it("egresar TODO el saldo no deja valor residual (ni positivo ni negativo)", () => {
    // 3 u a $ 100,00 + 4 u a $ 101,01 = 7 u por $ 704,04 (promedio $ 100,58, redondeado). Egresar
    // `cantidad × costoUnitario` recalculado da $ 704,06 — $ 0,02 MÁS que el valor real del saldo —
    // y el resto quedaría en cantidad 0 con valor −$ 0,02 (plata que no existe). Egresar el saldo
    // ENTERO se lleva `s.valor` exacto, sin volver a redondear.
    const saldoInicial: SaldoStock = { cantidad: "0", valor: 0n };
    const s1 = costoPromedio(saldoInicial, { cantidad: "3", costoUnitario: 10_000n }); // 3 u a $ 100,00
    const s2 = costoPromedio(s1, { cantidad: "4", costoUnitario: 10_101n }); // 4 u a $ 101,01
    expect(s2.cantidad).toBe("7.0000");
    expect(s2.valor).toBe(70_404n); // $ 704,04
    expect(s2.costoUnitario).toBe(10_058n); // $ 100,58 (redondeado)

    const egreso = egresoAPromedio({ cantidad: s2.cantidad, valor: s2.valor }, "7");
    expect(egreso.ok).toBe(true);
    if (!egreso.ok) throw new Error("no debería fallar");
    expect(egreso.valorEgreso).toBe(70_404n); // NUNCA $ 704,06 (7 × costoUnitario redondeado)
    expect(egreso.resto).toEqual({ cantidad: "0.0000", valor: 0n }); // NUNCA valor −$ 0,02
  });
});

describe("egresoAValorFijo", () => {
  it("egresa al valor FIJO pasado, no al costo promedio vigente del saldo", () => {
    // Saldo a costo promedio $ 11.000/u (promedio vigente), pero la reversión
    // tiene que volver al precio ORIGINAL de la operación anterior ($ 9.500/u).
    const s: SaldoStock = { cantidad: "150.0000", valor: 165_000_000n }; // promedio $ 11.000
    const resultado = egresoAValorFijo(s, "30", 28_500_00n); // 30 u × $ 9.500 = $ 285.000
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.valorEgreso).toBe(28_500_00n);
    expect(resultado.resto.cantidad).toBe("120.0000");
    expect(resultado.resto.valor).toBe(165_000_000n - 28_500_00n);
  });

  it("cantidad insuficiente → stock_insuficiente con el disponible real", () => {
    const s: SaldoStock = { cantidad: "20.0000", valor: 20_000_00n };
    const resultado = egresoAValorFijo(s, "25", 1_000n);
    expect(resultado).toEqual({ ok: false, error: "stock_insuficiente", disponible: "20.0000" });
  });

  it("valor fijo mayor al valor disponible → se acota a s.valor, nunca queda negativo", () => {
    const s: SaldoStock = { cantidad: "10.0000", valor: 1_000_00n };
    const resultado = egresoAValorFijo(s, "10", 5_000_00n); // pide $ 5.000 pero el saldo solo vale $ 1.000
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.valorEgreso).toBe(1_000_00n);
    expect(resultado.resto).toEqual({ cantidad: "0.0000", valor: 0n });
  });
});

describe("ingresoAValorFijo", () => {
  it("repone cantidad y valor historico exactos sin recalcular desde un unitario redondeado", () => {
    const saldo: SaldoStock = { cantidad: "4", valor: 40_000n };
    const resultado = ingresoAValorFijo(saldo, "3", 100_001n);

    expect(resultado).toEqual({ cantidad: "7.0000", valor: 140_001n, costoUnitario: 20_000n });
  });
});
