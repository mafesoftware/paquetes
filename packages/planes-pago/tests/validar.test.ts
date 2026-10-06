import { describe, expect, it } from "vitest";
import type { Importe } from "@mafesoftware/plata-ar";
import type { Condicion } from "../src/generar.js";
import { validarPlan } from "../src/validar.js";

function condicion(extra: Partial<Condicion>): Condicion {
  return {
    concepto: "Condición",
    moneda: "ARS",
    total: 0n,
    cuotas: 1,
    periodicidad: "mensual",
    primeraFecha: "2026-01-15",
    diaVencimiento: 15,
    sistema: "iguales",
    ...extra,
  };
}

describe("validarPlan", () => {
  it("cuando la suma de las condiciones da exacto el valor cerrado, ok", () => {
    const valorCerrado: Importe = { centavos: 10_000_000_000n, moneda: "ARS" }; // $100.000.000,00
    const condiciones = [
      condicion({ concepto: "Anticipo", moneda: "ARS", total: 3_000_000_000n }),
      condicion({ concepto: "Cuotas", moneda: "ARS", total: 7_000_000_000n }),
    ];

    expect(validarPlan(valorCerrado, condiciones)).toEqual({ ok: true });
  });

  it("mezcla anticipo USD 30% + cuotas ARS con TC pactado: convierte y da ok", () => {
    const valorCerrado: Importe = { centavos: 10_000_000_000n, moneda: "ARS" }; // $100.000.000,00
    const condiciones = [
      // Anticipo: USD 30.000,00 (30% de $100.000.000 al TC pactado de 1000).
      condicion({ concepto: "Anticipo", moneda: "USD", total: 3_000_000n }),
      // Saldo: $70.000.000,00 en cuotas ARS.
      condicion({ concepto: "Cuotas", moneda: "ARS", total: 7_000_000_000n }),
    ];

    expect(validarPlan(valorCerrado, condiciones, "1000")).toEqual({ ok: true });
  });

  it("cierre en USD con anticipo USD + saldo en cuotas ARS: convierte ARS→USD dividiendo por el TC, da ok", () => {
    // Total cerrado en USD 100.000,00. TC pactado 1000 (misma convención que arriba).
    const valorCerrado: Importe = { centavos: 10_000_000n, moneda: "USD" }; // USD 100.000,00
    const condiciones = [
      // Anticipo: USD 30.000,00, ya en la misma moneda que el cierre.
      condicion({ concepto: "Anticipo", moneda: "USD", total: 3_000_000n }),
      // Saldo: $70.000.000,00 en cuotas ARS = USD 70.000,00 al TC 1000.
      condicion({ concepto: "Cuotas", moneda: "ARS", total: 7_000_000_000n }),
    ];

    expect(validarPlan(valorCerrado, condiciones, "1000")).toEqual({ ok: true });
  });

  it("una diferencia de 1 centavo da ok:false con la diferencia", () => {
    const valorCerrado: Importe = { centavos: 10_000_000_000n, moneda: "ARS" };
    const condiciones = [
      condicion({ concepto: "Anticipo", moneda: "USD", total: 3_000_000n }),
      // Un centavo de más respecto al test anterior.
      condicion({ concepto: "Cuotas", moneda: "ARS", total: 7_000_000_001n }),
    ];

    expect(validarPlan(valorCerrado, condiciones, "1000")).toEqual({
      ok: false,
      diferencia: { centavos: 1n, moneda: "ARS" },
    });
  });

  it("una condición en otra moneda sin tcPactado es un error de quien arma el plan", () => {
    const valorCerrado: Importe = { centavos: 10_000_000_000n, moneda: "ARS" };
    const condiciones = [condicion({ moneda: "USD", total: 3_000_000n })];

    expect(() => validarPlan(valorCerrado, condiciones)).toThrow();
  });

  it("un tcPactado mal formado (no es un decimal de hasta 8 decimales) es un error", () => {
    // Para entrar a la conversión ARS→USD (la rama que parsea el TC a mano)
    // hace falta una condición en ARS contra un valorCerrado en USD.
    const valorCerrado: Importe = { centavos: 10_000_000n, moneda: "USD" };
    const condiciones = [condicion({ moneda: "ARS", total: 7_000_000_000n })];

    expect(() => validarPlan(valorCerrado, condiciones, "no-es-un-numero")).toThrow(/tipo de cambio inválido/i);
  });

  it("sin condiciones, ok solo si el valor cerrado es cero", () => {
    expect(validarPlan({ centavos: 0n, moneda: "ARS" }, [])).toEqual({ ok: true });
    expect(validarPlan({ centavos: 100n, moneda: "ARS" }, [])).toEqual({
      ok: false,
      diferencia: { centavos: -100n, moneda: "ARS" },
    });
  });
});
