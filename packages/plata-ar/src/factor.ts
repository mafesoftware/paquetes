import { ErrorPlata } from "./errores.js";
import { redondearComercial } from "./bigint.js";
import { ESCALA_FACTOR, factorAEscala } from "./escala-factor.js";

/**
 * Aplica un factor de 8 decimales a un monto en centavos, redondeando
 * "comercial" al final (spec 02 §1 y §3.2: "factor = índice_referencia /
 * índice_base (8 decimales); monto_ajustado = redondear(monto_base ×
 * factor)").
 *
 * `factor` es un string decimal de hasta 8 decimales ("1.06203057"): la
 * RAZÓN ya calculada, no un valor de índice suelto (para eso está
 * `factorEntre`, más abajo). Todo en `bigint`: el factor se escala a un
 * entero exacto (×10^8) antes de multiplicar, así que no hay punto
 * flotante en ningún paso.
 *
 * @example
 * aplicarFactor(10_000_000n, "1.06203057"); // 10_620_306n
 * // 10_000_000 × 1.06203057 = 10_620_305,7 → redondeo comercial → 10_620_306
 */
export function aplicarFactor(centavos: bigint, factor: string): bigint {
  const escalado = factorAEscala(factor);
  return redondearComercial(centavos * escalado, ESCALA_FACTOR);
}

interface IndiceAnalizado {
  negativo: boolean;
  entero: string;
  decimales: string;
}

/**
 * Un valor de ÍNDICE (no un factor ya calculado): acepta CUALQUIER cantidad
 * de decimales, a diferencia de `factorAEscala` — un índice publicado (CAC,
 * ICC, UVA...) puede venir con más de 8 decimales, y acá no hace falta
 * capar nada porque el redondeo a 8 decimales pasa una sola vez, al final,
 * en `factorEntre`.
 */
function analizarIndice(texto: string): IndiceAnalizado {
  const limpio = texto.trim();
  const coincidencia = /^(-?)(\d+)(?:\.(\d+))?$/.exec(limpio);
  if (!coincidencia) {
    throw new ErrorPlata(
      "indice_invalido",
      `factorEntre: "${texto}" no es un valor de índice válido (se espera un decimal, sin límite de dígitos).`,
    );
  }
  return { negativo: coincidencia[1] === "-", entero: coincidencia[2]!, decimales: coincidencia[3] ?? "" };
}

/**
 * El entero escalado (×10^8) de vuelta a un string decimal, sin ceros de
 * más. Sin manejo de signo: el único llamador (`factorEntre`) ya rechazó
 * `valorRef`/`valorBase` no positivos antes de calcular esto, así que
 * `escalado` siempre es ≥ 0 acá (los índices son positivos → la razón
 * también lo es).
 */
function formatearFactorEscalado(escalado: bigint): string {
  const entero = escalado / ESCALA_FACTOR;
  const decimalesCrudos = (escalado % ESCALA_FACTOR).toString().padStart(8, "0");
  const decimales = decimalesCrudos.replace(/0+$/, "");
  const sufijo = decimales.length > 0 ? `.${decimales}` : "";
  return `${entero.toString()}${sufijo}`;
}

/**
 * La razón exacta `valorRef / valorBase`, redondeada comercial a 8
 * decimales, como el string decimal que espera `aplicarFactor` (spec 02
 * §3.2: `factor = índice_referencia / índice_base`).
 *
 * `valorRef` y `valorBase` son valores de ÍNDICE (no factores): aceptan
 * cualquier cantidad de decimales — un índice publicado puede traer más de
 * 8 —, porque acá se escalan los DOS a la misma cantidad de decimales y se
 * calcula la razón exacta en enteros; el redondeo a 8 decimales pasa una
 * sola vez, al final, sobre el resultado. Nunca pasa por `number`.
 *
 * Los índices son positivos: tira `ErrorPlata` (`indice_invalido`) si
 * `valorRef` o `valorBase` no son mayores a 0, o si no son un decimal
 * válido.
 *
 * @example
 * factorEntre("3662.2", "3448.3"); // "1.06203057"
 * aplicarFactor(10_000_000n, factorEntre("3662.2", "3448.3")); // 10_620_306n
 */
export function factorEntre(valorRef: string, valorBase: string): string {
  const ref = analizarIndice(valorRef);
  const base = analizarIndice(valorBase);

  if (ref.negativo) {
    throw new ErrorPlata(
      "indice_invalido",
      `factorEntre: el valor de referencia no puede ser negativo (fue "${valorRef}"); los índices son positivos.`,
    );
  }
  if (base.negativo) {
    throw new ErrorPlata(
      "indice_invalido",
      `factorEntre: el valor base no puede ser negativo (fue "${valorBase}"); los índices son positivos.`,
    );
  }

  // Se escalan los dos al mismo número de decimales (el máximo entre
  // ambos) para poder comparar/dividir en enteros exactos: la escala se
  // cancela en la razón, así que el resultado no depende de cuál de los
  // dos tenía más decimales.
  const maxDecimales = Math.max(ref.decimales.length, base.decimales.length);
  const refEscalado = BigInt(ref.entero + ref.decimales.padEnd(maxDecimales, "0"));
  const baseEscalado = BigInt(base.entero + base.decimales.padEnd(maxDecimales, "0"));

  if (refEscalado <= 0n) {
    throw new ErrorPlata(
      "indice_invalido",
      `factorEntre: el valor de referencia debe ser mayor a 0 (fue "${valorRef}"); los índices son positivos.`,
    );
  }
  if (baseEscalado <= 0n) {
    throw new ErrorPlata(
      "indice_invalido",
      `factorEntre: el valor base debe ser mayor a 0 (fue "${valorBase}"); los índices son positivos.`,
    );
  }

  const resultadoEscalado = redondearComercial(refEscalado * ESCALA_FACTOR, baseEscalado);
  return formatearFactorEscalado(resultadoEscalado);
}
