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
 * Pensado para el choque de índice único que produce `siguienteNumero` bajo
 * concurrencia: con N transacciones pidiendo el mismo número a la vez, todas
 * calculan (o compiten por) el mismo valor y el índice único de
 * `(tenant, ambito, tipo)` — o, en el enfoque de `insertarNumerado` de
 * store360, del propio comprobante — rechaza a todas menos una. Esa no es
 * una falla de datos: es la carrera que el índice está para ganar, y lo que
 * corresponde es volver a pedir.
 *
 * **La espera con jitter, no solo los intentos, es parte del mecanismo.**
 * Sin espera, los perdedores de la carrera reintentan todos juntos sobre la
 * misma foto y se vuelven a chocar entre ellos — la carrera no se despeja
 * sola, se repite (documentado así, con el mismo bug, en
 * `insertarNumerado` de store360).
 *
 * Cualquier error NO reintentable (según `esReintentable`) sale tal cual, de
 * inmediato: reintentar un error que no es de choque de único escondería un
 * bug de datos detrás de varios intentos idénticos.
 *
 * ```ts
 * import { conReintento, esChoqueDeUnico } from "@mafesoftware/numeradores";
 *
 * const fila = await conReintento(
 *   () => db.transaction((tx) => siguienteNumero(tx, tabla, { tenantId, tipo: "recibo" })),
 *   { intentos: 8 }, // esReintentable: esChoqueDeUnico por defecto
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
