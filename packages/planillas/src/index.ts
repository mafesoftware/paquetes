/**
 * Motor genérico de importación de planillas `.xlsx` (mapeo de columnas
 * desordenadas, validación fila por fila sin abortar, idempotencia por
 * clave natural) y exportación `.csv`/`.xlsx` (separador `;`, BOM UTF-8
 * opcional, anti-inyección de fórmulas) para los productos de MAFE
 * Software.
 *
 * Núcleo puro (regla 1 de diseño del monorepo): sin `process.env`, sin
 * ninguna dependencia de framework — solo `exceljs` para leer/escribir el
 * `.xlsx`. Ver `README.md` para la API completa con ejemplos.
 */
export {
  type CeldaValor,
  type MatrizArchivo,
  leerMatriz,
  type ColumnaEsperada,
  type ResultadoMapeo,
  mapearColumnas,
  type FilaCruda,
  filasDesdeMatriz,
  type ErrorFila,
  type FilaValida,
  type ResultadoValidacion,
  type Validador,
  validarFilas,
  type ClasificacionIdempotente,
  separarPorClaveNatural,
  type VistaPrevia,
  previsualizar,
} from "./motor.js";

export { type OpcionesCsv, filasACsv } from "./csv.js";
export { filasAExcel } from "./excel.js";
