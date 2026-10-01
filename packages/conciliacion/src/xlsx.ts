/**
 * Lectura de `.xlsx` a filas de texto crudo (I/O, `exceljs`). `server-only`
 * en el sentido de "nunca se llama desde el navegador" — quien integra este
 * paquete en una app Next.js agrega su propio `import "server-only"` en el
 * módulo que lo invoca si quiere esa garantía en build time; este paquete
 * no depende de Next.
 */
import ExcelJS from "exceljs";

/**
 * Devuelve TODAS las filas de la primera hoja como `string[][]` (celdas
 * vacías = `""`), sin descartar ninguna — el adaptador de cada banco
 * (`bancos/*.ts`) recorta desde la fila de encabezado real (algunos bancos
 * meten un título/logo arriba de la tabla).
 */
export async function leerFilasXlsx(archivo: Uint8Array | ArrayBuffer): Promise<string[][]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(archivo as ArrayBuffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];

  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila) => {
    const valores: string[] = [];
    const cantidadColumnas = Math.max(fila.cellCount, hoja.columnCount);
    for (let i = 1; i <= cantidadColumnas; i++) {
      const valor = fila.getCell(i).value;
      valores.push(valor === null || valor === undefined ? "" : String(valor).trim());
    }
    filas.push(valores);
  });
  return filas;
}

/** Busca la fila (0-based) cuyo contenido matchea el encabezado esperado — algunos bancos meten filas de título arriba de la tabla. */
export function indiceDeFilaEncabezado(filas: readonly string[][], columnaClave: string): number {
  const buscado = columnaClave.trim().toLowerCase();
  return filas.findIndex((fila) => fila.some((c) => c.trim().toLowerCase() === buscado));
}
