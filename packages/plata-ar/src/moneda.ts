import { ErrorPlata } from "./errores.js";
import { aplicarFactor } from "./factor.js";

/** Monedas soportadas (spec 02 §1: "ARS, USD; EUR habilitable"). */
export type Moneda = "ARS" | "USD" | "EUR";

/** Un monto con su moneda: la unidad atómica de plata de esta versión. */
export interface Importe {
  /** El monto, en centavos, como `bigint`. Nunca `number`: ver spec 02 §1. */
  centavos: bigint;
  moneda: Moneda;
}

/**
 * Convierte un `Importe` a otra moneda aplicando el tipo de cambio `tc`
 * (string decimal de hasta 8 decimales, spec 02 §2: `tipo_cambio numeric(20,6)`
 * guardado con la precisión de `aplicarFactor`).
 *
 * Como toda conversión pasa por un redondeo comercial al centavo, la ida y
 * la vuelta (`convertir(convertir(i, B, tc), A, 1/tc)`) puede diferir del
 * importe original en como mucho ±1 centavo — nunca más, porque cada
 * conversión redondea una sola vez.
 *
 * @example
 * convertir({ centavos: 100_000n, moneda: "USD" }, "ARS", "1050.50");
 * // { centavos: 105_050_000n, moneda: "ARS" }  (USD 1.000 a $1.050,50)
 */
export function convertir(importe: Importe, a: Moneda, tc: string): Importe {
  return { centavos: aplicarFactor(importe.centavos, tc), moneda: a };
}

/**
 * Suma importes de la **misma moneda**. Tira `ErrorPlata` (`moneda_mezclada`)
 * si mezclan monedas distintas: sumar ARS con USD sin convertir antes es un
 * bug de quien llama, no un resultado que este paquete pueda inventar (spec
 * 02 §2: toda conversión necesita un tipo de cambio y una fecha explícitos).
 *
 * @example
 * sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 250n, moneda: "ARS" });
 * // { centavos: 350n, moneda: "ARS" }
 */
export function sumar(...importes: Importe[]): Importe {
  if (importes.length === 0) {
    throw new ErrorPlata("sumar_sin_importes", "sumar: se necesita al menos un importe.");
  }

  const moneda = importes[0]!.moneda;
  let total = 0n;
  for (const importe of importes) {
    if (importe.moneda !== moneda) {
      throw new ErrorPlata(
        "moneda_mezclada",
        `sumar: no se puede sumar ${importe.moneda} con ${moneda} sin convertir antes.`,
      );
    }
    total += importe.centavos;
  }

  return { centavos: total, moneda };
}
