/**
 * IVA por alícuota argentina (21, 10,5, 27, 0, exento, no gravado). Función
 * PURA: sin DB, sin framework.
 *
 * Cada alícuota es una fracción EXACTA en `bigint` (nunca un `number`
 * decimal): `10_5` es `105/1000`, no `10.5/100` — el guion bajo evita el
 * punto decimal que un enum/columna de base de datos no siempre admite en
 * su valor.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";

export type AlicuotaIva = "21" | "10_5" | "27" | "0" | "exento" | "no_gravado";

export const ALICUOTAS_IVA: readonly AlicuotaIva[] = ["21", "10_5", "27", "0", "exento", "no_gravado"];

const FRACCION_POR_ALICUOTA: Record<AlicuotaIva, { num: bigint; den: bigint }> = {
  "21": { num: 21n, den: 100n },
  "10_5": { num: 105n, den: 1000n },
  "27": { num: 27n, den: 100n },
  "0": { num: 0n, den: 1n },
  exento: { num: 0n, den: 1n },
  no_gravado: { num: 0n, den: 1n },
};

/**
 * El IVA de un subtotal (en centavos) a la alícuota dada, redondeado al
 * centavo (redondeo comercial, medio hacia arriba).
 *
 * @example
 * calcularIva(100_000n, "21");   // 21_000n ($210,00 de IVA sobre $1000)
 * calcularIva(100_000n, "10_5"); // 10_500n
 * calcularIva(100_000n, "exento"); // 0n
 */
export function calcularIva(subtotalCentavos: bigint, alicuota: AlicuotaIva): bigint {
  const { num, den } = FRACCION_POR_ALICUOTA[alicuota];
  if (num === 0n) return 0n;
  return redondearComercial(subtotalCentavos * num, den);
}

export function esAlicuotaIva(x: unknown): x is AlicuotaIva {
  return typeof x === "string" && (ALICUOTAS_IVA as readonly string[]).includes(x);
}
