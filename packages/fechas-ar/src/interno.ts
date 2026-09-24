/**
 * Validación y aritmética de calendario compartidas por `periodo.ts`,
 * `meses.ts`, `habiles.ts` y `index.ts`. La mayor parte de este módulo NO se
 * re-exporta desde `index.ts` (es detalle de implementación, igual que
 * `escala-factor.ts` en `plata-ar`), con dos excepciones: `diaDeSemanaISO` y
 * `sumarDiasISOInterno` son la única implementación de `diaDeSemana`/
 * `sumarDiasISO` (API 0.1) — `index.ts` las importa de acá y las re-exporta
 * bajo esos nombres públicos, en vez de tener una segunda copia. Viven en
 * este módulo base (que no depende de nada) y no en `index.ts` para que
 * `habiles.ts` pueda usarlas sin que `index.ts` (que re-exporta `habiles.ts`)
 * termine importándose a sí mismo.
 *
 * El resto es aritmética entera pura sobre año/mes/día — sin `Date`, para no
 * depender de zona horaria ni de los límites de rango de `Date` (año 275760).
 */

import { ErrorFecha } from "./errores.js";

const DIAS_POR_MES: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Año bisiesto, regla gregoriana completa (incluye el caso -400/-100). */
export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** Cuántos días tiene `mes` (1..12) de `anio`. */
export function diasEnMes(anio: number, mes: number): number {
  if (mes === 2 && esBisiesto(anio)) return 29;
  // `mes` siempre llega 1..12 (los llamadores lo validan antes con
  // `validarFechaISO`/`validarMesPeriodo`), así que el índice nunca da
  // `undefined`.
  return DIAS_POR_MES[mes - 1]!;
}

export interface FechaDescompuesta {
  anio: number;
  mes: number;
  dia: number;
}

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida que `fecha` sea `"YYYY-MM-DD"` con un día de calendario real, y la
 * descompone. Tira `ErrorFecha` si no: formato roto (`formato_invalido`) o
 * calendario imposible como `"2026-02-30"`/`"2026-13-01"` (`fecha_invalida`).
 */
export function validarFechaISO(fecha: string): FechaDescompuesta {
  const m = FORMATO_FECHA.exec(fecha);
  if (!m) {
    throw new ErrorFecha(
      "formato_invalido",
      `Fecha con formato inválido: "${fecha}" (se espera "YYYY-MM-DD")`,
    );
  }
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12) {
    throw new ErrorFecha("fecha_invalida", `Mes inválido en "${fecha}"`);
  }
  if (dia < 1 || dia > diasEnMes(anio, mes)) {
    throw new ErrorFecha("fecha_invalida", `Día inválido en "${fecha}": ${mes}/${anio} no tiene ese día`);
  }
  return { anio, mes, dia };
}

const FORMATO_PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Valida `"YYYY-MM"` y lo descompone. Tira `ErrorFecha` (`formato_invalido`) si no matchea. */
export function validarPeriodo(periodo: string): { anio: number; mes: number } {
  const m = FORMATO_PERIODO.exec(periodo);
  if (!m) {
    throw new ErrorFecha(
      "formato_invalido",
      `Período con formato inválido: "${periodo}" (se espera "YYYY-MM", mes 01..12)`,
    );
  }
  return { anio: Number(m[1]), mes: Number(m[2]) };
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * De un total de meses transcurridos desde el mes 0 del año 0 (es decir,
 * `anio * 12 + (mes - 1)`, mes 1..12) de vuelta a `{ anio, mes }` con `mes`
 * 1..12. Aritmética entera pura con `Math.floor` (no `%`, que en JS da signo
 * negativo con un dividendo negativo): así "restar" meses con un `totalMeses`
 * negativo normaliza igual de bien que sumar.
 */
export function deMesesTotales(totalMeses: number): { anio: number; mes: number } {
  const anio = Math.floor(totalMeses / 12);
  const mes = totalMeses - anio * 12 + 1;
  return { anio, mes };
}

/** El total de meses (mes 1..12) de un `{ anio, mes }`, base para `deMesesTotales`. */
export function aMesesTotales(anio: number, mes: number): number {
  return anio * 12 + (mes - 1);
}

/**
 * Día de la semana (0 = domingo) de un día de calendario. `Date` en UTC
 * puro, sin `getHours`. Implementación única de `diaDeSemana` (API 0.1):
 * `index.ts` la importa de acá y la re-exporta con ese nombre — ver el
 * comentario de arriba.
 */
export function diaDeSemanaISO(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/**
 * Suma `dias` (puede ser negativo) a un día de calendario, sin pasar por
 * husos. Implementación única de `sumarDiasISO` (API 0.1); misma nota que
 * `diaDeSemanaISO`.
 */
export function sumarDiasISOInterno(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
