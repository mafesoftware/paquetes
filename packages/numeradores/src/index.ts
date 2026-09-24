/**
 * Numeración correlativa (comprobantes, órdenes de pago, órdenes de compra)
 * SIN huecos, por tenant + ámbito + tipo, segura con 100 transacciones
 * concurrentes.
 *
 * Ninguna de las 5 implementaciones que había repetidas en los productos de
 * MAFE Software garantizaba eso bajo concurrencia real (store360:
 * `max + 1` en el insert + reintento manual; ediflow: contador de fila +
 * lock consultivo, uno por caso de uso). Este paquete junta lo que
 * funcionaba de cada una:
 *
 * - `formatear.ts`: `formatearNumero` — rellena con ceros SIN truncar
 *   (a diferencia del `lpad` de Postgres, que store360 usó mal en
 *   producción: ver el JSDoc de la función).
 * - `codigo-en-cadena.ts` (interno): la máquina compartida que camina la
 *   cadena de `cause` (hasta 10 niveles) y adentro de un `AggregateError`
 *   buscando un código de Postgres.
 * - `choque-de-unico.ts`: `esChoqueDeUnico` — `23505` (choque de índice
 *   único). No es lo que produce `siguienteNumero` bajo concurrencia (ver
 *   su JSDoc); sigue sirviendo para el patrón `max + 1` + insert de
 *   store360 y similares.
 * - `falla-de-serializacion.ts`: `esFallaDeSerializacion` — `40001`/`40P01`.
 *   Es el fallo real de `siguienteNumero` bajo aislamiento `REPEATABLE
 *   READ`/`SERIALIZABLE` (no bajo `READ COMMITTED`, para el que está
 *   pensado por defecto).
 * - `reintento.ts`: `conReintento` — reintento con backoff y jitter para un
 *   error reintentable (`esChoqueDeUnico` por defecto).
 * - `errores.ts`: `ErrorNumeradores`, el único error que tira este paquete.
 *
 * Núcleo puro: sin variables de entorno, sin framework, sin base de datos. Lo
 * específico de Drizzle (la tabla y las dos operaciones atómicas que
 * consumen y configuran un numerador) vive en el subpath
 * `@mafesoftware/numeradores/drizzle`, que NO se importa desde acá
 * (`drizzle-orm` es un peerDependency opcional solo de ese subpath).
 */
export { formatearNumero, type OpcionesFormatearNumero } from "./formatear.js";
export { esChoqueDeUnico } from "./choque-de-unico.js";
export { esFallaDeSerializacion } from "./falla-de-serializacion.js";
export { conReintento, type OpcionesConReintento } from "./reintento.js";
export { ErrorNumeradores, type CodigoErrorNumeradores } from "./errores.js";
