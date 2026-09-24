import { esChoqueDeUnico } from "./choque-de-unico.js";

/** Opciones de `conReintento`. */
export interface OpcionesConReintento {
  /** Cuántas veces llamar a `fn` en total (el primer intento cuenta como uno). `5` por defecto. */
  intentos?: number;
  /** Si un error es de los que vale la pena reintentar. `esChoqueDeUnico` por defecto. */
  esReintentable?: (error: unknown) => boolean;
  /**
   * Cuánto esperar antes del intento número `intento` (0-based; se llama
   * ANTES del segundo intento en adelante, nunca antes del primero).
   * Inyectable para que los tests no dependan de temporizadores reales — sin
   * pasarla, usa un backoff creciente con jitter (ver `esperaConJitter`).
   */
  espera?: (intento: number) => Promise<void>;
}

/**
 * Llama a `fn` y, si tira un error reintentable, vuelve a llamarla con una
 * espera creciente entre intentos, hasta `intentos` veces en total.
 *
 * Genérico: no asume qué es `fn` ni qué error tira. En este paquete tiene
 * dos usos bien distintos, cada uno con su propio predicado:
 *
 * - El choque de índice único (`23505`, `esChoqueDeUnico`) del patrón
 *   `max + 1` + insert (`insertarNumerado` de store360): con N
 *   transacciones calculando el mismo valor a la vez, el índice único
 *   rechaza a todas menos una, y lo que corresponde es volver a pedir. NO
 *   es lo que produce `siguienteNumero` de este paquete (su `INSERT ... ON
 *   CONFLICT DO UPDATE` absorbe ese choque adentro de la misma sentencia,
 *   nunca llega a violar el índice — ver su JSDoc).
 * - La falla de serialización (`40001`/`40P01`, `esFallaDeSerializacion`)
 *   que SÍ puede tirar `siguienteNumero`. `40001` necesita aislamiento
 *   `REPEATABLE READ`/`SERIALIZABLE` (no pasa bajo `READ COMMITTED`, el
 *   default, para el que `siguienteNumero` está pensado). `40P01`
 *   (deadlock) en cambio puede pasar bajo CUALQUIER aislamiento, incluido
 *   `READ COMMITTED`: si una transacción numera VARIAS filas distintas (más
 *   de un `(tenant, ambito, tipo)`) y otra transacción concurrente las pide
 *   en el orden contrario, Postgres puede abortar a una de las dos con
 *   `40P01` aunque ninguna pidiera un aislamiento estricto — ver el JSDoc
 *   de `esFallaDeSerializacion`. En cualquiera de los dos casos hay que
 *   envolver la transacción ENTERA, no solo la llamada a `siguienteNumero`:
 *   una vez que Postgres aborta una transacción por esto, TODA sentencia
 *   posterior en esa misma transacción falla también, así que reintentar de
 *   adentro no alcanza. Si tu app numera más de una fila por transacción,
 *   además mantené un orden de bloqueo consistente entre los flujos que
 *   puedan competir (por ejemplo, pedir los números siempre ordenados por
 *   `tipo`) — reduce la chance de deadlock, aunque `conReintento` sigue
 *   haciendo falta como red.
 *
 * **La espera con jitter, no solo los intentos, es parte del mecanismo.**
 * Sin espera, los perdedores de la carrera reintentan todos juntos sobre la
 * misma foto y se vuelven a chocar entre ellos — la carrera no se despeja
 * sola, se repite (documentado así, con el mismo bug, en
 * `insertarNumerado` de store360).
 *
 * Cualquier error NO reintentable (según `esReintentable`) sale tal cual, de
 * inmediato: reintentar un error que no corresponde escondería un bug de
 * datos detrás de varios intentos idénticos.
 *
 * ```ts
 * import { conReintento, esChoqueDeUnico, esFallaDeSerializacion } from "@mafesoftware/numeradores";
 * import { siguienteNumero } from "@mafesoftware/numeradores/drizzle";
 *
 * // Uso típico con READ COMMITTED (el default de siguienteNumero), UNA
 * // sola fila por transacción: no hace falta conReintento — el bloqueo de
 * // fila del INSERT ... ON CONFLICT ya serializa a las transacciones
 * // concurrentes sin que ninguna falle (ver el test de 100 concurrentes).
 * const { numero, formateado } = await db.transaction((tx) =>
 *   siguienteNumero(tx, tabla, { tenantId, tipo: "recibo" }),
 * );
 *
 * // Si la transacción numera MÁS DE UNA fila (dos tipos distintos, por
 * // ejemplo), un deadlock (40P01) es posible aunque sea READ COMMITTED —
 * // mismo conReintento y mismo predicado combinado que en el caso
 * // SERIALIZABLE de abajo (esChoqueDeUnico por sí solo NO detecta 40P01),
 * // y pedir los números siempre en el mismo orden en todos los flujos que
 * // puedan competir.
 * const { recibo, ordenPago } = await conReintento(
 *   () =>
 *     db.transaction(async (tx) => ({
 *       recibo: await siguienteNumero(tx, tabla, { tenantId, tipo: "recibo" }),
 *       ordenPago: await siguienteNumero(tx, tabla, { tenantId, tipo: "orden_pago" }),
 *     })),
 *   { esReintentable: (e) => esChoqueDeUnico(e) || esFallaDeSerializacion(e) },
 * );
 *
 * // Con SERIALIZABLE (o REPEATABLE READ) explícito, envolver la
 * // TRANSACCIÓN ENTERA con conReintento, combinando los dos predicados:
 * const { numero: numeroSerializable } = await conReintento(
 *   () =>
 *     db.transaction((tx) => siguienteNumero(tx, tabla, { tenantId, tipo: "recibo" }), {
 *       isolationLevel: "serializable",
 *     }),
 *   { intentos: 8, esReintentable: (e) => esChoqueDeUnico(e) || esFallaDeSerializacion(e) },
 * );
 * ```
 */
export async function conReintento<T>(fn: () => Promise<T>, opciones: OpcionesConReintento = {}): Promise<T> {
  const intentos = opciones.intentos ?? 5;
  if (intentos < 1) {
    throw new Error(`conReintento: "intentos" debe ser >= 1 (fue ${intentos})`);
  }
  const esReintentable = opciones.esReintentable ?? esChoqueDeUnico;
  const espera = opciones.espera ?? esperaConJitter;

  let intento = 0;
  // `while (true)`, no un `for`: cada camino de salida es un `return` o un
  // `throw` explícito, así que no hace falta (ni queda código inalcanzable
  // por) un fallback después del bucle.
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!esReintentable(error) || intento === intentos - 1) throw error;
      await espera(intento);
      intento++;
    }
  }
}

/**
 * Backoff creciente con jitter: milisegundos, no percibibles al emitir un
 * comprobante, y solo corren cuando YA hubo un choque (el caso raro). El
 * azar es lo que evita que los perdedores de la carrera reintenten todos
 * juntos sobre la misma foto.
 */
function esperaConJitter(intento: number): Promise<void> {
  const ms = Math.round((intento + 1) * 5 * (0.5 + Math.random()));
  return new Promise((listo) => setTimeout(listo, ms));
}
