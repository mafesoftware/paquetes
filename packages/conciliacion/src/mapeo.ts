/**
 * `parsearConMapeo` — motor GENÉRICO que convierte filas tabulares
 * (`string[][]`, ya sea de un CSV vía `csv.ts` o de un `.xlsx` vía
 * `xlsx.ts`) en líneas de extracto usando un `MapeoColumnas`. PURO: sin DB.
 *
 * `filas[0]` es el encabezado (nombres de columna tal cual el archivo); el
 * resto son datos. El mapeo referencia columnas por NOMBRE (no por
 * posición), así sirve tanto para el layout por defecto de cada banco
 * (`bancos/*.ts`) como para un mapeo manual cuando el archivo trae las
 * columnas desordenadas o con otros títulos.
 */
import { parsearFechaConFormato, parsearImporteAr } from "./csv.js";

export type MapeoColumnas = {
  fecha: string;
  descripcion: string;
  importe?: string;
  debito?: string;
  credito?: string;
  saldo?: string;
  referencia?: string;
  formatoFecha: string;
  separadorDecimal: "," | ".";
};

export type LineaExtractoSinId = {
  fecha: string;
  descripcion: string;
  importe: bigint;
  saldo: bigint | null;
  referencia: string | null;
};

export type Advertencia = { linea: number; mensaje: string };

export type ResultadoMapeo = { lineas: LineaExtractoSinId[]; advertencias: Advertencia[] };

function normalizarEncabezado(texto: string): string {
  return texto.trim().toLowerCase();
}

function indiceDeColumna(encabezado: string[], nombreColumna: string | undefined): number {
  if (!nombreColumna) return -1;
  const buscado = normalizarEncabezado(nombreColumna);
  return encabezado.findIndex((c) => normalizarEncabezado(c) === buscado);
}

/**
 * `filas` incluye el encabezado en la posición 0. Si `mapeo.importe` viene
 * seteado se usa esa columna (con signo); si no, `debito`/`credito` en
 * columnas separadas (`importe = credito - debito`, ambas positivas en el
 * archivo). El "número de línea" de las advertencias cuenta desde el
 * archivo real (encabezado = línea 1, primer dato = línea 2).
 */
export function parsearConMapeo(filas: readonly string[][], mapeo: MapeoColumnas): ResultadoMapeo {
  const encabezado = filas[0] ?? [];
  const iFecha = indiceDeColumna(encabezado, mapeo.fecha);
  const iDescripcion = indiceDeColumna(encabezado, mapeo.descripcion);
  const iImporte = indiceDeColumna(encabezado, mapeo.importe);
  const iDebito = indiceDeColumna(encabezado, mapeo.debito);
  const iCredito = indiceDeColumna(encabezado, mapeo.credito);
  const iSaldo = indiceDeColumna(encabezado, mapeo.saldo);
  const iReferencia = indiceDeColumna(encabezado, mapeo.referencia);

  const celda = (fila: string[], indice: number): string => (indice >= 0 ? (fila[indice] ?? "") : "");

  const lineas: LineaExtractoSinId[] = [];
  const advertencias: Advertencia[] = [];

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    if (!fila || fila.every((c) => c.trim() === "")) continue;

    const fecha = parsearFechaConFormato(celda(fila, iFecha), mapeo.formatoFecha);
    const descripcion = celda(fila, iDescripcion).trim();

    let importe: bigint;
    if (iImporte >= 0) {
      importe = parsearImporteAr(celda(fila, iImporte), mapeo.separadorDecimal);
    } else {
      const debito = iDebito >= 0 ? parsearImporteAr(celda(fila, iDebito), mapeo.separadorDecimal) : 0n;
      const credito = iCredito >= 0 ? parsearImporteAr(celda(fila, iCredito), mapeo.separadorDecimal) : 0n;
      // Débito/crédito vienen positivos en el archivo (columnas separadas): el signo lo pone la resta.
      importe = (credito < 0n ? -credito : credito) - (debito < 0n ? -debito : debito);
    }

    const saldoTexto = celda(fila, iSaldo);
    const saldo = iSaldo >= 0 && saldoTexto.trim() !== "" ? parsearImporteAr(saldoTexto, mapeo.separadorDecimal) : null;
    const referencia = iReferencia >= 0 ? celda(fila, iReferencia).trim() || null : null;

    const numeroLinea = f + 1; // encabezado = línea 1

    const anterior = lineas[lineas.length - 1];
    if (anterior && anterior.saldo !== null && saldo !== null) {
      const esperado = anterior.saldo + importe;
      if (esperado !== saldo) {
        advertencias.push({
          linea: numeroLinea,
          mensaje: `Saldo corrido inconsistente: saldo anterior (${anterior.saldo}) + importe (${importe}) = ${esperado}, pero el archivo dice ${saldo}.`,
        });
      }
    }

    lineas.push({ fecha, descripcion, importe, saldo, referencia });
  }

  return { lineas, advertencias };
}
