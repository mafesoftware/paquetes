/**
 * `parserBbvaXlsx` — ramas de moneda/banner que el fixture golden no
 * ejercita: el fixture siempre trae la fila "Cuenta:" con moneda ARS. Acá se
 * arman workbooks a mano (`exceljs`, ya dependencia del paquete) con otras
 * monedas y sin fila de banner.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parserBbvaXlsx } from "../src/bancos/bbva.js";

async function workbookConFilas(filas: string[][]): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Hoja1");
  for (const fila of filas) hoja.addRow(fila);
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

describe("parserBbvaXlsx — moneda y banner", () => {
  it("moneda USD en la fila de banner", async () => {
    const archivo = await workbookConFilas([
      ["Cuenta:", "123-456", "USD"],
      ["Fecha", "Concepto", "Importe", "Saldo"],
    ]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.moneda).toBe("USD");
  });

  it("moneda EUR en la fila de banner", async () => {
    const archivo = await workbookConFilas([
      ["Cuenta:", "123-456", "EUR"],
      ["Fecha", "Concepto", "Importe", "Saldo"],
    ]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.moneda).toBe("EUR");
  });

  it("moneda no reconocida -> ARS por defecto", async () => {
    const archivo = await workbookConFilas([
      ["Cuenta:", "123-456", "XXX"],
      ["Fecha", "Concepto", "Importe", "Saldo"],
    ]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.moneda).toBe("ARS");
  });

  it('sin fila "Cuenta:" en el archivo -> cuenta vacía, moneda ARS por defecto', async () => {
    const archivo = await workbookConFilas([["Fecha", "Concepto", "Importe", "Saldo"]]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.cuenta).toBe("");
    expect(extracto?.moneda).toBe("ARS");
  });

  it('"Cuenta:" es la última celda de su fila (sin número ni moneda después) -> cuenta vacía, moneda ARS por defecto', async () => {
    const archivo = await workbookConFilas([["Cuenta:"], ["Fecha", "Concepto", "Importe", "Saldo"]]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.cuenta).toBe("");
    expect(extracto?.moneda).toBe("ARS");
  });

  it('sin ninguna fila "Fecha" (encabezado real no encontrado) -> tabla vacía, sin líneas', async () => {
    const archivo = await workbookConFilas([["Cuenta:", "123-456", "ARS"], ["Movimientos", "", "", ""]]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.lineas).toEqual([]);
  });

  it("saldo corrido inconsistente -> el extracto trae `advertencias`", async () => {
    const archivo = await workbookConFilas([
      ["Cuenta:", "123-456", "ARS"],
      ["Fecha", "Concepto", "Importe", "Saldo"],
      ["01/09/2026", "Depósito", "100,00", "1000,00"],
      ["02/09/2026", "Extracción", "-50,00", "800,00"],
    ]);
    const [extracto] = await parserBbvaXlsx.parsear(archivo);
    expect(extracto?.advertencias).toHaveLength(1);
  });
});
