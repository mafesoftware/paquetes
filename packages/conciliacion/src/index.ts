/**
 * Conciliación bancaria argentina: parseo de extractos (CSV/XLSX/PDF, 6
 * bancos con formato invertado documentado inline) + motor de sugerencia de
 * matches contra los movimientos conciliables del sistema que integra este
 * paquete — extraído de Obriq (spec de conciliación, tareas 4.27/4.28).
 *
 * Núcleo puro para el matching (`sugerir.ts`/`combinaciones.ts`/
 * `clasificar.ts`): sin DB, sin framework, `bigint` para plata (centavos
 * con signo). `motor.ts`/`xlsx.ts`/`pdf.ts` hacen I/O de archivo (lectura
 * de `.xlsx`/`.pdf`) — nada de red ni de disco por su cuenta, reciben el
 * archivo ya en memoria (`Uint8Array`).
 *
 * - `parsearExtracto`/`detectarBanco`/`bancosSoportados`: punto de entrada
 *   del parseo (`motor.ts`).
 * - `sugerirMatches`: motor de sugerencias de conciliación.
 * - `clasificarSoloExtracto`: clasifica una línea sin contraparte (impuesto,
 *   comisión, interés bancario).
 * - `parsearFilasCsv`/`parsearImporteAr`/`parsearFechaConFormato`/
 *   `parsearConMapeo`: utilidades de bajo nivel, por si hace falta un
 *   mapeo manual (columnas desordenadas o un banco no soportado acá).
 */

export {
  parsearExtracto,
  detectarBanco,
  bancosSoportados,
  bancosConFormato,
  type ParserExtracto,
  type ExtractoCuenta,
  type LineaExtracto,
  type Advertencia,
  type FormatoExtracto,
  type OpcionesParsearExtracto,
} from "./motor.js";

export { parsearFilasCsv, parsearImporteAr, parsearFechaConFormato } from "./csv.js";

export { parsearConMapeo, type MapeoColumnas, type LineaExtractoSinId, type ResultadoMapeo } from "./mapeo.js";

export { leerFilasXlsx, indiceDeFilaEncabezado } from "./xlsx.js";

export { extraerLineasPdf, type OpcionesExtraerPdf } from "./pdf.js";

export {
  sugerirMatches,
  type LineaExtracto as LineaExtractoConciliable,
  type MovConciliable,
  type ReglaSugerencia,
  type Sugerencia,
  type OpcionesSugerir,
} from "./sugerir.js";

export { buscarCombinacion } from "./combinaciones.js";

export { clasificarSoloExtracto, REGLAS_CLASIFICACION_DEFECTO, type ReglaClasificacion } from "./clasificar.js";

export {
  parserGaliciaCsv,
  parserGaliciaPdf,
  detectarGalicia,
  parserSantanderCsv,
  detectarSantander,
  parserBbvaXlsx,
  detectarBbva,
  parserMacroCsv,
  detectarMacro,
  parserNacionCsv,
  detectarNacion,
  parserProvinciaCsv,
  detectarProvincia,
} from "./bancos/index.js";
