/**
 * Banco Santander. Formato INVENTADO. Solo CSV (sin PDF — es el banco
 * contra el que se prueba "banco no soportado en PDF -> mensaje con la
 * lista de soportados y sugerencia de CSV", ver `motor.ts#parsearExtracto`).
 *
 * CSV (`;`): línea 1 = banner `SANTANDER;CUENTA;<numero>;<moneda>`, línea 2
 * = encabezado `Fecha;Concepto;Importe;Saldo;Referencia` — a diferencia de
 * Galicia, Santander manda el importe YA con signo en una sola columna (no
 * débito/crédito separados), variante que ejercita el otro camino de
 * `parsearConMapeo`. `DD/MM/YYYY`, decimal `,`.
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { ParserExtracto, ExtractoCuenta } from "../motor.js";
import type { MapeoColumnas } from "../mapeo.js";
import { parsearFilasCsv } from "../csv.js";
import { parsearConMapeo } from "../mapeo.js";

const MAPEO: MapeoColumnas = {
  fecha: "Fecha",
  descripcion: "Concepto",
  importe: "Importe",
  saldo: "Saldo",
  referencia: "Referencia",
  formatoFecha: "DD/MM/YYYY",
  separadorDecimal: ",",
};

function esMoneda(x: string): x is Moneda {
  return x === "ARS" || x === "USD" || x === "EUR";
}

export const parserSantanderCsv: ParserExtracto = {
  banco: "santander",
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

export function detectarSantander(archivo: Uint8Array, nombreArchivo: string): boolean {
  if (/santander/i.test(nombreArchivo)) return true;
  const inicio = new TextDecoder("utf-8").decode(archivo.slice(0, 60));
  return /^SANTANDER[;\s]/i.test(inicio);
}
