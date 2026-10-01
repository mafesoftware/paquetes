/**
 * Aritmética de cantidades físicas (m³, kg, m², unidades) en decimal
 * `string`, NUNCA `number` — mismo motivo que `plata-ar` para la plata:
 * una cantidad multiplicada por un precio no puede perder precisión en un
 * paso intermedio.
 *
 * Interno del paquete (como `decimal.ts` en `indices-ar`): el tipo
 * `Cantidad` se re-exporta desde `index.ts` porque la API pública lo usa
 * en sus firmas, pero `multiplicar`/`sumarCantidades` son un detalle de
 * implementación de `costo-promedio.ts`/`inventario.ts`, no se
 * re-exportan.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";

/** Decimal con hasta 4 decimales ("120", "833.3333"). Nunca `number`. */
export type Cantidad = string;

const DECIMALES = 4;
const ESCALA = 10n ** BigInt(DECIMALES);
const FORMATO = /^-?\d+(\.\d{1,4})?$/;

function escalar(cantidad: Cantidad): bigint {
  const texto = cantidad.trim();
  if (!FORMATO.test(texto)) {
    throw new Error(`cantidad inválida: "${cantidad}" (se espera un decimal de hasta ${DECIMALES} decimales)`);
  }
  const negativo = texto.startsWith("-");
  const sinSigno = negativo ? texto.slice(1) : texto;
  const [entero = "0", decimal = ""] = sinSigno.split(".");
  const valor = BigInt(entero) * ESCALA + BigInt(decimal.padEnd(DECIMALES, "0"));
  return negativo ? -valor : valor;
}

function formatearDecimal(valorEscalado: bigint, decimales: number): string {
  const escala = 10n ** BigInt(decimales);
  const negativo = valorEscalado < 0n;
  const abs = negativo ? -valorEscalado : valorEscalado;
  const entero = abs / escala;
  const frac = (abs % escala).toString().padStart(decimales, "0");
  return `${negativo ? "-" : ""}${entero}.${frac}`;
}

/** `cantidad × precioUnitario` (centavos), redondeo comercial (medio hacia arriba) al centavo, una sola vez. */
export function multiplicar(cantidad: Cantidad, precioUnitario: bigint): bigint {
  return redondearComercial(precioUnitario * escalar(cantidad), ESCALA);
}

/** Σ de cantidades, sin perder precisión (misma escala de 4 decimales). */
export function sumarCantidades(xs: readonly Cantidad[]): Cantidad {
  const total = xs.reduce((acc, x) => acc + escalar(x), 0n);
  return formatearDecimal(total, DECIMALES);
}
