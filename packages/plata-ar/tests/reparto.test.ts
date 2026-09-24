import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { repartirPorMayorResto } from "../src/reparto.ts";
import { ErrorPlata } from "../src/errores.ts";

function suma(partes: readonly bigint[]): bigint {
  return partes.reduce((n, p) => n + p, 0n);
}

describe("repartirPorMayorResto", () => {
  it("empate en el resto -> gana el índice más bajo", () => {
    expect(repartirPorMayorResto(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
  });

  it("pesos decimales como string, la suma da el total exacto", () => {
    const partes = repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]);
    expect(suma(partes)).toBe(1000n);
    expect(partes).toHaveLength(3);
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
    it("para 10.000 combinaciones aleatorias de total y pesos", () => {
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
});
