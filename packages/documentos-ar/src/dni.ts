/** DNI argentino: 7 u 8 dígitos. Los viejos de 6 ya no circulan. */
import { soloDigitos } from "./interno.js";

export type CodigoErrorDni = "longitud_invalida" | "cero_invalido";

export type ResultadoDni =
  | { ok: true; normalizado: string }
  | { ok: false; motivo: string; codigo: CodigoErrorDni };

/**
 * Valida un DNI: 7 u 8 dígitos, aceptando los puntos de miles con los que
 * se suele escribir (`"12.345.678"`). Nunca tira.
 *
 * Se rechaza el cero y cualquier valor con un cero a la izquierda: ningún
 * DNI real empieza con 0 — la numeración arranca bien arriba de cero—, así
 * que un cero inicial es casi siempre un campo vacío rellenado a mano o un
 * error de tipeo, nunca un documento real.
 */
export function validarDni(valor: string): ResultadoDni {
  const d = soloDigitos(valor);
  if (d.length < 7 || d.length > 8) {
    return {
      ok: false,
      motivo: `Un DNI tiene 7 u 8 dígitos (tiene ${d.length}).`,
      codigo: "longitud_invalida",
    };
  }
  if (d.charAt(0) === "0") {
    return {
      ok: false,
      motivo: "Un DNI no empieza con 0.",
      codigo: "cero_invalido",
    };
  }
  return { ok: true, normalizado: d };
}
