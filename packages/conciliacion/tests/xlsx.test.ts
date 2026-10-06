/**
 * Tests unitarios de `leerFilasXlsx`/`indiceDeFilaEncabezado` que cierran
 * ramas que el fixture golden de BBVA no ejercita: un `.xlsx` sin ninguna
 * hoja, y un encabezado buscado que no aparece en el archivo.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { leerFilasXlsx, indiceDeFilaEncabezado } from "../src/xlsx.js";

async function xlsxVacio(): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const buffer = await libro.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

describe("leerFilasXlsx", () => {
  it(".xlsx sin ninguna hoja -> []", async () => {
    const filas = await leerFilasXlsx(await xlsxVacio());
    expect(filas).toEqual([]);
  });

  it("lee filas de la primera hoja, con celdas vacías como string vacío", async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Hoja1");
    hoja.addRow(["Fecha", "Concepto", "Importe"]);
    hoja.addRow(["01/09/2026", "", "100,00"]);
    const buffer = await libro.xlsx.writeBuffer();

    const filas = await leerFilasXlsx(new Uint8Array(buffer));
    expect(filas).toEqual([
      ["Fecha", "Concepto", "Importe"],
      ["01/09/2026", "", "100,00"],
    ]);
  });
});

describe("indiceDeFilaEncabezado", () => {
  it("encuentra la fila (0-based) cuya celda matchea, sin importar mayúsculas/espacios", () => {
    const filas = [
      ["Banco X", "", ""],
      [" fecha ", "Concepto", "Importe"],
      ["01/09/2026", "Depósito", "100,00"],
    ];
    expect(indiceDeFilaEncabezado(filas, "Fecha")).toBe(1);
  });

  it("columna clave ausente -> -1", () => {
    const filas = [["Banco X"], ["Otra cosa"]];
    expect(indiceDeFilaEncabezado(filas, "Fecha")).toBe(-1);
  });
});
