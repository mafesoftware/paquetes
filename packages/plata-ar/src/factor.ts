import { ErrorPlata } from "./errores.js";
import { redondearComercial } from "./bigint.js";

/** Escala de los factores: 8 decimales (spec 02 §1 y §3, `numeric(20,8)`). */
export const ESCALA_FACTOR = 100_000_000n; // 10^8

/**
 * Un factor decimal string ("1.06203057") a un entero escalado por 10^8,
 * exacto. Exportado (además de `aplicarFactor`) para `moneda.ts`, que
 * necesita inspeccionar el signo/valor de un tipo de cambio antes de
 * aplicarlo (`convertir`: tc > 0, y == "1" exacto para la misma moneda).
 */
export function factorAEscala(factor: string): bigint {
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

/** El entero escalado (×10^8) de vuelta a un string decimal, sin ceros de más. */
function formatearFactorEscalado(escalado: bigint): string {
  const negativo = escalado < 0n;
  const absoluto = negativo ? -escalado : escalado;
  const entero = absoluto / ESCALA_FACTOR;
  const decimalesCrudos = (absoluto % ESCALA_FACTOR).toString().padStart(8, "0");
  const decimales = decimalesCrudos.replace(/0+$/, "");
  const sufijo = decimales.length > 0 ? `.${decimales}` : "";
  return `${negativo ? "-" : ""}${entero.toString()}${sufijo}`;
}

/**
 * La razón exacta `valorRef / valorBase`, redondeada comercial a 8
 * decimales, como el string decimal que espera `aplicarFactor` (spec 02
 * §3.2: `factor = índice_referencia / índice_base`). Todo en `bigint`: el
 * cociente nunca pasa por `number`.
 *
 * Tira `ErrorPlata` (`tc_no_positivo`) si `valorBase` no es mayor a 0: un
 * índice base cero o negativo no tiene factor posible.
 *
 * @example
 * factorEntre("3662.2", "3448.3"); // "1.06203057"
 * aplicarFactor(10_000_000n, factorEntre("3662.2", "3448.3")); // 10_620_306n
 */
export function factorEntre(valorRef: string, valorBase: string): string {
  const refEscalado = factorAEscala(valorRef);
  const baseEscalado = factorAEscala(valorBase);
  if (baseEscalado <= 0n) {
    throw new ErrorPlata("tc_no_positivo", `factorEntre: el valor base debe ser mayor a 0 (fue "${valorBase}").`);
  }
  const resultadoEscalado = redondearComercial(refEscalado * ESCALA_FACTOR, baseEscalado);
  return formatearFactorEscalado(resultadoEscalado);
}
