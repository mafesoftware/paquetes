/**
 * Subida directa a S3 con URL prefirmada, promoción a la clave final,
 * descarga por URL firmada con autorización POR REGISTRO y borrado en lote
 * — para los productos de MAFE Software que guardan archivos en un bucket
 * privado (consult360, ediflow, y quien más lo necesite).
 *
 * Núcleo puro en el sentido de la regla 1 de diseño del monorepo (ver
 * CLAUDE.md): el `S3Client` (de `@aws-sdk/client-s3`, peerDependency) se
 * INYECTA por parámetro en cada función — este paquete nunca lo instancia,
 * nunca lee `process.env`, y `bucket`/credenciales entran siempre por
 * argumento. El código que arma los comandos de S3 y firma las URLs vive en
 * `src/aws/` (la subcarpeta que el monorepo permite para importar
 * `@aws-sdk/*`, ver `tests/lib/verificar-paquete.ts` en la raíz).
 *
 * - `firmarSubida`: presigned POST a un prefijo temporal (`"pending/"` por
 *   omisión) — valida tipo MIME y tamaño ANTES de firmar.
 * - `promover`: copia el objeto de su clave temporal a la final y borra la
 *   temporal — rechaza traversal (`".."`, `"/"` inicial) y una clave
 *   temporal que no esté bajo el prefijo esperado.
 * - `urlFirmada`: URL de descarga firmada, autorizada por un callback
 *   `quienReferencia(clave)` que decide la APP — nunca por el prefijo de la
 *   clave (la lección de ediflow: un vecino podía leer los comprobantes de
 *   otro porque alcanzaba con ser de la misma organización). Una clave que
 *   sigue en el prefijo temporal nunca es descargable.
 * - `borrarEnLote`: hasta 1000 claves por request (el límite de
 *   `DeleteObjectsCommand`), en tantos lotes como haga falta.
 * - `sanitizarNombre`/`esClaveSegura`/`estaBajoPrefijo`: las utilidades
 *   puras de validación de claves, si la app las necesita por su cuenta.
 */
export {
  firmarSubida,
  type OpcionesFirmarSubida,
  type ResultadoFirmarSubida,
  type CodigoErrorFirmarSubida,
  promover,
  type OpcionesPromover,
  type ResultadoPromover,
  type CodigoErrorPromover,
  urlFirmada,
  type OpcionesUrlFirmada,
  type ResultadoUrlFirmada,
  borrarEnLote,
  type OpcionesBorrarEnLote,
  type ResultadoBorrarEnLote,
  type ErrorDeBorrado,
} from "./aws/index.js";
export { sanitizarNombre, esClaveSegura, estaBajoPrefijo } from "./claves.js";
