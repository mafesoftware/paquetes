import { codigoEnCadena } from "./codigo-en-cadena.js";

/**
 * ¿Es `error` (en cualquier punto de su cadena) una falla de serialización
 * de Postgres — `40001` (`serialization_failure`, "could not serialize
 * access due to concurrent update") o `40P01` (`deadlock_detected`)?
 *
 * Es el fallo REAL que puede tirar `siguienteNumero` bajo concurrencia
 * cuando la transacción que lo envuelve corre con aislamiento
 * `REPEATABLE READ` o `SERIALIZABLE` (no bajo `READ COMMITTED`, el default
 * de Postgres y para el que `siguienteNumero` está pensado — ver su JSDoc).
 * Con esos aislamientos más estrictos, dos transacciones concurrentes que
 * modifican la MISMA fila (el numerador de un `(tenant, ámbito, tipo)`) no
 * se bloquean una a la otra silenciosamente como bajo `READ COMMITTED`:
 * Postgres puede abortar a la que pierde la carrera con `40001` (o, más
 * raro, detectar un deadlock real entre dos transacciones que se
 * bloquearon mutuamente y tirar `40P01`) — en cualquiera de los dos casos,
 * TODA la transacción queda abortada, no solo la sentencia de
 * `siguienteNumero`; no alcanza con reintentar la llamada, hay que
 * reintentar la transacción entera con `conReintento` envolviendo el
 * `db.transaction(...)` completo (ver el README).
 *
 * Camina la cadena de causas hasta 10 niveles y adentro de un
 * `AggregateError`, igual que `esChoqueDeUnico` (ver `codigo-en-cadena.ts`
 * para el porqué).
 */
export function esFallaDeSerializacion(error: unknown): boolean {
  return codigoEnCadena(error, ["40001", "40P01"]);
}
