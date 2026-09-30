import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { filasAExcel } from "../src/excel.js";

describe("filasAExcel", () => {
  it("arma un .xlsx de una sola hoja con encabezados + filas, legible por exceljs", async () => {
    const buffer = await filasAExcel("Reporte", ["Código", "Nombre", "Monto"], [
      ["1", "Cemento", 1500],
      ["2", "Arena", 2000.5],
    ]);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0];

    expect(hoja?.name).toBe("Reporte");
    expect(hoja?.getRow(1).values).toEqual([undefined, "Código", "Nombre", "Monto"]);
    expect(hoja?.getRow(2).values).toEqual([undefined, "1", "Cemento", 1500]);
    expect(hoja?.getRow(3).values).toEqual([undefined, "2", "Arena", 2000.5]);
  });

  it("sin filas, arma la hoja solo con el encabezado", async () => {
    const buffer = await filasAExcel("Vacío", ["a", "b"], []);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0];

    expect(hoja?.rowCount).toBe(1);
  });

  it("devuelve un Uint8Array (no un Buffer de Node crudo)", async () => {
    const buffer = await filasAExcel("Hoja", ["a"], [["1"]]);

    expect(buffer).toBeInstanceOf(Uint8Array);
  });
});
