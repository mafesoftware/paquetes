import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { esClaveSegura, estaBajoPrefijo } from "../claves.js";

const PREFIJO_TEMPORAL_POR_OMISION = "pending/";

export interface OpcionesPromover {
  cliente: S3Client;
  bucket: string;
  claveTemporal: string;
  claveFinal: string;
  /** Tiene que coincidir con el que se usó al firmar la subida (`firmarSubida`). */
  prefijoTemporal?: string;
}

export type CodigoErrorPromover = "clave_invalida";

export type ResultadoPromover =
  | {
      ok: true;
      /**
       * `ContentType` REAL del objeto ya promovido (`HeadObject` sobre la
       * clave final), no el que declaró el cliente al pedir la subida. `null`
       * si S3 no lo informa.
       */
      tipoMime: string | null;
      /** `ContentLength` REAL del objeto ya promovido, en bytes. `null` si S3 no lo informa. */
      tamanoBytes: number | null;
    }
  | { ok: false; error: { codigo: CodigoErrorPromover; mensaje: string } };

/**
 * Copia el objeto de `claveTemporal` a `claveFinal` y borra la temporal —
 * "promueve" un archivo recién subido (`firmarSubida`) a su lugar
 * definitivo, y devuelve el `tipoMime`/`tamanoBytes` REALES del objeto
 * (`HeadObject` sobre la clave final) para que la app guarde esos y no los
 * que declaró el cliente. Nunca tira: una clave inválida se devuelve como
 * `{ ok: false, error }`, nunca se manda a S3.
 *
 * Rechaza (`codigo: "clave_invalida"`):
 * - `claveTemporal` que no esté bajo `prefijoTemporal`: promover CUALQUIER
 *   clave que alguien pase (no solo lo que `firmarSubida` generó bajo el
 *   prefijo esperado) abriría copiar cualquier objeto del bucket a donde
 *   quien llama decida.
 * - `claveFinal` que SIGA bajo `prefijoTemporal`: dejaría un archivo
 *   "promovido" que `urlFirmada` trataría igual que uno recién subido (ver
 *   su regla de nunca servir lo que está en el prefijo temporal).
 * - cualquiera de las dos claves con un segmento ".." o que arranque con
 *   "/" (traversal — ver `esClaveSegura`).
 */
export async function promover(opciones: OpcionesPromover): Promise<ResultadoPromover> {
  const { cliente, bucket, claveTemporal, claveFinal, prefijoTemporal = PREFIJO_TEMPORAL_POR_OMISION } = opciones;

  if (!esClaveSegura(claveTemporal) || !estaBajoPrefijo(claveTemporal, prefijoTemporal)) {
    return {
      ok: false,
      error: {
        codigo: "clave_invalida",
        mensaje: `"${claveTemporal}" no es una clave temporal válida bajo el prefijo "${prefijoTemporal}".`,
      },
    };
  }

  if (!esClaveSegura(claveFinal) || estaBajoPrefijo(claveFinal, prefijoTemporal)) {
    return {
      ok: false,
      error: {
        codigo: "clave_invalida",
        mensaje: `"${claveFinal}" no es una clave final válida.`,
      },
    };
  }

  // CopySource va con el bucket adelante y cada segmento de la clave
  // codificado por separado (no la clave entera de una vez: eso codificaría
  // también las "/" que separan los segmentos, y CopySource necesita verlas).
  const origen = `${bucket}/${claveTemporal
    .split("/")
    .map((segmento) => encodeURIComponent(segmento))
    .join("/")}`;

  await cliente.send(new CopyObjectCommand({ Bucket: bucket, CopySource: origen, Key: claveFinal }));
  // Los metadatos que la app guarde salen del objeto REAL, no de lo que
  // declaró el navegador: se leen de la clave final (lo que va a quedar) y
  // antes de borrar la temporal (si esto falla, el archivo sigue en pending/
  // y el reintento es posible).
  const cabecera = await cliente.send(new HeadObjectCommand({ Bucket: bucket, Key: claveFinal }));
  await cliente.send(new DeleteObjectCommand({ Bucket: bucket, Key: claveTemporal }));

  return { ok: true, tipoMime: cabecera.ContentType ?? null, tamanoBytes: cabecera.ContentLength ?? null };
}
