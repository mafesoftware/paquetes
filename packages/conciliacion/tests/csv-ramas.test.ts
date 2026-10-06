/**
 * Más ramas de `csv.ts` que ni `csv.test.ts` ni los fixtures golden
 * ejercitan: fila final sin salto de línea (con/sin contenido pendiente),
 * fila de una sola columna, importe sin parte entera, y fecha con menos
 * tokens que el formato declarado.
 */
import { describe, expect, it } from "vitest";
import { parsearFilasCsv, parsearImporteAr, parsearFechaConFormato } from "../src/csv.js";

describe("parsearFilasCsv — fila final sin salto de línea", () => {
  it("coma colgante sin salto de línea final: el campo vacío final SÍ se agrega (fila.length > 0)", () => {
    const filas = parsearFilasCsv("a,b,");
    expect(filas).toEqual([["a", "b", ""]]);
  });

  it("string totalmente vacía -> sin filas (ni campo ni fila pendiente)", () => {
    expect(parsearFilasCsv("")).toEqual([]);
  });

  it("fila de una sola columna con contenido se mantiene (no es la línea vacía que se descarta)", () => {
    expect(parsearFilasCsv("solo-un-campo\n")).toEqual([["solo-un-campo"]]);
  });
});

describe("parsearImporteAr — sin parte entera", () => {
  it('",56" (solo parte decimal) -> 56 centavos', () => {
    expect(parsearImporteAr(",56", ",")).toBe(56n);
  });
});

describe("parsearFechaConFormato — formato con menos tokens que el valor, o al revés", () => {
  it("el valor trae menos tokens que el formato -> el token sin valor correspondiente queda como string vacío (no cae al default, que es solo para el token AUSENTE del formato)", () => {
    // Formato "DD/MM/YYYY" espera 3 tokens, el valor solo trae 2 (falta el
    // año): `partes.Y` queda seteado a `""` (no `undefined`), así que el
    // `?? "1970"` de más abajo no aplica (`??` solo cubre null/undefined).
    expect(parsearFechaConFormato("15/06", "DD/MM/YYYY")).toBe("-06-15");
  });

  it('formato sin token "D" -> día por defecto "01"', () => {
    expect(parsearFechaConFormato("06/2026", "MM/YYYY")).toBe("2026-06-01");
  });

  it('formato sin token "M" -> mes por defecto "01"', () => {
    expect(parsearFechaConFormato("15/2026", "DD/YYYY")).toBe("2026-01-15");
  });

  it('formato sin token "Y" -> año por defecto "1970"', () => {
    expect(parsearFechaConFormato("15/06", "DD/MM")).toBe("1970-06-15");
  });
});
