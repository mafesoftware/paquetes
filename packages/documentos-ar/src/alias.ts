/** Alias CBU: el apodo legible que reemplaza a un CBU/CVU al transferir. */

export type CodigoErrorAlias = "formato_invalido";

export type ResultadoAlias =
  | { ok: true; normalizado: string }
  | { ok: false; motivo: string; codigo: CodigoErrorAlias };

const ALIAS_RE = /^[a-z0-9.-]{6,20}$/;

/**
 * Valida un alias CBU: de 6 a 20 caracteres, solo minúsculas, dígitos, "."
 * y "-". La entrada no distingue mayúsculas de minúsculas — se normaliza a
 * minúsculas antes de validar, como hace cualquier banco al mostrarlo. No
 * se aplica ninguna otra regla (no hace falta que empiece con letra, ni que
 * tenga un punto): eso lo decide cada entidad al asignarlo, no quien valida.
 */
export function validarAlias(valor: string): ResultadoAlias {
  const normalizado = valor.trim().toLowerCase();
  if (!ALIAS_RE.test(normalizado)) {
    return {
      ok: false,
      motivo: 'Un alias tiene de 6 a 20 caracteres, solo letras, números, "." y "-".',
      codigo: "formato_invalido",
    };
  }
  return { ok: true, normalizado };
}
