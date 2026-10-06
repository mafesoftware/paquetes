import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generarCuotas, type Condicion } from "../src/generar.js";

const SIN_FERIADOS: ReadonlySet<string> = new Set();

/** Condición base para no repetir los campos que no le importan a cada test. */
function condicionBase(extra: Partial<Condicion> = {}): Condicion {
  return {
    concepto: "Cuotas",
    moneda: "ARS",
    total: 100_000n,
    cuotas: 12,
    periodicidad: "mensual",
    primeraFecha: "2026-01-15",
    diaVencimiento: 15,
    sistema: "iguales",
    ...extra,
  };
}

describe("generarCuotas — sistema iguales", () => {
  it("36 cuotas mensuales de $10.000.000,00: 35 iguales + la última absorbe el redondeo, Σ exacto", () => {
    const c = condicionBase({ total: 1_000_000_000n, cuotas: 36 });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas).toHaveLength(36);
    for (const cuota of cuotas.slice(0, 35)) {
      expect(cuota.montoBase).toBe(27_777_778n); // $277.777,78
    }
    expect(cuotas[35]?.montoBase).toBe(27_777_770n); // $277.777,70

    const suma = cuotas.reduce((acc, x) => acc + x.montoBase, 0n);
    expect(suma).toBe(c.total);
  });

  it("cada cuota lleva número, total y los datos de la condición", () => {
    const c = condicionBase({ total: 300_000n, cuotas: 3, concepto: "Anticipo + cuotas", moneda: "USD" });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas.map((x) => [x.numero, x.de])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    for (const cuota of cuotas) {
      expect(cuota.moneda).toBe("USD");
      expect(cuota.concepto).toBe("Anticipo + cuotas");
    }
  });
});

describe("generarCuotas — periodicidad (paso en meses)", () => {
  it.each([
    ["mensual", "2026-09-15", "2026-10-15"],
    ["bimestral", "2026-10-15", "2026-12-15"],
    ["trimestral", "2026-09-15", "2026-12-15"],
    ["cuatrimestral", "2026-01-15", "2026-05-15"],
    ["semestral", "2026-01-15", "2026-07-15"],
    ["anual", "2026-01-15", "2027-01-15"],
  ] as const)("%s: la cuota 2 vence %s meses después de la 1 (%s → %s)", (periodicidad, primeraFecha, esperada) => {
    const c = condicionBase({ periodicidad, primeraFecha, diaVencimiento: 15, cuotas: 2, total: 200_000n });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas[0]?.vencimiento).toBe(primeraFecha);
    expect(cuotas[1]?.vencimiento).toBe(esperada);
  });

  it("día 31 en un mes de 30 días clampea al último día real del mes", () => {
    const c = condicionBase({ periodicidad: "mensual", primeraFecha: "2026-05-15", diaVencimiento: 31, cuotas: 2, total: 200_000n });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas[0]?.vencimiento).toBe("2026-05-15"); // la 1 vence en primeraFecha tal cual
    expect(cuotas[1]?.vencimiento).toBe("2026-06-30"); // junio tiene 30 días, no 31
  });

  it("primera fecha en domingo se mueve al lunes siguiente", () => {
    const c = condicionBase({ primeraFecha: "2026-11-01", cuotas: 1, total: 100_000n }); // 2026-11-01 es domingo
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas[0]?.vencimiento).toBe("2026-11-02"); // lunes
  });

  it("un feriado además del fin de semana empuja al siguiente día hábil", () => {
    const feriados = new Set(["2026-09-04"]); // viernes feriado
    const c = condicionBase({ periodicidad: "mensual", primeraFecha: "2026-08-04", diaVencimiento: 4, cuotas: 2, total: 200_000n });
    const cuotas = generarCuotas(c, feriados);

    // la cuota 2 cruda cae el 2026-09-04 (viernes feriado) → sábado y domingo tampoco sirven → lunes 07
    expect(cuotas[1]?.vencimiento).toBe("2026-09-07");
  });
});

describe("generarCuotas — sistema variación", () => {
  it("cada cuota vale 2% menos que la anterior y la suma da el total exacto", () => {
    const c = condicionBase({ total: 1_000_000n, cuotas: 6, sistema: { tipo: "variacion", porcentaje: "2" } });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas).toHaveLength(6);
    // Decreciente: cada monto es menor o igual al anterior.
    for (let i = 1; i < cuotas.length; i++) {
      expect(cuotas[i]!.montoBase).toBeLessThanOrEqual(cuotas[i - 1]!.montoBase);
    }
    const suma = cuotas.reduce((acc, x) => acc + x.montoBase, 0n);
    expect(suma).toBe(c.total);
  });
});

describe("generarCuotas — sistema manual", () => {
  it("periodicidad libre: usa las fechas y los montos tal cual se pasaron", () => {
    const c = condicionBase({
      total: 500_000n,
      cuotas: 3,
      periodicidad: "libre",
      sistema: {
        tipo: "manual",
        montos: [100_000n, 150_000n, 250_000n],
        fechas: ["2026-01-15", "2026-03-10", "2026-06-05"],
      },
    });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas.map((x) => x.montoBase)).toEqual([100_000n, 150_000n, 250_000n]);
    expect(cuotas.map((x) => x.vencimiento)).toEqual(["2026-01-15", "2026-03-10", "2026-06-05"]);
  });

  it("periodicidad regular con montos manuales: las fechas se calculan igual que en 'iguales'", () => {
    const c = condicionBase({
      total: 300_000n,
      cuotas: 2,
      periodicidad: "mensual",
      primeraFecha: "2026-09-15",
      diaVencimiento: 15,
      sistema: { tipo: "manual", montos: [200_000n, 100_000n] },
    });
    const cuotas = generarCuotas(c, SIN_FERIADOS);

    expect(cuotas.map((x) => x.montoBase)).toEqual([200_000n, 100_000n]);
    expect(cuotas.map((x) => x.vencimiento)).toEqual(["2026-09-15", "2026-10-15"]);
  });

  it("periodicidad 'libre' sin fechas manuales es un error de quien arma el plan", () => {
    const c = condicionBase({ periodicidad: "libre", sistema: "iguales" });
    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow();
  });

  it("la suma de los montos manuales que no coincide con el total es un error, no cuotas silenciosas", () => {
    const c = condicionBase({
      total: 500_000n,
      cuotas: 2,
      sistema: { tipo: "manual", montos: [100_000n, 100_000n] }, // suma 200.000, no 500.000
    });

    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow(/suma/i);
  });

  it("la cantidad de montos manuales que no coincide con 'cuotas' es un error", () => {
    const c = condicionBase({
      total: 300_000n,
      cuotas: 3,
      sistema: { tipo: "manual", montos: [100_000n, 200_000n] }, // 2 montos, 3 cuotas
    });

    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow(/cuotas/i);
  });

  it("un monto manual negativo o cero es un error", () => {
    const c = condicionBase({
      total: 100_000n,
      cuotas: 2,
      sistema: { tipo: "manual", montos: [150_000n, -50_000n] }, // suma da el total, pero un monto es negativo
    });

    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow(/positivos/i);
  });

  it("fechas manuales que no coinciden en cantidad con los montos es un error", () => {
    const c = condicionBase({
      total: 300_000n,
      cuotas: 2,
      periodicidad: "libre",
      sistema: { tipo: "manual", montos: [200_000n, 100_000n], fechas: ["2026-01-15"] }, // 1 fecha, 2 montos
    });

    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow(/fechas/i);
  });

  it("un hueco en el array de fechas manuales (misma cantidad, pero un elemento faltante) es un error defensivo", () => {
    const c = condicionBase({
      total: 300_000n,
      cuotas: 2,
      periodicidad: "libre",
      // Mismo largo que montos (pasa la validación de cantidad), pero el índice 1 no tiene fecha.
      sistema: { tipo: "manual", montos: [200_000n, 100_000n], fechas: ["2026-01-15", undefined as unknown as string] },
    });

    expect(() => generarCuotas(c, SIN_FERIADOS)).toThrow(/falta la fecha manual/i);
  });
});

describe("generarCuotas — property-based: Σ cuotas = total, siempre", () => {
  it("sistema iguales", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000_00n }), fc.integer({ min: 1, max: 60 }), (total, cuotas) => {
        const c = condicionBase({ total, cuotas, sistema: "iguales" });
        const generadas = generarCuotas(c, SIN_FERIADOS);
        const suma = generadas.reduce((acc, x) => acc + x.montoBase, 0n);
        expect(suma).toBe(total);
      }),
    );
  });

  it("sistema variación", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_00n }),
        fc.integer({ min: 1, max: 60 }),
        fc.double({ min: 0.1, max: 15, noNaN: true }),
        (total, cuotas, porcentaje) => {
          const c = condicionBase({ total, cuotas, sistema: { tipo: "variacion", porcentaje: String(porcentaje) } });
          const generadas = generarCuotas(c, SIN_FERIADOS);
          const suma = generadas.reduce((acc, x) => acc + x.montoBase, 0n);
          expect(suma).toBe(total);
        },
      ),
    );
  });
});
