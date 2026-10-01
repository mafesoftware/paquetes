/**
 * Helpers PUROS compartidos por los cuatro cálculos de retención
 * (`ganancias.ts`/`iva.ts`/`suss.ts`/`iibb.ts`): porcentaje exacto sobre un
 * importe en centavos (fracción `bigint`, redondeo comercial SOLO al
 * final), aplicar una exclusión/certificado de no retención, formatear
 * pesos para `explicacion`, y `netoDelPago` (proporción del neto de un
 * documento según lo pagado).
 *
 * Sin DB, sin framework, sin otros módulos de app — se testea sin levantar
 * Postgres.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";
import type { Exclusion } from "./tipos.js";

/** `n` si es positivo, `0n` si no (el mínimo no sujeto nunca deja una base negativa). */
export function max0(n: bigint): bigint {
  return n < 0n ? 0n : n;
}

/**
 * `base * porcentaje / 100`, exacto en `bigint` (fracción `num/den`) y
 * redondeado UNA sola vez al final con `redondearComercial` del paquete —
 * nunca se redondea un resultado intermedio.
 *
 * @example aplicarPorcentaje(8_283_000n, "2"); // 165_660n (2% de 82.830,00)
 */
export function aplicarPorcentaje(base: bigint, porcentaje: string): bigint {
  const texto = porcentaje.trim();
  const negativo = texto.startsWith("-");
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [enteraCruda, decimalCruda = ""] = sinSigno.split(".");
  const entera = enteraCruda === "" ? "0" : enteraCruda;
  const numeroPct = BigInt(entera + decimalCruda) * (negativo ? -1n : 1n);
  const den = 10n ** BigInt(decimalCruda.length) * 100n;
  return redondearComercial(base * numeroPct, den);
}

/**
 * Reduce `importe` por el `porcentaje` de la exclusión/certificado de no
 * retención (100 = exclusión total → `0n`); `null` = sin exclusión, no
 * cambia nada.
 */
export function aplicarExclusion(importe: bigint, exclusion: Exclusion | null): bigint {
  if (!exclusion) return importe;
  return importe - aplicarPorcentaje(importe, exclusion.porcentaje);
}

/** `8283000n` → `"82.830,00"` (es-AR: punto de miles, coma decimal) — solo para `explicacion`. */
export function formatearPesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const enteros = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimales = (abs % 100n).toString().padStart(2, "0");
  return `${negativo ? "-" : ""}${enteros},${decimales}`;
}

/**
 * Proporción del `neto` de un documento que corresponde a `pagado` centavos
 * (de `documento.total`): `netoDelPago(documento, pagado)`.
 * Cuando `pagado` alcanza (o supera) el `total` del documento devuelve el
 * `neto` completo, sin pasar por el redondeo de la fracción: así, llamando
 * con el ACUMULADO pagado en cada pago y restando el resultado del pago
 * anterior, el último pago siempre absorbe el resto de redondeo y la suma
 * de los incrementos da EXACTO el `neto` del documento (mayor resto al
 * último pago).
 */
export function netoDelPago(documento: { neto: bigint; total: bigint }, pagado: bigint): bigint {
  if (documento.total <= 0n) return 0n;
  if (pagado >= documento.total) return documento.neto;
  return redondearComercial(documento.neto * pagado, documento.total);
}
