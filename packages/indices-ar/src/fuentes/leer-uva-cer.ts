import type { CategoriaErrorFuente, Fetch, ResultadoFuente } from "./tipos.js";

/** Un valor de UVA o CER para un día publicado. */
export interface ValorUvaCer {
  indice: "UVA" | "CER";
  /** `"YYYY-MM-DD"`, tal cual lo publica el BCRA. */
  fecha: string;
  /** El valor publicado, como decimal string (nunca se pierde precisión pasando por `number` más de lo que ya perdió el JSON de origen). */
  valor: string;
}

/** Opciones de `leerUvaCer`. */
export interface OpcionesLeerUvaCer {
  fetch: Fetch;
  /** `"YYYY-MM-DD"`, inclusive. Sin esto, el BCRA devuelve su rango por defecto. */
  desde?: string;
  /** `"YYYY-MM-DD"`, inclusive. */
  hasta?: string;
}

export type ResultadoLeerUvaCer = ResultadoFuente<ValorUvaCer[]>;

const URL_BASE_BCRA_MONETARIAS = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias";

/** El id de variable monetaria del BCRA para cada índice (verificado contra la API real, v4.0, sep-2026). */
const ID_VARIABLE_BCRA: Record<"UVA" | "CER", number> = {
  UVA: 31, // "Unidad de valor adquisitivo (base 31.3.16=14.05)"
  CER: 30, // "Coeficiente de estabilización de referencia (base 2.2.02=1)"
};

/**
 * El BCRA nunca devuelve más de 1000 filas por respuesta (visto en
 * `metadata.resultset.limit` de la API real, v4.0, sep-2026) — más de ~2,7
 * años de valores diarios no entra en una sola página.
 */
const LIMITE_FILAS_BCRA = 1000;

/**
 * Tope de páginas a seguir por variable, puramente defensivo: si
 * `metadata.resultset` viniera con un `count` corrupto (mayor al real) o
 * el servidor no avanzara el `offset` como se espera, esto corta el bucle
 * en vez de pedir páginas para siempre. 50 páginas son 50.000 filas — más
 * de un siglo de historia diaria, nunca hace falta en la práctica.
 */
const MAX_PAGINAS = 50;

/**
 * Lee la serie histórica de UVA y CER de la API pública de Estadísticas
 * Cambiarias/Monetarias del BCRA (spec 02 §3.1: "UVA, CER — BCRA — carga
 * automática diaria").
 *
 * **Pagina automáticamente**: la API del BCRA devuelve como máximo 1000
 * filas por respuesta (`metadata.resultset.{count,offset,limit}`) — un
 * rango `desde`/`hasta` de más de ~1000 días (o sin `desde`/`hasta`, con el
 * rango por defecto del BCRA) viene en varias páginas. Esta función las
 * sigue sola, pidiendo la próxima con `offset = offset + limit` hasta
 * cubrir `count`, y devuelve la serie completa ya combinada. Si la
 * respuesta no trae `metadata.resultset` (una forma más vieja de la API, o
 * un mock de test), se toma esa única página como la serie completa — sin
 * tirar ni asumir que falta algo.
 *
 * `fetch` es SIEMPRE inyectado — este paquete nunca lee `globalThis.fetch`
 * por su cuenta, así que los tests corren sin red. **Nunca tira**: cualquier
 * falla (de red, HTTP, o de formato del cuerpo, en CUALQUIER página) vuelve
 * como `{ ok: false, categoria }`.
 *
 * @example
 * const r = await leerUvaCer({ fetch, desde: "2026-09-01", hasta: "2026-09-10" });
 * if (r.ok) {
 *   r.valores; // [{ indice: "UVA", fecha: "2026-09-01", valor: "2100.49" }, ..., { indice: "CER", ... }, ...]
 * } else {
 *   r.categoria; // "red" | "http" | "formato"
 * }
 */
export async function leerUvaCer(opciones: OpcionesLeerUvaCer): Promise<ResultadoLeerUvaCer> {
  const valores: ValorUvaCer[] = [];

  for (const indice of ["UVA", "CER"] as const) {
    const resultado = await leerUnaVariable(opciones.fetch, indice, opciones.desde, opciones.hasta);
    if (!resultado.ok) return resultado;
    valores.push(...resultado.valores);
  }

  return { ok: true, valores };
}

async function leerUnaVariable(
  fetchFn: Fetch,
  indice: "UVA" | "CER",
  desde: string | undefined,
  hasta: string | undefined,
): Promise<{ ok: true; valores: ValorUvaCer[] } | { ok: false; categoria: CategoriaErrorFuente }> {
  const valores: ValorUvaCer[] = [];
  let offset = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = armarUrl(ID_VARIABLE_BCRA[indice], desde, hasta, offset);

    let respuesta: Awaited<ReturnType<Fetch>>;
    try {
      respuesta = await fetchFn(url);
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

    const valoresPagina = parsearRespuestaBcra(cuerpo, indice);
    if (!valoresPagina) return { ok: false, categoria: "formato" };
    valores.push(...valoresPagina);

    const resultset = extraerResultset(cuerpo);
    // Sin metadata de paginación (o sin filas en esta página): esta es la
    // única/última página, no hay más que pedir.
    if (!resultset || valoresPagina.length === 0) break;

    const siguienteOffset = resultset.offset + resultset.limit;
    if (siguienteOffset >= resultset.count) break;
    offset = siguienteOffset;
  }

  return { ok: true, valores };
}

function armarUrl(idVariable: number, desde: string | undefined, hasta: string | undefined, offset = 0): string {
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (offset > 0) params.set("offset", String(offset));
  const query = params.toString();
  return `${URL_BASE_BCRA_MONETARIAS}/${idVariable}${query ? `?${query}` : ""}`;
}

/**
 * La forma de la respuesta de `.../monetarias/{id}`:
 * `{ results: [{ idVariable, detalle: [{ fecha, valor }, ...] }] }`.
 * Devuelve `null` (nunca tira) si `cuerpo` no tiene esa forma.
 */
function parsearRespuestaBcra(cuerpo: unknown, indice: "UVA" | "CER"): ValorUvaCer[] | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;

  const resultados = (cuerpo as { results?: unknown }).results;
  if (!Array.isArray(resultados) || resultados.length === 0) return null;

  const primero = resultados[0];
  if (!primero || typeof primero !== "object") return null;

  const detalle = (primero as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return null;

  const valores: ValorUvaCer[] = [];
  for (const fila of detalle) {
    if (!fila || typeof fila !== "object") return null;
    const { fecha, valor } = fila as { fecha?: unknown; valor?: unknown };
    if (typeof fecha !== "string" || typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
      return null;
    }
    valores.push({ indice, fecha, valor: String(valor) });
  }
  return valores;
}

/** La info de paginación de `metadata.resultset`, si el cuerpo la trae con esa forma. `null` si no (nunca tira). */
function extraerResultset(cuerpo: unknown): { count: number; offset: number; limit: number } | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const metadata = (cuerpo as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const resultset = (metadata as { resultset?: unknown }).resultset;
  if (!resultset || typeof resultset !== "object") return null;

  const { count, offset, limit } = resultset as { count?: unknown; offset?: unknown; limit?: unknown };
  if (
    typeof count !== "number" ||
    typeof offset !== "number" ||
    typeof limit !== "number" ||
    !Number.isFinite(count) ||
    !Number.isFinite(offset) ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return null;
  }
  return { count, offset, limit };
}
