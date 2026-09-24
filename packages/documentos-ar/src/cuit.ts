/**
 * CUIT/CUIL: el documento que decide la letra de una factura y viaja a
 * ARCA (ex AFIP), que lo rechaza sin explicar nada útil. Un dígito
 * verificador mal desde un formulario se descubre semanas después, cuando
 * alguien quiere facturar y no puede.
 */
import { soloDigitos } from "./interno.js";

/** Prefijos de persona física. */
const PREFIJOS_PERSONA = new Set(["20", "23", "24", "27"]);
/** Prefijos de persona jurídica (empresa). */
const PREFIJOS_EMPRESA = new Set(["30", "33", "34"]);

export type TipoCuit = "persona" | "empresa";

export type CodigoErrorCuit =
  | "longitud_invalida"
  | "prefijo_invalido"
  | "digito_verificador_invalido";

export type ResultadoCuit =
  | { ok: true; normalizado: string; tipo: TipoCuit }
  | { ok: false; motivo: string; codigo: CodigoErrorCuit };

const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * El dígito verificador de un CUIT/CUIL sobre sus primeros diez dígitos, por
 * el algoritmo de ARCA: pesos 5,4,3,2,7,6,5,4,3,2, resto de dividir la suma
 * por 11.
 *
 * **Puede devolver 10.** No es un bug: un CUIT real nunca puede tener ese
 * dígito verificador, porque el último carácter es un solo dígito (0-9), así
 * que ese resultado deja inválido cualquier número de 11 dígitos armado con
 * ese prefijo — sin que haga falta un caso especial acá. Ver el comentario
 * de `validarCuit` (regla 23/33) para qué hace ARCA con esos casos en la
 * práctica.
 */
function digitoVerificadorCuit(diez: string): number {
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(diez.charAt(i)) * PESOS_CUIT[i]!;
  const resto = suma % 11;
  return resto === 0 ? 0 : 11 - resto;
}

/**
 * Valida un CUIT/CUIL: 11 dígitos, prefijo conocido y dígito verificador
 * correcto. Acepta guiones, puntos y espacios. Nunca tira: la entrada de un
 * usuario, mal escrita o no, es un dato de negocio, no un bug del programa.
 *
 * ## El caso del dígito verificador 10 (regla 23/33)
 *
 * Para algunos DNI, el algoritmo estándar da dígito verificador 10 bajo el
 * prefijo natural (20 varón, 27 mujer, 30 empresa) — y como el último
 * carácter de un CUIT es un solo dígito, ese número **no existe**: cualquier
 * CUIT de 11 dígitos armado con ese prefijo y ese DNI es inválido, sea cual
 * sea su último dígito.
 *
 * En la práctica, ARCA resuelve estos casos reasignando el prefijo: el mismo
 * DNI que da DV=10 con 20 da DV=9 con 23 (varón); el que da DV=10 con 27 da
 * DV=4 con 23 (mujer); una empresa con DV=10 bajo 30 se resuelve con 33. No
 * es una tabla arbitraria — es consecuencia matemática de aplicar el MISMO
 * algoritmo con "23"/"33" en lugar de "20"/"27"/"30": cambiar el segundo
 * dígito del prefijo (peso 4) corre el resto de dividir por 11 lo suficiente
 * como para que el nuevo DV caiga en 0-9.
 *
 * Esta función **no hace esa reasignación sola**: no hay forma de saber, a
 * partir de un DNI, si a esa persona ARCA ya le asignó 20/27 o directamente
 * 23 (depende del trámite, no es derivable). `validarCuit("20" + dni + "?")`
 * de un DNI en este caso da `ok: false` con cualquier último dígito, tal
 * como corresponde: ese CUIT no existe. Quien integra este paquete prueba
 * con el prefijo que el cliente realmente tiene.
 */
export function validarCuit(valor: string): ResultadoCuit {
  const d = soloDigitos(valor);
  if (d.length !== 11) {
    return {
      ok: false,
      motivo: `Un CUIT/CUIL tiene 11 dígitos (tiene ${d.length}).`,
      codigo: "longitud_invalida",
    };
  }

  const prefijo = d.slice(0, 2);
  const tipo: TipoCuit | undefined = PREFIJOS_PERSONA.has(prefijo)
    ? "persona"
    : PREFIJOS_EMPRESA.has(prefijo)
      ? "empresa"
      : undefined;
  if (!tipo) {
    return {
      ok: false,
      motivo: `El prefijo "${prefijo}" no es válido para un CUIT/CUIL (20/23/24/27 persona, 30/33/34 empresa).`,
      codigo: "prefijo_invalido",
    };
  }

  const dv = digitoVerificadorCuit(d.slice(0, 10));
  if (dv !== Number(d.charAt(10))) {
    return {
      ok: false,
      motivo: "El dígito verificador no coincide.",
      codigo: "digito_verificador_invalido",
    };
  }

  return { ok: true, normalizado: d, tipo };
}

/**
 * `"20123456786"` → `"20-12345678-6"`. Un valor que no llega a 11 dígitos
 * (tras sacarle guiones, puntos y espacios) vuelve tal cual, sin formatear:
 * es mejor mostrar lo que se tipeó que inventar guiones sobre un número
 * incompleto.
 *
 * @example
 * formatearCuit("20-12345678-6"); // "20-12345678-6"
 * @example
 * formatearCuit("20123456786"); // "20-12345678-6"
 */
export function formatearCuit(valor: string): string {
  const d = soloDigitos(valor);
  if (d.length !== 11) return d;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}
