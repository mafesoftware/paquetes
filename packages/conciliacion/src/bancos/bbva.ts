/**
 * BBVA. Formato INVENTADO. Solo `.xlsx`: es el único banco de la lista que
 * ejercita `xlsx.ts`.
 *
 * Layout: título + banner ("Cuenta:", numero, moneda) arriba de la tabla
 * real (bastante común en exports de home banking) — por eso
 * `indiceDeFilaEncabezado` recorta desde la fila que dice "Fecha", en vez
 * de asumir que el encabezado es la fila 0 como en el CSV. Encabezado:
 * `Fecha | Concepto | Importe | Saldo`. `DD/MM/YYYY`, decimal `,`.
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { ParserExtracto, ExtractoCuenta } from "../motor.js";
import type { MapeoColumnas } from "../mapeo.js";
import { parsearConMapeo } from "../mapeo.js";
import { leerFilasXlsx, indiceDeFilaEncabezado } from "../xlsx.js";

const MAPEO: MapeoColumnas = {
  fecha: "Fecha",
  descripcion: "Concepto",
  importe: "Importe",
  saldo: "Saldo",
  formatoFecha: "DD/MM/YYYY",
  separadorDecimal: ",",
};

function esMoneda(x: string): x is Moneda {
  return x === "ARS" || x === "USD" || x === "EUR";
}

export const parserBbvaXlsx: ParserExtracto = {
  banco: "bbva",
  formato: "xlsx",
  async parsear(archivo) {
    const filas = await leerFilasXlsx(archivo);

    const filaBanner = filas.find((f) => f.some((c) => c.trim().toLowerCase() === "cuenta:"));
    const iBanner = filaBanner ? filaBanner.findIndex((c) => c.trim().toLowerCase() === "cuenta:") : -1;
    const cuenta = filaBanner && iBanner >= 0 ? (filaBanner[iBanner + 1] ?? "").trim() : "";
    const monedaCruda = filaBanner && iBanner >= 0 ? (filaBanner[iBanner + 2] ?? "").trim() : "ARS";
    const moneda: Moneda = esMoneda(monedaCruda) ? monedaCruda : "ARS";

    const iEncabezado = indiceDeFilaEncabezado(filas, "Fecha");
    const tabla = iEncabezado >= 0 ? filas.slice(iEncabezado) : [];

    const { lineas, advertencias } = parsearConMapeo(tabla, MAPEO);
    const extracto: ExtractoCuenta = { cuenta, moneda, lineas };
    if (advertencias.length) extracto.advertencias = advertencias;
    return [extracto];
  },
};

export function detectarBbva(_archivo: Uint8Array, nombreArchivo: string): boolean {
  return /bbva/i.test(nombreArchivo);
}
