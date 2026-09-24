import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { repartirPorMayorResto } from "../src/reparto.ts";
import { ErrorPlata } from "../src/errores.ts";

function suma(partes: readonly bigint[]): bigint {
  return partes.reduce((n, p) => n + p, 0n);
}

describe("repartirPorMayorResto", () => {
  it("empate en el resto y en el peso -> gana el índice más bajo", () => {
    expect(repartirPorMayorResto(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
  });

  it("empate en el resto, pesos distintos -> gana el peso más grande (spec 02 §1)", () => {
    // total=2, pesos=[1,3]: cociente 0/0, resto 2/2 (empate) -> el peso 3 gana.
    expect(repartirPorMayorResto(2n, [1, 3])).toEqual([0n, 2n]);
  });

  it("pesos decimales como string: valores exactos [333n, 333n, 334n]", () => {
    const partes = repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]);
    expect(partes).toEqual([333n, 333n, 334n]);
    expect(suma(partes)).toBe(1000n);
  });

  it("los mismos pesos como number literals dan el mismo resultado exacto", () => {
    const partes = repartirPorMayorResto(1000n, [33.33, 33.33, 33.34]);
    expect(partes).toEqual([333n, 333n, 334n]);
  });

  it("todos los pesos en cero tira ErrorPlata (pesos_todo_cero)", () => {
    expect(() => repartirPorMayorResto(100n, [0, 0, 0])).toThrow(ErrorPlata);
    try {
      repartirPorMayorResto(100n, [0, 0, 0]);
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("pesos_todo_cero");
    }
  });

  it("un solo peso se lleva todo el total", () => {
    expect(repartirPorMayorResto(12345n, [7])).toEqual([12345n]);
    expect(repartirPorMayorResto(12345n, ["2.5"])).toEqual([12345n]);
  });

  it("lista de pesos vacía tira ErrorPlata (pesos_vacio)", () => {
    expect(() => repartirPorMayorResto(100n, [])).toThrow(ErrorPlata);
    try {
      repartirPorMayorResto(100n, []);
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("pesos_vacio");
    }
  });

  it("un peso negativo tira ErrorPlata (peso_negativo)", () => {
    expect(() => repartirPorMayorResto(100n, [1, -1, 2])).toThrow(ErrorPlata);
    try {
      repartirPorMayorResto(100n, [1, -1, 2]);
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("peso_negativo");
    }
  });

  it('"-0" cuenta como cero, no como negativo (number y string)', () => {
    expect(repartirPorMayorResto(100n, [1, -0])).toEqual([100n, 0n]);
    expect(repartirPorMayorResto(100n, ["-0", 1])).toEqual([0n, 100n]);
    expect(() => repartirPorMayorResto(100n, [-0, -0])).toThrow(ErrorPlata); // -0 y -0: pesos_todo_cero
  });

  it("acepta bigint, number y string mezclados", () => {
    const partes = repartirPorMayorResto(1000n, [3n, 1, "1"]);
    expect(suma(partes)).toBe(1000n);
    expect(partes).toEqual([600n, 200n, 200n]);
  });

  it("un peso number no finito (NaN/Infinity) tira ErrorPlata (peso_invalido)", () => {
    for (const peso of [NaN, Infinity, -Infinity]) {
      expect(() => repartirPorMayorResto(100n, [1, peso]), `peso ${peso}`).toThrow(ErrorPlata);
    }
  });

  it("notación exponencial de number se expande exacta: 1e-7 y 1e21", () => {
    // 1e-7 (0,0000001) es una proporción insignificante frente a 1: se
    // lleva 0 de un total chico.
    expect(repartirPorMayorResto(10n, [1, 1e-7])).toEqual([10n, 0n]);
    // 1e21 domina cualquier peso finito razonable de al lado.
    expect(repartirPorMayorResto(10n, [1e21, 1])).toEqual([10n, 0n]);
  });

  it("un peso inválido (no numérico) tira ErrorPlata (peso_invalido)", () => {
    expect(() => repartirPorMayorResto(100n, [1, "abc", 1])).toThrow(ErrorPlata);
    try {
      repartirPorMayorResto(100n, [1, "abc", 1]);
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("peso_invalido");
    }
  });

  it("un grupo familiar de 5 con un total que no divide exacto", () => {
    const partes = repartirPorMayorResto(10_001n, [1, 1, 1, 1, 1]);
    expect(suma(partes)).toBe(10_001n);
    expect(partes).toHaveLength(5);
  });

  it("reparte un total negativo preservando la suma", () => {
    const partes = repartirPorMayorResto(-100n, [1, 1, 1]);
    expect(suma(partes)).toBe(-100n);
  });

  describe("propiedad: la suma da el total y ninguna parte se aleja del ideal en 1 o más", () => {
    it("para 10.000 combinaciones aleatorias de total y pesos bigint", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: 10_000_000_000n }),
          fc.array(fc.bigInt({ min: 0n, max: 1_000_000n }), { minLength: 1, maxLength: 12 }),
          (total, pesosCrudos) => {
            const sumaPesos = pesosCrudos.reduce((n, p) => n + p, 0n);
            fc.pre(sumaPesos > 0n);

            const partes = repartirPorMayorResto(total, pesosCrudos);

            // La suma de las partes da SIEMPRE el total.
            expect(suma(partes)).toBe(total);
            expect(partes).toHaveLength(pesosCrudos.length);

            // Cada parte difiere de su cuota exacta (total * peso_i / sumaPesos,
            // en los reales) en menos de una unidad. Se verifica sin punto
            // flotante: |parte * sumaPesos - total * peso_i| < sumaPesos.
            pesosCrudos.forEach((peso, i) => {
              const exactoEscalado = total * peso; // = (exacto) * sumaPesos
              const parteEscalada = partes[i]! * sumaPesos;
              const diferencia = parteEscalada > exactoEscalado ? parteEscalada - exactoEscalado : exactoEscalado - parteEscalada;
              expect(diferencia < sumaPesos).toBe(true);
            });
          },
        ),
        { numRuns: 10_000 },
      );
    });
  });

  describe("propiedad extendida (M9): tipos mixtos, negativos y totales fuera de MAX_SAFE_INTEGER", () => {
    it("para 3.000 combinaciones con pesos bigint/number/string de distinto largo decimal, total negativo o gigante", () => {
      // Decimales de largo variable (0 a 8), como string: "33.33", "1", "0.00000007".
      const pesoDecimalString = fc
        .tuple(fc.nat({ max: 10_000 }), fc.integer({ min: 0, max: 8 }))
        .chain(([entero, cantidadDecimales]) =>
          cantidadDecimales === 0
            ? fc.constant(String(entero))
            : fc
                .nat({ max: 10 ** cantidadDecimales - 1 })
                .map((frac) => `${entero}.${String(frac).padStart(cantidadDecimales, "0")}`),
        );

      const pesoMixto = fc.oneof(
        fc.bigInt({ min: 0n, max: 10_000n }),
        fc.nat({ max: 10_000 }),
        pesoDecimalString,
      );

      // Un ancla > 0 en bigint garantiza sumaPesos > 0 sin reimplementar acá
      // el parseo de pesos (que volvería la propiedad circular).
      const ancla = fc.integer({ min: 1, max: 1000 });

      fc.assert(
        fc.property(
          // > Number.MAX_SAFE_INTEGER (9_007_199_254_740_991) en los dos signos.
          fc.bigInt({ min: -2_000_000_000_000_000_000n, max: 2_000_000_000_000_000_000n }),
          ancla,
          fc.array(pesoMixto, { minLength: 0, maxLength: 8 }),
          (total, anclaValor, pesosExtra) => {
            const pesos = [anclaValor, ...pesosExtra];
            const partes = repartirPorMayorResto(total, pesos);

            expect(suma(partes)).toBe(total);
            expect(partes).toHaveLength(pesos.length);
          },
        ),
        { numRuns: 3_000 },
      );
    });
  });
});
