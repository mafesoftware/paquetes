/**
 * Banco Provincia / Bapro. Formato INVENTADO. Solo CSV.
 *
 * CSV (`;`): línea 1 = banner `PROVINCIA;CUENTA;<numero>;<moneda>`, línea 2
 * = encabezado `Fecha;Descripcion;Debito;Credito;Saldo;Referencia`. Fecha
 * `DD-MM-YYYY` (con guion, no barra — otra variante de `formatoFecha`),
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
  formatoFecha: "DD-MM-YYYY",
  separadorDecimal: ",",
};

function esMoneda(x: string): x is Moneda {
  return x === "ARS" || x === "USD" || x === "EUR";
}

export const parserProvinciaCsv: ParserExtracto = {
  banco: "provincia",
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

export function detectarProvincia(archivo: Uint8Array, nombreArchivo: string): boolean {
  if (/provincia|bapro/i.test(nombreArchivo)) return true;
  const inicio = new TextDecoder("utf-8").decode(archivo.slice(0, 60));
  return /^PROVINCIA[;\s]/i.test(inicio);
}
