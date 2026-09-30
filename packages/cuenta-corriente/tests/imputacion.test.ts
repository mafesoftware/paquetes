import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { imputarAutomatico, type Deuda } from "../src/imputacion.js";

function deuda(parcial: Partial<Deuda> & Pick<Deuda, "cuotaId" | "vencimiento">): Deuda {
  return {
    interes: 0n,
    ajuste: 0n,
    capital: 0n,
    moneda: "ARS",
    ...parcial,
  };
}

describe("imputarAutomatico", () => {
  it("imputa en orden interés → ajuste → capital, de la cuota más vieja a la más nueva", () => {
    const deudas: Deuda[] = [
      deuda({ cuotaId: "c1-vieja", vencimiento: "2026-01-10", interes: 100n, ajuste: 200n, capital: 1_000n }),
      deuda({ cuotaId: "c2-nueva", vencimiento: "2026-02-10", interes: 50n, ajuste: 150n, capital: 2_000n }),
    ];

    // Disponible para cubrir: los dos intereses (150) y los dos ajustes (350) = 500.
    const { imputaciones, sobrante } = imputarAutomatico(deudas, 500n);

    expect(imputaciones).toEqual([
      { cuotaId: "c1-vieja", concepto: "interes", centavos: 100n },
      { cuotaId: "c2-nueva", concepto: "interes", centavos: 50n },
      { cuotaId: "c1-vieja", concepto: "ajuste", centavos: 200n },
      { cuotaId: "c2-nueva", concepto: "ajuste", centavos: 150n },
    ]);
    expect(sobrante).toBe(0n);
  });

  it("no toca el capital de una cuota mientras haya interés o ajuste pendiente de una más vieja", () => {
    const deudas: Deuda[] = [
      deuda({ cuotaId: "c1-vieja", vencimiento: "2026-01-10", interes: 100n, capital: 1_000n }),
      deuda({ cuotaId: "c2-nueva", vencimiento: "2026-02-10", interes: 50n, capital: 2_000n }),
    ];

    // Alcanza para los dos intereses y para arrancar el capital de la más vieja.
    const { imputaciones, sobrante } = imputarAutomatico(deudas, 100n + 50n + 300n);

    expect(imputaciones).toEqual([
      { cuotaId: "c1-vieja", concepto: "interes", centavos: 100n },
      { cuotaId: "c2-nueva", concepto: "interes", centavos: 50n },
      { cuotaId: "c1-vieja", concepto: "capital", centavos: 300n },
    ]);
    expect(sobrante).toBe(0n);
  });

  it("disponible menor al total: imputa parcial en la cuota correcta y corta ahí", () => {
    const deudas: Deuda[] = [
      deuda({ cuotaId: "c1", vencimiento: "2026-01-10", interes: 100n, capital: 1_000n }),
    ];

    const { imputaciones, sobrante } = imputarAutomatico(deudas, 60n);

    expect(imputaciones).toEqual([{ cuotaId: "c1", concepto: "interes", centavos: 60n }]);
    expect(sobrante).toBe(0n);
  });

  it("disponible mayor al total de la deuda: el resto queda como sobrante", () => {
    const deudas: Deuda[] = [
      deuda({ cuotaId: "c1", vencimiento: "2026-01-10", interes: 100n, ajuste: 50n, capital: 1_000n }),
    ];

    const { imputaciones, sobrante } = imputarAutomatico(deudas, 2_000n);

    expect(imputaciones).toEqual([
      { cuotaId: "c1", concepto: "interes", centavos: 100n },
      { cuotaId: "c1", concepto: "ajuste", centavos: 50n },
      { cuotaId: "c1", concepto: "capital", centavos: 1_000n },
    ]);
    expect(sobrante).toBe(2_000n - 1_150n);
  });

  it("disponible cero: no genera ninguna imputación y no hay sobrante", () => {
    const deudas: Deuda[] = [deuda({ cuotaId: "c1", vencimiento: "2026-01-10", interes: 100n, capital: 1_000n })];

    const { imputaciones, sobrante } = imputarAutomatico(deudas, 0n);

    expect(imputaciones).toEqual([]);
    expect(sobrante).toBe(0n);
  });

  it("sin deudas: todo el disponible queda como sobrante", () => {
    const { imputaciones, sobrante } = imputarAutomatico([], 500n);

    expect(imputaciones).toEqual([]);
    expect(sobrante).toBe(500n);
  });

  it("property-based: la suma de imputaciones más el sobrante siempre da el disponible", () => {
    const arbitrarioDeuda = fc.record({
      cuotaId: fc.uuid(),
      vencimiento: fc
        .tuple(fc.integer({ min: 2024, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
        .map(([a, m, d]) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
      interes: fc.bigInt({ min: 0n, max: 1_000_000n }),
      ajuste: fc.bigInt({ min: 0n, max: 1_000_000n }),
      capital: fc.bigInt({ min: 0n, max: 10_000_000n }),
      moneda: fc.constantFrom("ARS", "USD", "EUR") as fc.Arbitrary<Deuda["moneda"]>,
    });

    fc.assert(
      fc.property(
        fc.array(arbitrarioDeuda, { maxLength: 12 }),
        fc.bigInt({ min: 0n, max: 20_000_000n }),
        (deudas, disponible) => {
          const { imputaciones, sobrante } = imputarAutomatico(deudas, disponible);

          const sumaImputado = imputaciones.reduce((acc, i) => acc + i.centavos, 0n);
          expect(sumaImputado + sobrante).toBe(disponible);

          // Ninguna imputación es negativa ni excede el monto adeudado de su concepto.
          const porConcepto = new Map<string, bigint>();
          for (const d of deudas) {
            porConcepto.set(`${d.cuotaId}:interes`, d.interes);
            porConcepto.set(`${d.cuotaId}:ajuste`, d.ajuste);
            porConcepto.set(`${d.cuotaId}:capital`, d.capital);
          }
          for (const i of imputaciones) {
            expect(i.centavos).toBeGreaterThan(0n);
            expect(i.centavos).toBeLessThanOrEqual(porConcepto.get(`${i.cuotaId}:${i.concepto}`) ?? 0n);
          }

          expect(sobrante).toBeGreaterThanOrEqual(0n);
        },
      ),
    );
  });
});
