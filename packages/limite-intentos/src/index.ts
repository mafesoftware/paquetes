/**
 * Freno a la fuerza bruta en el ingreso (login/attempt throttling),
 * persistido SIEMPRE en Postgres — nunca en memoria, porque en Vercel cada
 * request puede caer en otra instancia (y las funciones se reciclan): un
 * contador en RAM se reinicia solo y no frena nada.
 *
 * Se cuenta por CUENTA (`claveCuenta`) y por IP (`claveIp`) — las dos hacen
 * falta: por cuenta frena el ataque clásico (mil contraseñas contra un
 * mail); por IP frena el *spraying* (una contraseña contra mil mails
 * distintos, que no mueve ningún contador por cuenta).
 *
 * Núcleo puro: sin base de datos, sin framework, sin variables de entorno.
 * Lo específico de Drizzle (la tabla y las tres operaciones atómicas que la
 * usan) vive en el subpath `@mafesoftware/limite-intentos/drizzle`, que NO
 * se importa desde acá (`drizzle-orm` es un peerDependency opcional solo de
 * ese subpath).
 *
 * - `claves.ts`: `claveCuenta`/`claveIp` — la clave (PK de la tabla) de cada
 *   espacio de nombres.
 * - `validaciones.ts`: `enteroPositivo` (interno, no se re-exporta acá) —
 *   la valida que usa `registrarIntento` para `maximo`/`ventanaMs`/`bloqueoMs`.
 * - `errores.ts`: `ErrorLimiteIntentos`, el único error que tira este
 *   paquete.
 */
export { claveCuenta, claveIp } from "./claves.js";
export { ErrorLimiteIntentos, type CodigoErrorLimiteIntentos } from "./errores.js";
