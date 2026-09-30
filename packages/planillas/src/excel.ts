/**
 * `.xlsx` genérico para exportaciones de reportes: cada reporte de la app
 * que consume este paquete solo arma encabezados + filas, sin repetir el
 * `Workbook`/`writeBuffer` de `exceljs`.
 */
import ExcelJS from "exceljs";

/** Arma un `.xlsx` de una sola hoja a partir de encabezados + filas ya formateadas. */
export async function filasAExcel(
  nombreHoja: string,
  encabezados: readonly string[],
  filas: readonly (readonly (string | number)[])[],
): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(nombreHoja);
  hoja.addRow([...encabezados]);
  for (const fila of filas) hoja.addRow([...fila]);
  const buffer = await libro.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
