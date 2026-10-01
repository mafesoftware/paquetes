/**
 * Mapeos contables — núcleo PURO. `ClaveMapeo` es un vocabulario base de
 * claves de mapeo (cuenta por caja, por tipo de operación, por rubro/ítem,
 * deudores/proveedores, IVA, retenciones/percepciones, diferencia de
 * cambio...); `resolverCuenta` es lo único que necesita el motor que arma
 * un asiento a partir de un documento para resolver una clave contra el
 * mapa vigente de la organización — sin DB, recibe el `Record<string,
 * string>` ya cargado. `calcularFaltantes` es el motor puro de una pantalla
 * de "faltantes": el consumidor le pasa las entidades reales (cajas, tipos
 * de operación, rubros) y el mapa vigente, esto solo compara.
 *
 * El vocabulario parametrizado adicional que necesite cada producto (una
 * clave propia de su dominio) se arma igual, con el mismo patrón de
 * template string — no hace falta que viva en este paquete.
 *
 * Nada de esto persiste: crear/asignar cuentas de plantilla y guardar un
 * mapeo puntual son acciones del consumidor, que sí tocan su base.
 */

export type FaltaMapeo = { clave: string; descripcion: string };

/**
 * Vocabulario base de claves de mapeo. Las parametrizadas toman un id (o un
 * régimen/jurisdicción/concepto) real — `CLAVE` de acá abajo arma el
 * string, nunca a mano en otro archivo.
 */
export type ClaveMapeo =
  | `caja:${string}`
  | `tipo_operacion:${string}`
  | `rubro:${string}`
  | `item:${string}`
  | "deudores"
  | "anticipos_clientes"
  | "proveedores"
  | "anticipos_proveedores"
  | `iva_ventas:${string}`
  | `iva_compras:${string}`
  | `percepcion_sufrida:${string}`
  | `retencion_sufrida:${string}`
  | `retencion_practicada:${string}`
  | `percepcion_practicada:${string}`
  | "diferencia_cambio_positiva"
  | "diferencia_cambio_negativa"
  | "ajuste_indice"
  | "intereses_mora"
  | `venta:${string}`
  | "valores_a_depositar"
  | "valores_diferidos"
  | `tarjeta:${string}`
  | "costo_financiero"
  | "gastos_bancarios"
  | "diferencias_caja"
  | "fondo_reparo"
  | "devoluciones_clientes"
  | "otros_ingresos"
  | "resultado_ejercicio"
  | "recpam";

/** Arma cada clave parametrizada — así ningún otro archivo interpola el string a mano. */
export const CLAVE = {
  caja: (id: string): ClaveMapeo => `caja:${id}`,
  tipoOperacion: (id: string): ClaveMapeo => `tipo_operacion:${id}`,
  rubro: (id: string): ClaveMapeo => `rubro:${id}`,
  item: (id: string): ClaveMapeo => `item:${id}`,
  ivaVentas: (alicuotaId: string | number): ClaveMapeo => `iva_ventas:${alicuotaId}`,
  ivaCompras: (alicuotaId: string | number): ClaveMapeo => `iva_compras:${alicuotaId}`,
  percepcionSufrida: (regimen: string, jurisdiccion?: string): ClaveMapeo => `percepcion_sufrida:${regimen}${jurisdiccion ? `:${jurisdiccion}` : ""}`,
  retencionSufrida: (regimen: string): ClaveMapeo => `retencion_sufrida:${regimen}`,
  retencionPracticada: (regimen: string): ClaveMapeo => `retencion_practicada:${regimen}`,
  percepcionPracticada: (jurisdiccion: string): ClaveMapeo => `percepcion_practicada:${jurisdiccion}`,
  venta: (conceptoFacturable: string): ClaveMapeo => `venta:${conceptoFacturable}`,
  tarjeta: (id: string): ClaveMapeo => `tarjeta:${id}`,
} as const;

/** Claves fijas (no parametrizadas) que un consumidor típico necesita mapeadas — p.ej. para mostrar una solapa "Otros" de mapeos pendientes. */
export const CLAVES_OTROS: readonly ClaveMapeo[] = [
  "deudores",
  "anticipos_clientes",
  "proveedores",
  "anticipos_proveedores",
  "diferencia_cambio_positiva",
  "diferencia_cambio_negativa",
  "ajuste_indice",
  "intereses_mora",
  "valores_a_depositar",
  "valores_diferidos",
  "costo_financiero",
  "gastos_bancarios",
  "diferencias_caja",
  "fondo_reparo",
  "devoluciones_clientes",
  "otros_ingresos",
  "resultado_ejercicio",
  "recpam",
];

function descripcionGenerica(clave: string): string {
  return `Falta asignar una cuenta contable para "${clave}".`;
}

/**
 * Resuelve una clave contra el mapa vigente. Sin `fallback` (o con
 * `fallback` también sin mapear), devuelve el `FaltaMapeo` — nunca tira: el
 * consumidor lo usa para acumular todos los que faltan antes de rechazar el
 * asiento entero.
 */
export function resolverCuenta(mapeos: Record<string, string>, clave: ClaveMapeo, fallback?: ClaveMapeo): string | FaltaMapeo {
  const directa = mapeos[clave];
  if (directa) return directa;
  if (fallback) {
    const deFallback = mapeos[fallback];
    if (deFallback) return deFallback;
  }
  return { clave, descripcion: descripcionGenerica(clave) };
}

export type EntidadCaja = { id: string; nombre: string; moneda: "ARS" | "USD" | "EUR" };
export type EntidadTipoOperacion = { id: string; nombre: string };
export type EntidadRubro = { id: string; codigo: string; nombre: string };

export type ResultadoFaltantes = {
  cajasSinCuenta: FaltaMapeo[];
  tiposSinCuenta: FaltaMapeo[];
  rubrosSinCuenta: FaltaMapeo[];
  otros: FaltaMapeo[];
};

/**
 * Compara las entidades vivas (cajas activas, tipos de operación activos,
 * rubros vigentes) contra el mapa de mapeos ya cargado — puro, sin
 * consultar nada. Una entidad nueva (una caja recién creada, por ejemplo)
 * que todavía no tiene fila mapeada sale en su lista correspondiente, sin
 * que nadie tenga que acordarse de mapearla a mano.
 */
export function calcularFaltantes(p: {
  cajas: readonly EntidadCaja[];
  tiposOperacion: readonly EntidadTipoOperacion[];
  rubros: readonly EntidadRubro[];
  mapeos: Record<string, string>;
}): ResultadoFaltantes {
  const cajasSinCuenta = p.cajas
    .filter((c) => !p.mapeos[CLAVE.caja(c.id)])
    .map((c) => ({ clave: CLAVE.caja(c.id), descripcion: `Caja "${c.nombre}" no tiene cuenta asignada.` }));
  const tiposSinCuenta = p.tiposOperacion
    .filter((t) => !p.mapeos[CLAVE.tipoOperacion(t.id)])
    .map((t) => ({ clave: CLAVE.tipoOperacion(t.id), descripcion: `Tipo de operación "${t.nombre}" no tiene cuenta asignada.` }));
  const rubrosSinCuenta = p.rubros
    .filter((r) => !p.mapeos[CLAVE.rubro(r.id)])
    .map((r) => ({ clave: CLAVE.rubro(r.id), descripcion: `Rubro ${r.codigo} ${r.nombre} no tiene cuenta de costo.` }));
  const otros = CLAVES_OTROS.filter((clave) => !p.mapeos[clave]).map((clave) => ({ clave, descripcion: descripcionGenerica(clave) }));
  return { cajasSinCuenta, tiposSinCuenta, rubrosSinCuenta, otros };
}

/**
 * Próximo código libre bajo un prefijo (`"1.1.1"` → `"1.1.1.01"`,
 * `"1.1.1.02"`...) mirando los códigos YA existentes en el plan — útil para
 * crear una subcuenta nueva (p.ej. una por caja) sin chocar con una ya
 * creada a mano.
 */
export function siguienteCodigoSubcuenta(codigosExistentes: readonly string[], prefijo: string): string {
  let max = 0;
  const patron = new RegExp(`^${prefijo.replace(/\./g, "\\.")}\\.(\\d+)$`);
  for (const codigo of codigosExistentes) {
    const m = patron.exec(codigo);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const siguiente = max + 1;
  return `${prefijo}.${String(siguiente).padStart(2, "0")}`;
}
