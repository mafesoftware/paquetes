import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";

/** Límite de `DeleteObjectsCommand` por request — no lo decide este paquete, lo impone la API de S3. */
const MAX_POR_LOTE = 1000;

export interface OpcionesBorrarEnLote {
  cliente: S3Client;
  bucket: string;
  claves: readonly string[];
}

export interface ErrorDeBorrado {
  clave: string;
  codigo?: string;
  mensaje?: string;
}

export interface ResultadoBorrarEnLote {
  ok: true;
  /** Cuántas de `claves` se borraron de verdad (según lo que informa cada respuesta de S3, no simplemente `claves.length`). */
  borradas: number;
  /** Las que S3 NO pudo borrar (p. ej. sin permiso sobre una clave puntual) — la operación sigue siendo `ok: true`: es un resultado parcial, no un error de negocio. */
  errores: ErrorDeBorrado[];
}

function enLotesDe<T>(items: readonly T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let inicio = 0; inicio < items.length; inicio += tamano) {
    lotes.push(items.slice(inicio, inicio + tamano));
  }
  return lotes;
}

/**
 * Borra `claves` del bucket, en tantos requests de hasta 1000 claves como
 * haga falta (`DeleteObjectsCommand` no acepta más por llamada). Con
 * `claves` vacío, devuelve `{ ok: true, borradas: 0, errores: [] }` sin
 * llamar a S3 para nada.
 *
 * Siempre `ok: true`: un borrado parcial (algunas claves sin permiso, ya
 * borradas por otro proceso, etc.) se informa en `errores`, no se tira —
 * es información sobre el RESULTADO de la operación, no un error de
 * validación de entrada como los de `firmarSubida`/`promover`.
 */
export async function borrarEnLote(opciones: OpcionesBorrarEnLote): Promise<ResultadoBorrarEnLote> {
  const { cliente, bucket, claves } = opciones;

  let borradas = 0;
  const errores: ErrorDeBorrado[] = [];

  for (const lote of enLotesDe(claves, MAX_POR_LOTE)) {
    const respuesta = await cliente.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: lote.map((Key) => ({ Key })), Quiet: false },
      }),
    );
    borradas += respuesta.Deleted?.length ?? 0;
    for (const error of respuesta.Errors ?? []) {
      errores.push({ clave: error.Key ?? "", codigo: error.Code, mensaje: error.Message });
    }
  }

  return { ok: true, borradas, errores };
}
