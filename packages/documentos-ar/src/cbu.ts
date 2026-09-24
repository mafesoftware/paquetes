/**
 * CBU y CVU: 22 dígitos en dos bloques, cada uno con su propio dígito
 * verificador. El CVU es un CBU de billetera virtual — mismo algoritmo,
 * arranca siempre con "000" — así que comparten toda la aritmética acá y
 * cada validador solo agrega la regla de prefijo que le corresponde.
 */
import { soloDigitos } from "./interno.js";

export type CodigoErrorCbu = "longitud_invalida" | "es_cvu" | "digito_verificador_invalido";

export type ResultadoCbu =
  | { ok: true; normalizado: string; banco: string }
  | { ok: false; motivo: string; codigo: CodigoErrorCbu };

export type CodigoErrorCvu = "longitud_invalida" | "no_es_cvu" | "digito_verificador_invalido";

export type ResultadoCvu =
  | { ok: true; normalizado: string }
  | { ok: false; motivo: string; codigo: CodigoErrorCvu };

/** Pesos del primer bloque (banco + sucursal, dígitos 1-7) para el DV1 (dígito 8). */
const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3] as const;
/** Pesos del segundo bloque (cuenta, dígitos 9-21) para el DV2 (dígito 22). */
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

/**
 * El dígito verificador de un bloque de CBU/CVU: `(10 − suma_ponderada %
 * 10) % 10`. La misma cuenta sirve para los dos bloques de los 22 dígitos,
 * cambiando solo los pesos y el tramo de dígitos que se pesan.
 */
function digitoVerificadorBloque(digitos: string, pesos: readonly number[]): number {
  let suma = 0;
  for (let i = 0; i < pesos.length; i++) suma += Number(digitos.charAt(i)) * pesos[i]!;
  return (10 - (suma % 10)) % 10;
}

/** El DV1 esperado para dígitos 1-8 (`d[0..6]` pesa, `d[7]` es el propio DV1). */
function digitoVerificador1(d: string): number {
  return digitoVerificadorBloque(d.slice(0, 7), PESOS_BLOQUE_1);
}

/** El DV2 esperado para dígitos 9-22 (`d[8..20]` pesa, `d[21]` es el propio DV2). */
function digitoVerificador2(d: string): number {
  return digitoVerificadorBloque(d.slice(8, 21), PESOS_BLOQUE_2);
}

/** Si los dos dígitos verificadores de un CBU/CVU de 22 dígitos coinciden. */
function digitosValidos(d: string): boolean {
  if (digitoVerificador1(d) !== Number(d.charAt(7))) return false;
  return digitoVerificador2(d) === Number(d.charAt(21));
}

/**
 * Valida un CBU: 22 dígitos con los dos dígitos verificadores correctos.
 * Rechaza los que empiecen con "000" — esos son CVU, no CBU — con un
 * motivo que dice a qué función llamar en su lugar. Nunca tira.
 */
export function validarCbu(valor: string): ResultadoCbu {
  const d = soloDigitos(valor);
  if (d.length !== 22) {
    return { ok: false, motivo: `Un CBU tiene 22 dígitos (tiene ${d.length}).`, codigo: "longitud_invalida" };
  }
  if (d.slice(0, 3) === "000") {
    return {
      ok: false,
      motivo: 'Empieza con "000": es un CVU, no un CBU. Probá con validarCvu.',
      codigo: "es_cvu",
    };
  }
  if (!digitosValidos(d)) {
    return {
      ok: false,
      motivo: "Alguno de los dos dígitos verificadores no coincide.",
      codigo: "digito_verificador_invalido",
    };
  }
  return { ok: true, normalizado: d, banco: d.slice(0, 3) };
}

/**
 * Valida un CVU: 22 dígitos, arranca con "000" y los mismos dos bloques de
 * dígito verificador que un CBU. Rechaza los que NO empiecen con "000" —
 * esos son CBU — con un motivo que dice a qué función llamar en su lugar.
 * Nunca tira.
 */
export function validarCvu(valor: string): ResultadoCvu {
  const d = soloDigitos(valor);
  if (d.length !== 22) {
    return { ok: false, motivo: `Un CVU tiene 22 dígitos (tiene ${d.length}).`, codigo: "longitud_invalida" };
  }
  if (d.slice(0, 3) !== "000") {
    return {
      ok: false,
      motivo: 'No empieza con "000": es un CBU, no un CVU. Probá con validarCbu.',
      codigo: "no_es_cvu",
    };
  }
  if (!digitosValidos(d)) {
    return {
      ok: false,
      motivo: "Alguno de los dos dígitos verificadores no coincide.",
      codigo: "digito_verificador_invalido",
    };
  }
  return { ok: true, normalizado: d };
}
