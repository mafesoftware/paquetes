/**
 * Primitivas de seguridad comunes a los productos de MAFE Software: lo que
 * store360, consult360, facturar, distrigo y alquileres-app reimplementaban
 * cada uno por su lado (comparación en tiempo constante, cifrado AES-256-GCM,
 * pases firmados con vencimiento) o dejaban directamente sin hacer.
 *
 * Núcleo puro: no lee variables de entorno, sin framework — las claves y
 * secretos entran por parámetro. Lo específico de Next.js (CSP, cabeceras, auth de
 * cron, `guard()`) vive en el subpath `@mafesoftware/seguridad/next`, que NO
 * se importa desde acá (`next` es un peerDependency opcional solo de ese
 * subpath).
 *
 * - `comparar.ts`: `compararEnTiempoConstante`.
 * - `cifrado.ts`: `cifrar`, `descifrar` (AES-256-GCM versionado, formato
 *   compatible con `fiscalCifrado.ts` de store360).
 * - `pases.ts`: `crearPase`, `verificarPase` (reset de contraseña,
 *   invitaciones, magic links — firmados, sin tabla).
 * - `uuid.ts`: `esUuid`, `unaDe`.
 * - `errores.ts`: `ErrorSeguridad`, el único error que tira este paquete.
 */
export { compararEnTiempoConstante } from "./comparar.js";
export { cifrar, descifrar, type Clave } from "./cifrado.js";
export {
  crearPase,
  verificarPase,
  type DatosPase,
  type MotivoPaseInvalido,
  type ResultadoPase,
} from "./pases.js";
export { esUuid, unaDe } from "./uuid.js";
export { ErrorSeguridad, type CodigoErrorSeguridad } from "./errores.js";
