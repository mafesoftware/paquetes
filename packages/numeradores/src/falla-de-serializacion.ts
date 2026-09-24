import { codigoEnCadena } from "./codigo-en-cadena.js";

/**
 * ¿Es `error` (en cualquier punto de su cadena) una falla de serialización
 * de Postgres — `40001` (`serialization_failure`, "could not serialize
 * access due to concurrent update") o `40P01` (`deadlock_detected`)?
 *
 * Los dos códigos tienen un motivo distinto, aunque acá se traten igual
 * (los dos exigen reintentar la transacción ENTERA):
 *
 * - `40001` es específico de aislamiento `REPEATABLE READ`/`SERIALIZABLE`:
 *   bajo esos aislamientos más estrictos, dos transacciones concurrentes
 *   que modifican la MISMA fila (el numerador de un `(tenant, ámbito,
 *   tipo)`) no se bloquean una a la otra silenciosamente como bajo `READ
 *   COMMITTED` (el default de Postgres, y para el que `siguienteNumero`
 *   está pensado — ver su JSDoc): Postgres puede abortar a la que pierde la
 *   carrera con `40001` en vez de dejarla esperar.
 * - `40P01` (deadlock) puede pasar bajo CUALQUIER aislamiento, incluido
 *   `READ COMMITTED` — no depende del nivel de aislamiento, depende del
 *   ORDEN en que dos transacciones toman locks. Pasa si una transacción
 *   numera VARIAS filas distintas (llama a `siguienteNumero` para más de un
 *   `(tenant, ambito, tipo)`) y otra transacción concurrente las pide en el
 *   orden CONTRARIO: cada una espera a la fila que la otra ya tiene
 *   bloqueada, Postgres detecta el ciclo y aborta a una de las dos. Un
 *   orden de bloqueo consistente (pedir los números siempre en el mismo
 *   orden en todos los flujos que puedan competir) lo hace improbable, no
 *   imposible.
 *
 * En cualquiera de los dos casos, TODA la transacción queda abortada, no
 * solo la sentencia de `siguienteNumero`; no alcanza con reintentar la
 * llamada, hay que reintentar la transacción entera con `conReintento`
 * envolviendo el `db.transaction(...)` completo (ver el README) — y, si tu
 * app numera más de una fila por transacción, además mantener un orden de
 * bloqueo consistente entre los flujos que puedan competir.
 *
 * Camina la cadena de causas hasta 10 niveles y adentro de un
 * `AggregateError`, igual que `esChoqueDeUnico` (ver `codigo-en-cadena.ts`
 * para el porqué).
 */
export function esFallaDeSerializacion(error: unknown): boolean {
  return codigoEnCadena(error, ["40001", "40P01"]);
}
