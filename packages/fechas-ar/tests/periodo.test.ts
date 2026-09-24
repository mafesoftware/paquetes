import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ErrorFecha } from "../src/errores.ts";
import { esPeriodo, etiquetaPeriodo, periodoDe, sumarPeriodos, type Periodo } from "../src/periodo.ts";

describe("esPeriodo", () => {
  it("acepta YYYY-MM con mes 01..12", () => {
    expect(esPeriodo("2026-09")).toBe(true);
    expect(esPeriodo("2026-01")).toBe(true);
    expect(esPeriodo("2026-12")).toBe(true);
  });
  it("rechaza mes 13 (test verbatim del brief)", () => {
    expect(esPeriodo("2026-13")).toBe(false);
  });
  it("rechaza mes 00", () => {
    expect(esPeriodo("2026-00")).toBe(false);
  });
  it("rechaza formatos que no son YYYY-MM", () => {
    expect(esPeriodo("2026-9")).toBe(false);
    expect(esPeriodo("2026/09")).toBe(false);
    expect(esPeriodo("2026-09-01")).toBe(false);
    expect(esPeriodo("")).toBe(false);
    expect(esPeriodo("no es un periodo")).toBe(false);
  });
});

describe("periodoDe", () => {
  it("el periodo de un dia de calendario", () => {
    expect(periodoDe("2026-09-24")).toBe("2026-09");
    expect(periodoDe("2026-01-01")).toBe("2026-01");
  });
  it("tira ErrorFecha con una fecha invalida", () => {
    expect(() => periodoDe("2026-02-30")).toThrow(ErrorFecha);
    try {
      periodoDe("2026-02-30");
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("fecha_invalida");
    }
  });
  it("tira ErrorFecha con un formato roto", () => {
    expect(() => periodoDe("24/09/2026")).toThrow(ErrorFecha);
    try {
      periodoDe("24/09/2026");
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("formato_invalido");
    }
  });
});

describe("sumarPeriodos", () => {
  it("cruza de ano (test verbatim del brief)", () => {
    expect(sumarPeriodos("2026-11", 3)).toBe("2027-02");
  });
  it("n negativo resta", () => {
    expect(sumarPeriodos("2027-02", -3)).toBe("2026-11");
    expect(sumarPeriodos("2026-01", -1)).toBe("2025-12");
  });
  it("n === 0 devuelve el mismo periodo", () => {
    expect(sumarPeriodos("2026-09", 0)).toBe("2026-09");
  });
  it("cruza varios anos de una", () => {
    expect(sumarPeriodos("2024-06", 30)).toBe("2026-12");
  });
  it("tira ErrorFecha con un periodo invalido", () => {
    expect(() => sumarPeriodos("2026-13" as Periodo, 1)).toThrow(ErrorFecha);
  });
});

describe("etiquetaPeriodo", () => {
  it("septiembre 2026 (test verbatim del brief)", () => {
    expect(etiquetaPeriodo("2026-09")).toBe("sep-2026");
  });
  it("las doce abreviaturas, en espanol y minusculas", () => {
    expect(etiquetaPeriodo("2026-01")).toBe("ene-2026");
    expect(etiquetaPeriodo("2026-02")).toBe("feb-2026");
    expect(etiquetaPeriodo("2026-03")).toBe("mar-2026");
    expect(etiquetaPeriodo("2026-04")).toBe("abr-2026");
    expect(etiquetaPeriodo("2026-05")).toBe("may-2026");
    expect(etiquetaPeriodo("2026-06")).toBe("jun-2026");
    expect(etiquetaPeriodo("2026-07")).toBe("jul-2026");
    expect(etiquetaPeriodo("2026-08")).toBe("ago-2026");
    expect(etiquetaPeriodo("2026-10")).toBe("oct-2026");
    expect(etiquetaPeriodo("2026-11")).toBe("nov-2026");
    expect(etiquetaPeriodo("2026-12")).toBe("dic-2026");
  });
  it("tira ErrorFecha con un periodo invalido", () => {
    expect(() => etiquetaPeriodo("2026-13" as Periodo)).toThrow(ErrorFecha);
  });
});

describe("propiedad: sumarPeriodos es aditivo", () => {
  it("sumarPeriodos(p, a+b) === sumarPeriodos(sumarPeriodos(p, a), b)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -600, max: 600 }),
        fc.integer({ min: -600, max: 600 }),
        (anio, mes, a, b) => {
          const p = `${anio}-${String(mes).padStart(2, "0")}` as Periodo;
          const directo = sumarPeriodos(p, a + b);
          const encadenado = sumarPeriodos(sumarPeriodos(p, a), b);
          expect(directo).toBe(encadenado);
        },
      ),
    );
  });
});
