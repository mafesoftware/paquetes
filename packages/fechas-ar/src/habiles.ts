/**
 * Días hábiles: ni sábado ni domingo, ni un feriado.
 *
 * Los feriados NO están hardcodeados —varían por año, por país y a veces por
 * provincia— así que se **inyectan** como un `ReadonlySet<string>` de
 * `"YYYY-MM-DD"` (spec 06 §3.1: dependencias externas por parámetro). Cada
 * organización trae los suyos.
 */

import { diaDeSemanaISO, sumarDiasISOInterno, validarFechaISO } from "./interno.js";

const DOMINGO = 0;
const SABADO = 6;

/** `true` si `fecha` no cae sábado/domingo y no está en `feriados`. */
export function esHabil(fecha: string, feriados: ReadonlySet<string>): boolean {
  validarFechaISO(fecha);
  const diaSemana = diaDeSemanaISO(fecha);
  if (diaSemana === DOMINGO || diaSemana === SABADO) return false;
  return !feriados.has(fecha);
}

/**
 * El próximo día hábil a partir de `fecha`, INCLUSIVE: si `fecha` ya es
 * hábil, devuelve la misma `fecha` sin avanzar (documentado a propósito —
 * quien necesite "el siguiente distinto de este" suma un día antes de
 * llamar).
 *
 * Es la cuenta de "si el vencimiento cae feriado, se corre al primer día
 * hábil posterior".
 */
export function siguienteHabil(fecha: string, feriados: ReadonlySet<string>): string {
  validarFechaISO(fecha);
  let f = fecha;
  while (!esHabil(f, feriados)) {
    f = sumarDiasISOInterno(f, 1);
  }
  return f;
}

/**
 * El día hábil anterior a `fecha`, INCLUSIVE: si `fecha` ya es hábil,
 * devuelve la misma `fecha` sin retroceder — mismo criterio que
 * `siguienteHabil`, en la otra dirección.
 *
 * No la pide ningún caso de uso de esta versión (las cuotas se corren hacia
 * adelante); se agrega porque es el espejo exacto de `siguienteHabil` y
 * costó una línea.
 */
export function anteriorHabil(fecha: string, feriados: ReadonlySet<string>): string {
  validarFechaISO(fecha);
  let f = fecha;
  while (!esHabil(f, feriados)) {
    f = sumarDiasISOInterno(f, -1);
  }
  return f;
}
