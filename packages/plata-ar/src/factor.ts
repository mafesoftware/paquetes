import { ErrorPlata } from "./errores.js";
import { redondearComercial } from "./bigint.js";

/** Escala de los factores: 8 decimales (spec 02 §1 y §3, `numeric(20,8)`). */
const ESCALA_FACTOR = 100_000_000n; // 10^8

/** Un factor decimal string ("1.06203057") a un entero escalado por 10^8, exacto. */
function factorAEscala(factor: string): bigint {
  const texto = factor.trim();
  const coincidencia = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(texto);
  if (!coincidencia) {
    throw new ErrorPlata(
      "factor_invalido",
      `Factor inválido: "${factor}" (se espera un decimal de hasta 8 decimales, ej. "1.06203057").`,
    );
  }
  // Los grupos 1 y 2 siempre matchean si `coincidencia` no es null (no son
  // opcionales en el regex); solo el grupo 3 (decimales) es opcional.
  const signo = coincidencia[1]!;
  const entero = coincidencia[2]!;
  const decimales = (coincidencia[3] ?? "").padEnd(8, "0");
  const magnitud = BigInt(entero) * ESCALA_FACTOR + BigInt(decimales);
  return signo === "-" ? -magnitud : magnitud;
}

/**
 * Aplica un factor de 8 decimales a un monto en centavos, redondeando
 * "comercial" al final (spec 02 §1 y §3.2: "factor = índice_referencia /
 * índice_base (8 decimales); monto_ajustado = redondear(monto_base ×
 * factor)").
 *
 * Todo en `bigint`: el factor se escala a un entero exacto (×10^8) antes de
 * multiplicar, así que no hay punto flotante en ningún paso.
 *
 * @example
 * aplicarFactor(10_000_000n, "1.06203057"); // 10_620_306n
 * // 10_000_000 × 1.06203057 = 10_620_305,7 → redondeo comercial → 10_620_306
 */
export function aplicarFactor(centavos: bigint, factor: string): bigint {
  const escalado = factorAEscala(factor);
  return redondearComercial(centavos * escalado, ESCALA_FACTOR);
}
