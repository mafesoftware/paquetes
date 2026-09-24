/**
 * Períodos mensuales (`"YYYY-MM"`), spec 02 §6: "Períodos mensuales como
 * `YYYY-MM` (tipo propio con validación)".
 *
 * Un período NO es un día: es el mes entero, y se usa para agrupar (el
 * resumen de septiembre de 2026 es `"2026-09"`), no para vencer nada — para
 * eso está una fecha de calendario de verdad.
 */

import { aMesesTotales, deMesesTotales, pad2, validarFechaISO, validarPeriodo } from "./interno.js";

/** Los dos dígitos de un mes, `"01"`..`"12"`. */
type MesDosDigitos =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10"
  | "11"
  | "12";

/**
 * Un período mensual: `"2026-09"`. El tipo es una guía para quien escribe
 * (autocompleta el mes de dos dígitos), no una garantía en runtime — un
 * `string` cualquiera se puede afirmar como `Periodo` sin pasar por
 * `esPeriodo`. Para validar de verdad un valor que no se sabe de dónde vino
 * (un query param, una fila de CSV), usar `esPeriodo`.
 */
export type Periodo = `${number}-${MesDosDigitos}`;

/** Valida en runtime que `s` sea un `Periodo` real: `"YYYY-MM"`, mes 01..12. */
export function esPeriodo(s: string): s is Periodo {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** El período (`"YYYY-MM"`) al que pertenece un día de calendario `"YYYY-MM-DD"`. */
export function periodoDe(fecha: string): Periodo {
  const { anio, mes } = validarFechaISO(fecha);
  return `${anio}-${pad2(mes)}` as Periodo;
}

/**
 * Suma `n` meses a un período. `n` negativo resta, `n === 0` lo devuelve
 * igual. Aritmética entera pura (ver `interno.ts`): sin límite de rango.
 *
 * @example
 * sumarPeriodos("2026-11", 3); // "2027-02"
 */
export function sumarPeriodos(p: Periodo, n: number): Periodo {
  const { anio, mes } = validarPeriodo(p);
  const { anio: anioResultado, mes: mesResultado } = deMesesTotales(aMesesTotales(anio, mes) + n);
  return `${anioResultado}-${pad2(mesResultado)}` as Periodo;
}

const MESES_ABREV_ES: readonly string[] = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/**
 * El período, legible: `"2026-09"` → `"sep-2026"` (spec 02 §6: "meses:
 * `sep-2026`"). Abreviaturas de tres letras, minúsculas, en español.
 */
export function etiquetaPeriodo(p: Periodo): string {
  const { anio, mes } = validarPeriodo(p);
  // `validarPeriodo` ya garantizó mes 01..12, así que el índice nunca da
  // `undefined`.
  const abrev = MESES_ABREV_ES[mes - 1]!;
  return `${abrev}-${anio}`;
}
