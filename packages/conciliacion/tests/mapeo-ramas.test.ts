/**
 * Más ramas de `parsearConMapeo` que ningún fixture golden ejercita: los 6
 * bancos soportados siempre traen encabezado, débito/crédito ya positivos
 * (nunca con signo) y columna de saldo — así que el camino de
 * "falta alguna columna" o "débito/crédito ya vienen con signo" queda sin
 * cubrir si no se llama a `parsearConMapeo` directo con un `MapeoColumnas`
 * armado a mano.
 */
import { describe, expect, it } from "vitest";
import { parsearConMapeo, type MapeoColumnas } from "../src/mapeo.js";

describe("parsearConMapeo — filas vacías o sin encabezado", () => {
  it("filas vacío (ni encabezado) -> sin líneas ni advertencias, no tira", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      importe: "Importe",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    expect(parsearConMapeo([], mapeo)).toEqual({ lineas: [], advertencias: [] });
  });

  it("fila completamente vacía (todas las celdas en blanco) en el medio del archivo se saltea", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      importe: "Importe",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Importe"],
      ["01/09/2026", "Depósito", "100,00"],
      ["", "", ""],
      ["02/09/2026", "Extracción", "-50,00"],
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    expect(lineas).toHaveLength(2);
  });

  it("fila con menos columnas que el encabezado -> la celda faltante se toma como ''", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      importe: "Importe",
      referencia: "Referencia",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Importe", "Referencia"],
      ["01/09/2026", "Depósito", "100,00"], // sin la columna Referencia
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.referencia).toBeNull();
  });
});

describe("parsearConMapeo — débito/crédito con alguna columna ausente", () => {
  it("solo credito mapeado (sin debito en el MapeoColumnas) -> debito se toma como 0", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      credito: "Credito",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Credito"],
      ["01/09/2026", "Depósito", "100,00"],
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    expect(lineas[0]?.importe).toBe(10000n);
  });

  it("solo debito mapeado (sin credito en el MapeoColumnas) -> credito se toma como 0", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      debito: "Debito",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Debito"],
      ["01/09/2026", "Extracción", "50,00"],
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    expect(lineas[0]?.importe).toBe(-5000n);
  });

  it("débito/crédito que ya vienen con signo en el archivo (caso no documentado, pero el código toma valor absoluto igual)", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      debito: "Debito",
      credito: "Credito",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Debito", "Credito"],
      ["01/09/2026", "Movimiento con signos invertidos", "-50,00", "-100,00"],
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    // (credito<0 ? -credito : credito) - (debito<0 ? -debito : debito) = 100 - 50 = 50
    expect(lineas[0]?.importe).toBe(5000n);
  });
});

describe("parsearConMapeo — columna de saldo ausente o vacía", () => {
  it("sin columna de saldo mapeada -> saldo siempre null, sin comparar saldo corrido", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      importe: "Importe",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Importe"],
      ["01/09/2026", "Depósito", "100,00"],
      ["02/09/2026", "Extracción", "-50,00"],
    ];
    const { lineas, advertencias } = parsearConMapeo(filas, mapeo);
    expect(lineas.every((l) => l.saldo === null)).toBe(true);
    expect(advertencias).toEqual([]);
  });

  it("columna de saldo mapeada pero celda vacía en una fila puntual -> saldo null para esa fila", () => {
    const mapeo: MapeoColumnas = {
      fecha: "Fecha",
      descripcion: "Descripcion",
      importe: "Importe",
      saldo: "Saldo",
      formatoFecha: "DD/MM/YYYY",
      separadorDecimal: ",",
    };
    const filas = [
      ["Fecha", "Descripcion", "Importe", "Saldo"],
      ["01/09/2026", "Depósito", "100,00", ""],
    ];
    const { lineas } = parsearConMapeo(filas, mapeo);
    expect(lineas[0]?.saldo).toBeNull();
  });
});
