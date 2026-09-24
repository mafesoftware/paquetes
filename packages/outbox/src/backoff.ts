import { ErrorOutbox } from "./errores.js";

/** Opciones de `backoff`. Todas opcionales: sin ninguna, arranca en 30 s y dobla hasta un tope de 1 h, con ±20% de jitter. */
export interface OpcionesBackoff {
  /** Espera del intento `0`, en ms, antes de aplicar el factor y el jitter. `30_000` (30 s) por defecto. Tiene que ser `> 0`. */
  base?: number;
  /** Cuánto se multiplica la espera en cada intento sucesivo. `2` por defecto (se duplica). Tiene que ser `>= 1` (con `1`, la espera no crece — solo varía por el jitter). */
  factor?: number;
  /** Tope de la espera ANTES de aplicar el jitter, en ms. `3_600_000` (1 h) por defecto. Tiene que ser `>= base`. */
  tope?: number;
  /**
   * Cuánto puede variar la espera alrededor del valor calculado, como
   * fracción (`0.2` = ±20%). `0.2` por defecto. Tiene que estar en `[0, 1]`
   * — en `1`, el resultado puede llegar a `0`; nunca da negativo (`backoff`
   * lo recorta a `0` como piso, ver más abajo).
   */
  jitter?: number;
  /**
   * De dónde sale el azar del jitter — un número en `[0, 1)`, misma forma
   * que `Math.random()` (el default). Inyectable para que los tests sean
   * deterministas sin mockear `Math.random` globalmente.
   */
  aleatorio?: () => number;
}

/**
 * Cuánto esperar antes del intento número `intento` (0-based: `backoff(0)`
 * es la espera antes del PRIMER reintento, después de que el intento
 * inicial ya falló) — milisegundos, con crecimiento exponencial y jitter.
 *
 * `procesarOutbox` (`@mafesoftware/outbox/drizzle`) la usa así: si el
 * intento que acaba de fallar fue el número `intentos` de la fila (1-based,
 * ya incluye el que acaba de fallar), el PRÓXIMO se agenda con
 * `backoff(intentos - 1)` — `intentos - 1` es el número de fallos previos
 * ya ocurridos, 0-based.
 *
 * **Por qué jitter, no solo crecimiento exponencial:** si muchos mensajes
 * fallan al mismo tiempo (el proveedor entero caído un minuto), sin jitter
 * todos reintentarían exactamente juntos otra vez — la carga vuelve a
 * pegar en un solo instante en vez de repartirse. El mismo motivo que
 * `esperaConJitter` de `@mafesoftware/numeradores`, acá configurable en vez
 * de fijo, porque `procesarOutbox` corre en un cron con minutos entre
 * corridas (no en un loop de reintento en el momento) y cada producto
 * puede necesitar otra escala.
 *
 * `aleatorio` (inyectable) decide el jitter DENTRO del rango
 * `[-jitter, +jitter]` de forma UNIFORME sobre ese rango — `aleatorio() =
 * 0.5` (el centro de `[0, 1)`) da jitter `0` exacto (espera sin variar);
 * `aleatorio() = 0` da `-jitter` (el mínimo); un valor cercano a `1` da
 * cerca de `+jitter` (el máximo, nunca alcanzado si `aleatorio` respeta
 * `[0, 1)` como `Math.random`).
 *
 * **Valida las opciones antes de calcular nada** (`base > 0`, `factor >=
 * 1`, `tope >= base`, `jitter` en `[0, 1]`) y tira
 * `ErrorOutbox("opciones_invalidas")` si alguna no tiene sentido — son
 * errores de PROGRAMACIÓN (una app que configura `procesarOutbox` mal), no
 * algo que dependa de datos en runtime.
 *
 * El resultado nunca es negativo (recortado a `0` como piso) ni fraccionario
 * (`Math.round`).
 *
 * ```ts
 * import { backoff } from "@mafesoftware/outbox";
 *
 * backoff(0); // ~30_000 ± 20% (24_000..36_000): la primera espera
 * backoff(1); // ~60_000 ± 20%: se duplicó
 * backoff(5); // 3_600_000 ± 20%: ya tocó el tope de 1 h (30_000 * 2^5 = 960_000, sigue creciendo)
 * backoff(10); // 3_600_000 ± 20%: bien por encima del tope, recortado igual
 *
 * // Determinista para tests: aleatorio fijo en el centro del rango (0.5) da jitter 0.
 * backoff(0, { aleatorio: () => 0.5 }); // exactamente 30_000
 * backoff(2, { base: 1000, factor: 3, tope: 10_000, jitter: 0, aleatorio: () => 0.5 }); // exactamente 9_000 (1000 * 3^2)
 * ```
 */
export function backoff(intento: number, opciones: OpcionesBackoff = {}): number {
  const { base = 30_000, factor = 2, tope = 3_600_000, jitter = 0.2, aleatorio = Math.random } = opciones;

  if (!Number.isInteger(intento) || intento < 0) {
    throw new ErrorOutbox("opciones_invalidas", `backoff: "intento" tiene que ser un entero >= 0 (fue ${intento}).`);
  }
  if (!(base > 0)) {
    throw new ErrorOutbox("opciones_invalidas", `backoff: "base" tiene que ser > 0 (fue ${base}).`);
  }
  if (!(factor >= 1)) {
    throw new ErrorOutbox("opciones_invalidas", `backoff: "factor" tiene que ser >= 1 (fue ${factor}).`);
  }
  if (!(tope >= base)) {
    throw new ErrorOutbox("opciones_invalidas", `backoff: "tope" tiene que ser >= "base" (tope=${tope}, base=${base}).`);
  }
  if (!(jitter >= 0 && jitter <= 1)) {
    throw new ErrorOutbox("opciones_invalidas", `backoff: "jitter" tiene que estar en [0, 1] (fue ${jitter}).`);
  }

  // `factor ** intento` puede dar Infinity con un intento muy grande y factor
  // > 1 — Math.min con `tope` (finito) igual da el resultado correcto sin
  // caso especial.
  const sinJitter = Math.min(base * factor ** intento, tope);
  const desvio = (aleatorio() * 2 - 1) * jitter; // [-jitter, +jitter)
  return Math.max(0, Math.round(sinJitter * (1 + desvio)));
}
