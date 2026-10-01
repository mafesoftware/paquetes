/**
 * Banco Nación. Formato INVENTADO. Solo CSV.
 *
 * CSV (`;`): línea 1 = banner `NACION;CUENTA;<numero>;<moneda>`, línea 2 =
 * encabezado `Fecha;Descripcion;Importe;Saldo;Referencia`. A diferencia de
 * los demás bancos de este paquete usa fecha `YYYY-MM-DD` y **decimal
 * `.`** (variante de `separadorDecimal`) — el separador de miles es
 * entonces `,` (`"1,234,567.89"`).
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { ParserExtracto, ExtractoCuenta } from "../motor.js";
import type { MapeoColumnas } from "../mapeo.js";
import { parsearFilasCsv } from "../csv.js";
import { parsearConMapeo } from "../mapeo.js";

const MAPEO: MapeoColumnas = {
  fecha: "Fecha",
  descripcion: "Descripcion",
  importe: "Importe",
  saldo: "Saldo",
  referencia: "Referencia",
  formatoFecha: "YYYY-MM-DD",
  separadorDecimal: ".",
};

function esMoneda(x: string): x is Moneda {
  return x === "ARS" || x === "USD" || x === "EUR";
}

export const parserNacionCsv: ParserExtracto = {
  banco: "nacion",
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

export function detectarNacion(archivo: Uint8Array, nombreArchivo: string): boolean {
  if (/naci[oó]n|\bbna\b/i.test(nombreArchivo)) return true;
  const inicio = new TextDecoder("utf-8").decode(archivo.slice(0, 60));
  return /^NACION[;\s]/i.test(inicio);
}
