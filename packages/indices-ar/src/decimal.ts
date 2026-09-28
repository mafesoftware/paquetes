/**
 * Aritmética decimal exacta en `bigint`, sin pasar nunca por `number`.
 *
 * Interno del paquete (como `escala-factor.ts` en `plata-ar`): la forma
 * `{ negativo, valorAbs, escala }` es un detalle de implementación de
 * `valorPolinomica`, `puntosIndice`, `saldoDesdePuntos` y `ajusteConTope` —
 * no se re-exporta desde `index.ts`.
 *
 * Un decimal `"123.45"` se representa como `valorAbs = 12345n`,
 * `escala = 2` (`123.45 === 12345 / 10^2`). Dos decimales con distinta
 * escala se llevan a la escala MAYOR antes de sumar/comparar (multiplicando
 * por la potencia de 10 que falta) — así la suma es exacta, sin resto ni
 * redondeo intermedio.
 */
import { ErrorIndices } from "./errores.js";

export interface DecimalExacto {
  negativo: boolean;
  /** Los dígitos, sin signo, como entero: `"123.45"` -> `12345n`. */
  valorAbs: bigint;
  /** Cuántos de esos dígitos son decimales. */
  escala: number;
}

const PATRON_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parsea un decimal arbitrario (`"-12.345"`, `"7"`, `"0.1"`) a `DecimalExacto`. Tira `ErrorIndices("valor_invalido")` si `texto` no tiene esa forma. */
export function analizarDecimal(texto: string, contexto: string): DecimalExacto {
  const limpio = texto.trim();
  const coincidencia = PATRON_DECIMAL.exec(limpio);
  if (!coincidencia) {
    throw new ErrorIndices("valor_invalido", `${contexto}: "${texto}" no es un decimal válido.`);
  }
  const negativo = coincidencia[1] === "-";
  const entero = coincidencia[2]!;
  const decimales = coincidencia[3] ?? "";
  const valorAbs = BigInt(entero + decimales);
  // "-0", "-0.00": no hay negativo que valga si el valor absoluto es 0.
  return { negativo: negativo && valorAbs !== 0n, valorAbs, escala: decimales.length };
}

/** El `bigint` con signo de un `DecimalExacto` (a su propia escala). */
export function aBigIntConSigno(d: DecimalExacto): bigint {
  return d.negativo ? -d.valorAbs : d.valorAbs;
}

/**
 * Formatea un `bigint` con signo, a una escala dada, como decimal string sin
 * ceros de más (misma forma que `factorEntre` en `plata-ar`): `escala = 2` y
 * `valor = 12340n` -> `"123.4"`.
 */
export function formatearDecimal(valor: bigint, escala: number): string {
  const negativo = valor < 0n;
  const abs = negativo ? -valor : valor;
  const signo = negativo ? "-" : "";

  if (escala === 0) return `${signo}${abs.toString()}`;

  const texto = abs.toString().padStart(escala + 1, "0");
  const entero = texto.slice(0, texto.length - escala);
  const decimalesCrudos = texto.slice(texto.length - escala);
  const decimales = decimalesCrudos.replace(/0+$/, "");
  const sufijo = decimales.length > 0 ? `.${decimales}` : "";
  return `${signo}${entero}${sufijo}`;
}

/** Escala un `bigint` con signo de `desde` a `hasta` decimales (`hasta >= desde`), exacto. */
export function escalarA(valor: bigint, desde: number, hasta: number): bigint {
  if (hasta < desde) {
    throw new Error(`escalarA: "hasta" (${hasta}) no puede ser menor que "desde" (${desde}).`);
  }
  return hasta === desde ? valor : valor * 10n ** BigInt(hasta - desde);
}

/**
 * Suma dos decimales exactos (cada uno con su propio `valor`/`escala`),
 * llevados a la escala mayor de los dos antes de sumar.
 */
export function sumarExacto(
  a: { valor: bigint; escala: number },
  b: { valor: bigint; escala: number },
): { valor: bigint; escala: number } {
  const escala = Math.max(a.escala, b.escala);
  return { valor: escalarA(a.valor, a.escala, escala) + escalarA(b.valor, b.escala, escala), escala };
}
