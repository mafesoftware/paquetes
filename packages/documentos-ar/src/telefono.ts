/**
 * Teléfonos celulares argentinos: de cualquier forma en que alguien los
 * escriba (con el "15" viejo, con o sin el "9" de celular, con o sin "0" de
 * larga distancia, con o sin "+54") a E.164, que es lo que piden las APIs
 * de mensajería.
 */
import { soloDigitos } from "./interno.js";

/**
 * De los dígitos ya sin código de país ni "9" de celular ni "0" de larga
 * distancia, a los 10 dígitos combinados de área + abonado.
 *
 * **No hay una tabla de códigos de área acá.** La heurística es que área +
 * abonado suman siempre 10 dígitos, y que — si la persona escribió el "15"
 * de celular entre el área y el abonado, como se marca en el teléfono fijo
 * de origen — hay que encontrarlo para sacarlo:
 *
 * - Si ya vienen 10 dígitos, no hay "15" de por medio: el valor ya es
 *   área+abonado tal cual.
 * - Si vienen 12, sobran los dos del "15". Los códigos de área argentinos
 *   miden de 2 a 4 dígitos, y el único de 2 es "11" (Buenos Aires) — ningún
 *   otro empieza con "1" —, así que si el número empieza con "1" el área
 *   mide 2 sin ambigüedad. El resto empieza con "2" o "3" y mide 3 o 4: se
 *   prueba primero con 3 (la mayoría de las ciudades) y, si el "15" no cae
 *   ahí, con 4.
 * - Cualquier otro largo no se puede resolver: se devuelve `null`.
 */
function areaMasAbonado(digitos: string): string | null {
  if (digitos.length === 10) return digitos;
  if (digitos.length !== 12) return null;

  const candidatos = digitos.startsWith("1") ? [2] : [3, 4];
  for (const largo of candidatos) {
    if (digitos.slice(largo, largo + 2) === "15") {
      return digitos.slice(0, largo) + digitos.slice(largo + 2);
    }
  }
  return null;
}

/**
 * Normaliza un celular argentino a E.164: `"+549"` + área + abonado (10
 * dígitos). Entiende cualquier combinación de "+54", "9", "0" inicial y
 * "15", separados con espacios, guiones o paréntesis. `null` si no se puede
 * determinar el número.
 *
 * @example
 * telefonoAE164("011 15-4444-5555"); // "+5491144445555"
 * @example
 * telefonoAE164("+54 9 11 4444-5555"); // "+5491144445555"
 * @example
 * telefonoAE164("(0351) 15 555-1234"); // "+5493515551234"
 */
export function telefonoAE164(valor: string): string | null {
  let d = soloDigitos(valor);
  if (d.startsWith("54")) {
    d = d.slice(2);
  } else if (d.startsWith("0")) {
    d = d.slice(1);
  }
  if (d.startsWith("9")) {
    d = d.slice(1);
  }
  const combinado = areaMasAbonado(d);
  return combinado === null ? null : `+549${combinado}`;
}

/**
 * El mismo número, en el formato que espera la API de WhatsApp: E.164 sin
 * el `"+"`. `null` si `telefonoAE164` no puede determinarlo.
 *
 * @example
 * aWhatsApp("011 15-4444-5555"); // "5491144445555"
 */
export function aWhatsApp(valor: string): string | null {
  const e164 = telefonoAE164(valor);
  return e164 === null ? null : e164.slice(1);
}
