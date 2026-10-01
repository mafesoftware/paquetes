/**
 * Plan de cuentas — núcleo PURO. Valida la FORMA de un árbol de cuentas
 * (duplicados, cuenta imputable con hijas, naturaleza heredada) y arma la
 * definición de un plan nuevo a partir de una plantilla ya cargada.
 *
 * No valida existencia de `padreCodigo` contra ninguna base — eso es
 * responsabilidad de la capa de datos del consumidor al insertar; acá solo
 * se verifica la consistencia interna del array que se le pasa.
 */

export type RubroNaturaleza = "activo" | "pasivo" | "pn" | "resultado_positivo" | "resultado_negativo";

export const RUBROS_NATURALEZA: readonly RubroNaturaleza[] = [
  "activo",
  "pasivo",
  "pn",
  "resultado_positivo",
  "resultado_negativo",
];

export function esRubroNaturaleza(x: unknown): x is RubroNaturaleza {
  return typeof x === "string" && (RUBROS_NATURALEZA as readonly string[]).includes(x);
}

/** Una cuenta del árbol, identificada por `codigo` (único dentro del plan) — forma que usan tanto la plantilla como una importación. */
export type DefinicionCuenta = {
  codigo: string;
  nombre: string;
  /** `null` = cuenta de primer nivel (raíz). */
  padreCodigo: string | null;
  imputable: boolean;
  moneda?: "ARS" | "USD" | "EUR";
  ajustaInflacion?: boolean;
  rubroNaturaleza: RubroNaturaleza;
};

/** Igual forma, para una plantilla de fábrica que el consumidor mantenga propia. */
export type DefinicionCuentaPlantilla = DefinicionCuenta;

export type ErrorArbolCuentas = { codigo: string; motivo: string };

export type ResultadoValidarArbol = { ok: true } | { ok: false; errores: ErrorArbolCuentas[] };

/**
 * Valida la forma del árbol completo:
 * - código duplicado en el plan → error;
 * - cuenta imputable con hijas → error (una cuenta imputable es una hoja);
 * - agrupación (no imputable) sin hijas se PERMITE (no es un error, aunque
 *   hoy no sirva de mucho: puede llenarse después);
 * - la naturaleza se hereda: una cuenta hija no puede declarar una
 *   naturaleza distinta de la de su raíz (la cuenta de primer nivel de la
 *   que desciende).
 */
export function validarArbol(cuentas: readonly DefinicionCuenta[]): ResultadoValidarArbol {
  const errores: ErrorArbolCuentas[] = [];
  const porCodigo = new Map<string, DefinicionCuenta>();
  const vistos = new Set<string>();

  for (const cuenta of cuentas) {
    if (vistos.has(cuenta.codigo)) {
      errores.push({ codigo: cuenta.codigo, motivo: `Código duplicado: "${cuenta.codigo}".` });
    }
    vistos.add(cuenta.codigo);
    // Si hay duplicados, `porCodigo` se queda con la última definición vista
    // (razonable: sirve solo para resolver padres, y el duplicado ya quedó
    // reportado arriba).
    porCodigo.set(cuenta.codigo, cuenta);
  }

  const hijasDe = new Set<string>();
  for (const cuenta of cuentas) {
    if (cuenta.padreCodigo != null) hijasDe.add(cuenta.padreCodigo);
  }

  for (const cuenta of cuentas) {
    if (cuenta.imputable && hijasDe.has(cuenta.codigo)) {
      errores.push({ codigo: cuenta.codigo, motivo: `"${cuenta.codigo}" es imputable y no puede tener sub-cuentas.` });
    }
  }

  for (const cuenta of cuentas) {
    const raiz = raizDe(cuenta, porCodigo);
    if (raiz && raiz.codigo !== cuenta.codigo && raiz.rubroNaturaleza !== cuenta.rubroNaturaleza) {
      errores.push({
        codigo: cuenta.codigo,
        motivo: `"${cuenta.codigo}" es "${cuenta.rubroNaturaleza}" pero su cuenta raíz "${raiz.codigo}" es "${raiz.rubroNaturaleza}"; la naturaleza se hereda.`,
      });
    }
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true };
}

/** Camino hacia arriba hasta la cuenta sin padre (o hasta cortar por un ciclo/padre inexistente, que no es este el lugar de reportar). */
function raizDe(cuenta: DefinicionCuenta, porCodigo: Map<string, DefinicionCuenta>): DefinicionCuenta | null {
  let actual = cuenta;
  const visitados = new Set<string>([cuenta.codigo]);
  while (actual.padreCodigo != null) {
    const padre = porCodigo.get(actual.padreCodigo);
    if (!padre || visitados.has(padre.codigo)) return actual; // ciclo o padre inexistente: no sigue subiendo
    visitados.add(padre.codigo);
    actual = padre;
  }
  return actual;
}

/** Nombre de plantilla: el vocabulario de plantillas lo define el consumidor (un string cualquiera, p.ej. `"basica"`). */
export type NombrePlantilla = string;

export type ResultadoPlanDesdePlantilla =
  | { ok: true; nombre: string; cuentas: DefinicionCuenta[] }
  | { ok: false; errores: ErrorArbolCuentas[] };

/**
 * Arma (sin persistir) la definición de un plan nuevo a partir de una
 * plantilla ya cargada por el consumidor — valida el árbol antes de
 * devolverlo. Quién persiste el resultado (dentro de una transacción) es
 * responsabilidad del consumidor.
 */
export function crearPlanDesdePlantilla(
  nombre: string,
  plantilla: NombrePlantilla,
  plantillas: Record<NombrePlantilla, readonly DefinicionCuenta[]>
): ResultadoPlanDesdePlantilla {
  const cuentas = plantillas[plantilla];
  if (!cuentas || cuentas.length === 0) {
    return { ok: false, errores: [{ codigo: plantilla, motivo: `No hay una plantilla cargada para "${plantilla}".` }] };
  }
  const validacion = validarArbol(cuentas);
  if (!validacion.ok) return { ok: false, errores: validacion.errores };
  return { ok: true, nombre, cuentas: cuentas.map((c) => ({ ...c })) };
}
