import type { Fetch, ResultadoFuente } from "./tipos.js";

/** Las casas de dolarapi.com que le interesan al producto (spec 02 §2: "oficial, MEP, CCL, blue"). */
export type CasaCotizacion = "oficial" | "blue" | "mep" | "ccl";

/** Una cotización de compra/venta para una casa, del día. */
export interface Cotizacion {
  casa: CasaCotizacion;
  /** Como decimal string (nunca se pierde precisión pasando por `number` más de lo que ya perdió el JSON de origen). */
  compra: string;
  venta: string;
  /** El instante ISO que informa la fuente (`fechaActualizacion` de dolarapi). */
  fecha: string;
}

export interface OpcionesLeerCotizaciones {
  fetch: Fetch;
}

export type ResultadoLeerCotizaciones = ResultadoFuente<Cotizacion[]>;

const URL_DOLARAPI = "https://dolarapi.com/v1/dolares";

/**
 * El nombre de "casa" de dolarapi.com -> el código que usa este paquete.
 * Una casa que no está acá (`mayorista`, `cripto`, `tarjeta`...) se
 * IGNORA, no es un error de formato: dolarapi puede agregar casas nuevas
 * sin que este paquete se rompa.
 */
const CASA_A_CODIGO: Record<string, CasaCotizacion> = {
  oficial: "oficial",
  blue: "blue",
  bolsa: "mep",
  contadoconliqui: "ccl",
};

/**
 * Lee las cotizaciones del dólar de dolarapi.com (spec 02 §2: "Carga
 * automática diaria por cron desde una API pública (ej. dolarapi /
 * BCRA)"), filtradas a las cuatro casas que usa el producto: oficial, blue,
 * MEP (`"bolsa"` en dolarapi) y CCL (`"contadoconliqui"` en dolarapi).
 *
 * `fetch` es SIEMPRE inyectado. **Nunca tira**: cualquier falla vuelve como
 * `{ ok: false, categoria }`.
 *
 * @example
 * const r = await leerCotizaciones({ fetch });
 * if (r.ok) {
 *   r.valores; // [{ casa: "oficial", compra: "1500", venta: "1550", fecha: "2026-09-28T14:00:00.000Z" }, ...]
 * }
 */
export async function leerCotizaciones(opciones: OpcionesLeerCotizaciones): Promise<ResultadoLeerCotizaciones> {
  let respuesta: Awaited<ReturnType<Fetch>>;
  try {
    respuesta = await opciones.fetch(URL_DOLARAPI);
  } catch {
    return { ok: false, categoria: "red" };
  }

  if (!respuesta.ok) return { ok: false, categoria: "http" };

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return { ok: false, categoria: "formato" };
  }

  if (!Array.isArray(cuerpo)) return { ok: false, categoria: "formato" };

  const valores: Cotizacion[] = [];
  for (const item of cuerpo) {
    if (!item || typeof item !== "object") return { ok: false, categoria: "formato" };

    const { casa, compra, venta, fechaActualizacion } = item as Record<string, unknown>;
    if (typeof casa !== "string") return { ok: false, categoria: "formato" };

    const codigo = CASA_A_CODIGO[casa];
    if (!codigo) continue; // casa que no nos interesa: no es un error de formato.

    if (
      typeof compra !== "number" ||
      typeof venta !== "number" ||
      !Number.isFinite(compra) ||
      !Number.isFinite(venta) ||
      typeof fechaActualizacion !== "string"
    ) {
      return { ok: false, categoria: "formato" };
    }

    valores.push({ casa: codigo, compra: String(compra), venta: String(venta), fecha: fechaActualizacion });
  }

  return { ok: true, valores };
}
