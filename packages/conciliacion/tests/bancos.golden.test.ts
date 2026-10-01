/**
 * Tests GOLDEN: cada fixture de `tests/fixtures/<banco>/` contra su
 * `*.esperado.json` exacto (fecha ISO, importe en centavos con signo,
 * saldo, referencia). Cubre los 6 bancos (CSV: galicia, santander, macro
 * —columnas desordenadas—, nacion —decimal "."—, provincia; XLSX: bbva)
 * más el caso "PDF multicuenta (Galicia con cuenta ARS y USD) -> 2
 * extractos con su moneda" con el fixture `.pdf` real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parserGaliciaCsv, parserGaliciaPdf } from "../src/bancos/galicia.js";
import { parserSantanderCsv } from "../src/bancos/santander.js";
import { parserMacroCsv } from "../src/bancos/macro.js";
import { parserNacionCsv } from "../src/bancos/nacion.js";
import { parserProvinciaCsv } from "../src/bancos/provincia.js";
import { parserBbvaXlsx } from "../src/bancos/bbva.js";
import type { ExtractoCuenta } from "../src/motor.js";

const FIXTURES = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

function leer(banco: string, archivo: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, banco, archivo)));
}

function leerEsperado(banco: string, archivo: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, banco, archivo), "utf-8"));
}

/** Los `.esperado.json` no pueden llevar `bigint` (JSON no lo soporta): centavos como `number`, comparables 1 a 1 acá. */
function normalizar(extractos: ExtractoCuenta[]) {
  return extractos.map((e) => ({
    cuenta: e.cuenta,
    moneda: e.moneda,
    lineas: e.lineas.map((l) => ({
      fecha: l.fecha,
      descripcion: l.descripcion,
      importe: Number(l.importe),
      saldo: l.saldo === null ? null : Number(l.saldo),
      referencia: l.referencia,
    })),
    ...(e.advertencias && e.advertencias.length ? { advertencias: e.advertencias } : {}),
  }));
}

describe("golden por banco", () => {
  it("galicia (csv)", async () => {
    const extractos = await parserGaliciaCsv.parsear(leer("galicia", "extracto.csv"));
    expect(normalizar(extractos)).toEqual(leerEsperado("galicia", "extracto.esperado.json"));
  });

  it("galicia (pdf, multicuenta ARS/USD) -> 2 extractos con su moneda", async () => {
    const extractos = await parserGaliciaPdf.parsear(leer("galicia", "extracto.pdf"));
    expect(extractos).toHaveLength(2);
    expect(extractos.map((e) => e.moneda).sort()).toEqual(["ARS", "USD"]);
    expect(normalizar(extractos)).toEqual(leerEsperado("galicia", "extracto-pdf.esperado.json"));
  });

  it("santander (csv, importe con signo en una sola columna)", async () => {
    const extractos = await parserSantanderCsv.parsear(leer("santander", "extracto.csv"));
    expect(normalizar(extractos)).toEqual(leerEsperado("santander", "extracto.esperado.json"));
  });

  it("macro (csv, columnas desordenadas)", async () => {
    const extractos = await parserMacroCsv.parsear(leer("macro", "extracto.csv"));
    expect(normalizar(extractos)).toEqual(leerEsperado("macro", "extracto.esperado.json"));
  });

  it('nación (csv, separadorDecimal ".")', async () => {
    const extractos = await parserNacionCsv.parsear(leer("nacion", "extracto.csv"));
    expect(normalizar(extractos)).toEqual(leerEsperado("nacion", "extracto.esperado.json"));
  });

  it("provincia (csv)", async () => {
    const extractos = await parserProvinciaCsv.parsear(leer("provincia", "extracto.csv"));
    expect(normalizar(extractos)).toEqual(leerEsperado("provincia", "extracto.esperado.json"));
  });

  it("bbva (xlsx, tabla recortada desde la fila de encabezado real)", async () => {
    const extractos = await parserBbvaXlsx.parsear(leer("bbva", "extracto.xlsx"));
    expect(normalizar(extractos)).toEqual(leerEsperado("bbva", "extracto.esperado.json"));
  });
});
