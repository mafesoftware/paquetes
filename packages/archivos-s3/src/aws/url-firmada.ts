import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { estaBajoPrefijo } from "../claves.js";

const EXPIRACION_POR_OMISION_SEG = 300;
const PREFIJO_TEMPORAL_POR_OMISION = "pending/";

function sonElMismo<Dueno>(a: Dueno, b: Dueno): boolean {
  return a === b;
}

export interface OpcionesUrlFirmada<Dueno> {
  cliente: S3Client;
  bucket: string;
  clave: string;
  expiraSeg?: number;
  /** Tiene que coincidir con el que se usó al firmar la subida — una clave que sigue acá nunca es descargable (ver abajo). */
  prefijoTemporal?: string;
  /**
   * Autorización POR REGISTRO (nunca por prefijo — la lección de ediflow:
   * ahí un vecino podía leer los comprobantes de otro porque alcanzaba con
   * ser de la misma organización). La app decide qué significa "dueño":
   * devuelve quien referencia `clave` desde su propio esquema (un
   * `organizacionId`, un `{ organizacionId, tipo }`, lo que corresponda), o
   * `null` si ningún registro la referencia todavía.
   */
  quienReferencia: (clave: string) => Dueno | null | Promise<Dueno | null>;
  /** Quién pide la URL — se compara contra lo que devuelve `quienReferencia`. */
  solicitante: Dueno;
  /** Por omisión, `===`. Se pasa explícito cuando "dueño" es un objeto (comparar por sus campos, no por identidad de referencia). */
  compararSolicitante?: (dueno: Dueno, solicitante: Dueno) => boolean;
}

export type ResultadoUrlFirmada = { ok: true; url: string } | { ok: false; codigo: "no_encontrado" };

/**
 * URL de descarga firmada (GET), autorizada por registro. Nunca tira.
 *
 * Devuelve `{ ok: false, codigo: "no_encontrado" }` (nunca 403: no hay que
 * revelar si la clave existe) en cualquiera de estos casos:
 * - `clave` sigue bajo `prefijoTemporal` — un archivo recién subido y
 *   todavía no promovido (`promover`) no está referenciado por ningún
 *   registro de la app, así que tampoco tendría dueño; se corta ACÁ, antes
 *   de llamar a `quienReferencia`, para que esa regla no dependa de que la
 *   app la implemente bien.
 * - `quienReferencia(clave)` devuelve `null`/`undefined`: ningún registro
 *   referencia esa clave.
 * - el dueño que devuelve no es el mismo que `solicitante`, según
 *   `compararSolicitante` (por omisión, `===`).
 */
export async function urlFirmada<Dueno>(opciones: OpcionesUrlFirmada<Dueno>): Promise<ResultadoUrlFirmada> {
  const {
    cliente,
    bucket,
    clave,
    expiraSeg = EXPIRACION_POR_OMISION_SEG,
    prefijoTemporal = PREFIJO_TEMPORAL_POR_OMISION,
    quienReferencia,
    solicitante,
    compararSolicitante = sonElMismo,
  } = opciones;

  if (estaBajoPrefijo(clave, prefijoTemporal)) {
    return { ok: false, codigo: "no_encontrado" };
  }

  const dueno = await quienReferencia(clave);
  if (dueno === null || dueno === undefined || !compararSolicitante(dueno, solicitante)) {
    return { ok: false, codigo: "no_encontrado" };
  }

  const url = await getSignedUrl(cliente, new GetObjectCommand({ Bucket: bucket, Key: clave }), {
    expiresIn: expiraSeg,
  });
  return { ok: true, url };
}
