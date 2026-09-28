import { S3Client } from "@aws-sdk/client-s3";

/**
 * Un `S3Client` REAL (no un objeto plano): `createPresignedPost` y
 * `getSignedUrl` piden ese tipo exacto, y firman/computan la URL LOCALMENTE
 * (SigV4 + una policy en base64) sin ninguna llamada de red — sirven con
 * credenciales y región de mentira. `promover`/`borrarEnLote`, que sí
 * llaman a `cliente.send(...)`, reemplazan `send` por un mock en sus propios
 * tests (nunca se llega a la red real tampoco ahí).
 */
export function clienteDePrueba(): S3Client {
  return new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "clave-de-prueba", secretAccessKey: "secreto-de-prueba" },
  });
}
