import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { generarClaveTemporal } from "../claves.js";

const PREFIJO_TEMPORAL_POR_OMISION = "pending/";
const EXPIRACION_POR_OMISION_SEG = 300;

export interface OpcionesFirmarSubida {
  /** Cliente de S3 ya configurado (región, credenciales) por quien llama — este paquete nunca lee `process.env` ni instancia uno propio. */
  cliente: S3Client;
  bucket: string;
  /** Prefijo bajo el que se sube antes de `promover` a su clave final. */
  prefijoTemporal?: string;
  tipoMime: string;
  /** Tamaño declarado por el navegador, en bytes — no confiable por sí solo; ver la nota de `Conditions` más abajo. */
  tamano: number;
  /** Nombre original del archivo; se sanea, nunca se usa tal cual. */
  nombre: string;
  mimesPermitidos: readonly string[];
  tamanoMaximo: number;
  expiraSeg?: number;
}

export type CodigoErrorFirmarSubida = "mime_no_permitido" | "tamano_excedido";

export type ResultadoFirmarSubida =
  | { ok: true; url: string; campos: Record<string, string>; clave: string }
  | { ok: false; error: { codigo: CodigoErrorFirmarSubida; mensaje: string } };

/**
 * Presigned POST a `prefijoTemporal` (`"pending/"` por omisión): el
 * navegador sube DIRECTO a S3 con esta URL/campos, sin pasar el archivo por
 * el server. Valida tipo MIME y tamaño ANTES de firmar nada — nunca tira,
 * devuelve `{ ok: false, error }` (regla del monorepo, ver CLAUDE.md).
 *
 * - `mime_no_permitido`: `tipoMime` no está en `mimesPermitidos` (lista
 *   cerrada — sin ella, cualquier tipo podría subir un `.html`/`.svg` que el
 *   navegador ejecute si algún día se sirve sin `Content-Disposition`).
 * - `tamano_excedido`: `tamano` no es un número finito positivo, o supera
 *   `tamanoMaximo`.
 *
 * El tamaño declarado por el navegador es solo la ENTRADA de esta
 * validación — la condición `content-length-range` que S3 aplica de
 * verdad al aceptar el POST (0..`tamanoMaximo`) es la que importa contra
 * un cliente que mienta el `tamano` al llamar a esta función; el
 * `Content-Type` queda fijo en la política (una condición `eq`), así que
 * el navegador no puede subir con un tipo distinto al validado acá.
 */
export async function firmarSubida(opciones: OpcionesFirmarSubida): Promise<ResultadoFirmarSubida> {
  const {
    cliente,
    bucket,
    prefijoTemporal = PREFIJO_TEMPORAL_POR_OMISION,
    tipoMime,
    tamano,
    nombre,
    mimesPermitidos,
    tamanoMaximo,
    expiraSeg = EXPIRACION_POR_OMISION_SEG,
  } = opciones;

  if (!mimesPermitidos.includes(tipoMime)) {
    return {
      ok: false,
      error: {
        codigo: "mime_no_permitido",
        mensaje: `El tipo "${tipoMime}" no está permitido (permitidos: ${mimesPermitidos.join(", ")}).`,
      },
    };
  }

  if (!Number.isFinite(tamano) || tamano <= 0 || tamano > tamanoMaximo) {
    return {
      ok: false,
      error: {
        codigo: "tamano_excedido",
        mensaje: `El archivo (${tamano} bytes) supera el máximo permitido (${tamanoMaximo} bytes).`,
      },
    };
  }

  const clave = generarClaveTemporal(prefijoTemporal, nombre);

  const { url, fields } = await createPresignedPost(cliente, {
    Bucket: bucket,
    Key: clave,
    Conditions: [
      ["content-length-range", 0, tamanoMaximo],
      ["eq", "$Content-Type", tipoMime],
    ],
    Fields: { "Content-Type": tipoMime },
    Expires: expiraSeg,
  });

  return { ok: true, url, campos: fields, clave };
}
