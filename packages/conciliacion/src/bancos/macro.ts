/**
 * Banco Macro. Formato INVENTADO. Solo CSV — **sin** parser de PDF a
 * propósito.
 *
 * CSV (`;`): línea 1 = banner `MACRO;CUENTA;<numero>;<moneda>`, línea 2 =
 * encabezado con las columnas EN OTRO ORDEN que Galicia/Provincia
 * (`Referencia;Saldo;Credito;Debito;Descripcion;Fecha`). Como
 * `parsearConMapeo` busca cada columna por NOMBRE (no por posición), el
 * `MAPEO` de acá es idéntico al de Galicia: sirve para probar "CSV con
 * columnas desordenadas" sin atarlo a un banco en particular. `DD/MM/YYYY`,
 * decimal `,`.
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { ParserExtracto, ExtractoCuenta } from "../motor.js";
import type { MapeoColumnas } from "../mapeo.js";
import { parsearFilasCsv } from "../csv.js";
import { parsearConMapeo } from "../mapeo.js";

const MAPEO: MapeoColumnas = {
  fecha: "Fecha",
  descripcion: "Descripcion",
  debito: "Debito",
  credito: "Credito",
  saldo: "Saldo",
  referencia: "Referencia",
  formatoFecha: "DD/MM/YYYY",
  separadorDecimal: ",",
};

function esMoneda(x: string): x is Moneda {
  return x === "ARS" || x === "USD" || x === "EUR";
}

export const parserMacroCsv: ParserExtracto = {
  banco: "macro",
  formato: "csv",
  async parsear(archivo) {
    const texto = new TextDecoder("utf-8").decode(archivo);
    const filas = parsearFilasCsv(texto, ";");
    const banner = filas[0] ?? [];
    const cuenta = banner[2] ?? "";
    const monedaCruda = banner[3] ?? "ARS";
    const moneda: Moneda = esMoneda(monedaCruda) ? monedaCruda : "ARS";
    const tabla = filas.slice(1);

    const { lineas, advertencias } = parsearConMapeo(tabla, MAPEO);
    const extracto: ExtractoCuenta = { cuenta, moneda, lineas };
    if (advertencias.length) extracto.advertencias = advertencias;
    return [extracto];
  },
};

export function detectarMacro(archivo: Uint8Array, nombreArchivo: string): boolean {
  if (/macro/i.test(nombreArchivo)) return true;
  const inicio = new TextDecoder("utf-8").decode(archivo.slice(0, 60));
  return /^MACRO[;\s]/i.test(inicio);
}
