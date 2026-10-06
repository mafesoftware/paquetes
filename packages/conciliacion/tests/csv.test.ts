/**
 * Tests unitarios de `csv.ts` que cierran ramas que los fixtures golden
 * (`bancos.golden.test.ts`) no ejercitan: ningún banco de los 6 soportados
 * manda campos entrecomillados, importes entre paréntesis ni fechas con año
 * de 2 dígitos.
 */
import { describe, expect, it } from "vitest";
import { parsearFilasCsv, parsearImporteAr, parsearFechaConFormato } from "../src/csv.js";

describe("parsearFilasCsv — campos entrecomillados", () => {
  it("campo entre comillas con el separador adentro no se corta", () => {
    const filas = parsearFilasCsv('a,"b,c",d\n1,2,3');
    expect(filas).toEqual([
      ["a", "b,c", "d"],
      ["1", "2", "3"],
    ]);
  });

  it('comilla doble ("") dentro de un campo entrecomillado = comilla literal', () => {
    const filas = parsearFilasCsv('"el ""mejor"" banco",100');
    expect(filas).toEqual([['el "mejor" banco', "100"]]);
  });

  it("campo entrecomillado con salto de línea adentro no corta la fila", () => {
    const filas = parsearFilasCsv('"linea1\nlinea2",100');
    expect(filas).toEqual([["linea1\nlinea2", "100"]]);
  });

  it("separador configurable sigue respetando comillas", () => {
    const filas = parsearFilasCsv('"a;b";c', ";");
    expect(filas).toEqual([["a;b", "c"]]);
  });
});

describe("parsearImporteAr — paréntesis = negativo", () => {
  it('"(1.234,56)" -> -123456n', () => {
    expect(parsearImporteAr("(1.234,56)", ",")).toBe(-123456n);
  });

  it('"($ 1.234,56)" con símbolo de moneda adentro del paréntesis -> -123456n', () => {
    expect(parsearImporteAr("($ 1.234,56)", ",")).toBe(-123456n);
  });

  it('"(1,234.56)" con separadorDecimal "." -> -123456n', () => {
    expect(parsearImporteAr("(1,234.56)", ".")).toBe(-123456n);
  });
});

describe("parsearFechaConFormato — año de 2 dígitos", () => {
  it('"01/01/25" con formato "DD/MM/YY" -> año < 50 se interpreta 20XX', () => {
    expect(parsearFechaConFormato("01/01/25", "DD/MM/YY")).toBe("2025-01-01");
  });

  it('"01/01/99" con formato "DD/MM/YY" -> año >= 50 se interpreta 19XX', () => {
    expect(parsearFechaConFormato("01/01/99", "DD/MM/YY")).toBe("1999-01-01");
  });
});
