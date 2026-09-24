import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ErrorFecha } from "../src/errores.ts";
import { sumarMeses } from "../src/meses.ts";
import { validarFechaISO } from "../src/interno.ts";

describe("sumarMeses", () => {
  it("31 de enero + 1 mes, dia 31: cae en el 28 (test verbatim del brief)", () => {
    expect(sumarMeses("2026-01-31", 1, 31)).toBe("2026-02-28");
  });
  it("lo mismo, pero 2028 es bisiesto: cae en el 29 (test verbatim del brief)", () => {
    expect(sumarMeses("2028-01-31", 1, 31)).toBe("2028-02-29");
  });
  it('con "ultimo" siempre da el ultimo dia del mes resultante', () => {
    expect(sumarMeses("2026-01-15", 1, "ultimo")).toBe("2026-02-28");
    expect(sumarMeses("2028-01-15", 1, "ultimo")).toBe("2028-02-29");
    expect(sumarMeses("2026-03-01", 0, "ultimo")).toBe("2026-03-31");
  });
  it("dia que si existe en el mes resultante se respeta tal cual", () => {
    expect(sumarMeses("2026-01-10", 1, 10)).toBe("2026-02-10");
  });
  it("n negativo resta meses", () => {
    expect(sumarMeses("2026-03-31", -1, 31)).toBe("2026-02-28");
  });
  it("n === 0 fija el dia en el mismo mes", () => {
    expect(sumarMeses("2026-02-10", 0, 28)).toBe("2026-02-28");
  });
  it("cruza de ano", () => {
    expect(sumarMeses("2026-12-15", 2, 15)).toBe("2027-02-15");
    expect(sumarMeses("2026-01-15", -2, 15)).toBe("2025-11-15");
  });

  it("tira ErrorFecha (fecha_invalida) con un dia de calendario imposible", () => {
    expect(() => sumarMeses("2026-02-30", 1, 15)).toThrow(ErrorFecha);
    try {
      sumarMeses("2026-02-30", 1, 15);
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("fecha_invalida");
    }
  });
  it("tira ErrorFecha (formato_invalido) con un formato roto", () => {
    expect(() => sumarMeses("30/01/2026", 1, 15)).toThrow(ErrorFecha);
  });
  it("tira ErrorFecha (dia_invalido) con un dia objetivo fuera de 1..31", () => {
    expect(() => sumarMeses("2026-01-15", 1, 0)).toThrow(ErrorFecha);
    expect(() => sumarMeses("2026-01-15", 1, 32)).toThrow(ErrorFecha);
    expect(() => sumarMeses("2026-01-15", 1, 15.5)).toThrow(ErrorFecha);
    try {
      sumarMeses("2026-01-15", 1, 32);
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("dia_invalido");
    }
  });
});

describe("propiedad: sumarMeses siempre da una fecha valida cuyo dia <= el pedido", () => {
  it("para cualquier fecha, n y dia objetivo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }), // dia de la fecha DE ORIGEN: 1..28 para que siempre exista
        fc.integer({ min: -600, max: 600 }),
        fc.integer({ min: 1, max: 31 }),
        (anio, mes, diaOrigen, n, diaObjetivo) => {
          const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(diaOrigen).padStart(2, "0")}`;
          const resultado = sumarMeses(fecha, n, diaObjetivo);
          // Es una fecha de calendario real: no tira.
          const { dia } = validarFechaISO(resultado);
          expect(dia).toBeLessThanOrEqual(diaObjetivo);
        },
      ),
    );
  });
});
