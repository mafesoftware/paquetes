/**
 * Cantidades físicas (m³, kg, m², unidades) — decimal como `string`, NUNCA
 * `number` cuando multiplica un precio: un `number` pierde precisión en
 * cuanto el decimal no es exacto en binario (ej. `0.1`), y eso se nota
 * recién cuando el total no cierra contra lo que espera el proveedor.
 *
 * Núcleo puro, sin DB ni framework. `multiplicar`/`porcentajeDe` usan
 * `redondearComercial` de `@mafesoftware/plata-ar` (medio hacia arriba, una
 * sola vez, al final) para no reimplementar esa regla acá.
 */
import { redondearComercial } from "@mafesoftware/plata-ar";

/** Decimal con hasta 4 decimales (`"120"`, `"833.3333"`). Nunca `number`. */
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

/** `cantidad × precioUnitario` (centavos), redondeo comercial al centavo, una sola vez. */
export function multiplicar(cantidad: Cantidad, precioUnitario: bigint): bigint {
  return redondearComercial(precioUnitario * escalar(cantidad), ESCALA);
}

/** `(parte / total) × 100`, con 4 decimales (`"15.0000"`). `total = "0"` → `"0.0000"` (evita dividir por cero). */
export function porcentajeDe(parte: Cantidad, total: Cantidad): string {
  const p = escalar(parte);
  const t = escalar(total);
  if (t === 0n) return formatearDecimal(0n, DECIMALES);
  const escalaPct = 10n ** BigInt(DECIMALES);
  const numerador = p * 100n * escalaPct;
  return formatearDecimal(redondearComercial(numerador, t), DECIMALES);
}

/** Σ de cantidades, sin perder precisión (misma escala de 4 decimales). */
export function sumarCantidades(xs: readonly Cantidad[]): Cantidad {
  const total = xs.reduce((acc, x) => acc + escalar(x), 0n);
  return formatearDecimal(total, DECIMALES);
}

/** `a - b` de dos `Cantidad`, sin pasar por `number`. */
export function restarCantidades(a: Cantidad, b: Cantidad): Cantidad {
  const bTrim = b.trim();
  const negado = bTrim.startsWith("-") ? bTrim.slice(1) : `-${bTrim}`;
  return sumarCantidades([a, negado]);
}

/** Signo de `a - b`: `1` si `a > b`, `-1` si `a < b`, `0` si son iguales. */
export function compararCantidades(a: Cantidad, b: Cantidad): number {
  const diferencia = restarCantidades(a, b);
  if (/^-?0(\.0+)?$/.test(diferencia)) return 0;
  return diferencia.startsWith("-") ? -1 : 1;
}

/** La menor de dos `Cantidad`. */
export function menorCantidad(a: Cantidad, b: Cantidad): Cantidad {
  return compararCantidades(a, b) <= 0 ? a : b;
}
