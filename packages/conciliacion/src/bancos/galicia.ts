/**
 * Banco Galicia. Formato INVENTADO (no hay diseño de registro oficial
 * publicado por el banco para esto — documentado acá a partir de la forma
 * típica de un export de home banking argentino). Galicia es el único
 * banco con soporte de **PDF** de este paquete (multicuenta ARS/USD +
 * contraseña) — el resto queda en CSV/XLSX, ver `motor.ts#bancosConFormato("pdf")`.
 *
 * CSV (`;`): línea 1 = banner `GALICIA;CUENTA;<numero>;<moneda>`, línea 2 =
 * encabezado (`Fecha;Descripcion;Debito;Credito;Saldo;Referencia`), resto
 * datos. `DD/MM/YYYY`, decimal `,`.
 *
 * PDF: una línea `Cuenta <numero> <moneda>` abre cada sección de cuenta,
 * seguida del encabezado y de filas con los campos separados por `|`
 * (simplificación deliberada: el texto que devuelve `pdfjs` no conserva
 * columnas alineadas por posición, así que el extracto de ejemplo usa un
 * separador explícito en vez de heurística de columnas fijas).
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { ParserExtracto, ExtractoCuenta } from "../motor.js";
import type { MapeoColumnas } from "../mapeo.js";
import { parsearFilasCsv } from "../csv.js";
import { parsearConMapeo } from "../mapeo.js";
import { extraerLineasPdf } from "../pdf.js";

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

export const parserGaliciaCsv: ParserExtracto = {
  banco: "galicia",
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

const RE_CUENTA = /^Cuenta\s+(\S+)\s+(ARS|USD|EUR)$/i;

export const parserGaliciaPdf: ParserExtracto = {
  banco: "galicia",
  formato: "pdf",
  async parsear(archivo, opciones) {
    const paginas = await extraerLineasPdf(archivo, { contrasena: opciones?.contrasena });
    const lineas = paginas.flat();

    const extractos: ExtractoCuenta[] = [];
    let cuentaActual: string | null = null;
    let monedaActual: Moneda = "ARS";
    let filasActual: string[][] = [];

    const cerrarSeccion = () => {
      if (cuentaActual === null) return;
      const { lineas: lineasParseadas, advertencias } = parsearConMapeo(filasActual, MAPEO);
      const extracto: ExtractoCuenta = { cuenta: cuentaActual, moneda: monedaActual, lineas: lineasParseadas };
      if (advertencias.length) extracto.advertencias = advertencias;
      extractos.push(extracto);
    };

    for (const linea of lineas) {
      const matchCuenta = linea.match(RE_CUENTA);
      if (matchCuenta) {
        cerrarSeccion();
        cuentaActual = matchCuenta[1] ?? "";
        monedaActual = esMoneda(matchCuenta[2]?.toUpperCase() ?? "") ? (matchCuenta[2]!.toUpperCase() as Moneda) : "ARS";
        filasActual = [];
        continue;
      }
      if (cuentaActual === null) continue; // texto antes de la primera cuenta (título del extracto)
      if (!linea.includes("|")) continue; // línea decorativa sin datos tabulares
      filasActual.push(linea.split("|").map((c) => c.trim()));
    }
    cerrarSeccion();

    return extractos;
  },
};

export function detectarGalicia(archivo: Uint8Array, nombreArchivo: string): boolean {
  if (/galicia/i.test(nombreArchivo)) return true;
  const inicio = new TextDecoder("utf-8").decode(archivo.slice(0, 60));
  return /^GALICIA[;\s]/i.test(inicio);
}
