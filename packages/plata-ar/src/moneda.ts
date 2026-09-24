import { ErrorPlata } from "./errores.js";
import { aplicarFactor } from "./factor.js";
// `factorAEscala`/`ESCALA_FACTOR` son internos (ver `escala-factor.ts`): se
// importan directo de ahí, no de `factor.ts`, que solo re-exporta la API
// pública (`aplicarFactor`, `factorEntre`).
import { factorAEscala, ESCALA_FACTOR } from "./escala-factor.js";

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
 * `tc` tiene que ser mayor a 0 — tira `ErrorPlata` (`tc_no_positivo`) si no
 * lo es — y, si `a` es la MISMA moneda que ya tiene `importe`, tiene que
 * ser exactamente `"1"` — tira `ErrorPlata` (`tc_identidad`) si no: convertir
 * ARS a ARS con un tipo de cambio que no es 1 es casi siempre un TC de otro
 * par pegado en el lugar equivocado, no una conversión real.
 *
 * **Contrato real de ida y vuelta** (no "siempre ±1 centavo", que no es
 * cierto en general): `convertir(convertir(i, B, tc), A, tcInv)` cae dentro
 * de ±1 centavo del `i` original **solo si**:
 * 1. `tc` y `tcInv` son recíprocos exactos (`tc × tcInv === 1` sin resto,
 *    p.ej. `"2"` / `"0.5"`, o `"1.25"` / `"0.8"` — no dos cotizaciones
 *    cargadas por separado y redondeadas cada una a 8 decimales, que casi
 *    nunca multiplican exacto a 1), **y**
 * 2. se arranca en la moneda "fuerte" (la que tiene MENOS centavos por
 *    unidad de la otra) — es decir, la primera conversión usa el factor
 *    mayor a 1 y la vuelta el factor `tcInv <= 1`.
 *
 * Sin las dos condiciones no hay garantía de round trip: la ida y la vuelta
 * son dos conversiones independientes, cada una exacta en sí misma, no
 * inversas la una de la otra. Quien necesite el importe original después de
 * convertir tiene que **guardar el importe y el TC originales**, no
 * reconstruirlos convirtiendo para atrás.
 *
 * @example
 * convertir({ centavos: 100_000n, moneda: "USD" }, "ARS", "1050.50");
 * // { centavos: 105_050_000n, moneda: "ARS" }  (USD 1.000 a $1.050,50)
 * @example
 * convertir({ centavos: 100n, moneda: "ARS" }, "ARS", "1"); // sin cambios
 * convertir({ centavos: 100n, moneda: "ARS" }, "ARS", "2"); // tira ErrorPlata (tc_identidad)
 */
export function convertir(importe: Importe, a: Moneda, tc: string): Importe {
  const tcEscalado = factorAEscala(tc);
  if (tcEscalado <= 0n) {
    throw new ErrorPlata("tc_no_positivo", `convertir: el tipo de cambio debe ser mayor a 0 (fue "${tc}").`);
  }
  if (importe.moneda === a && tcEscalado !== ESCALA_FACTOR) {
    throw new ErrorPlata(
      "tc_identidad",
      `convertir: convertir ${a} a la misma moneda requiere un tipo de cambio "1" (fue "${tc}").`,
    );
  }
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
