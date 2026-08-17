/**
 * Qué letra lleva el comprobante y qué código de ARCA le corresponde.
 *
 * La regla fiscal es corta y es la que todo el mundo se sabe de memoria mal:
 *
 * - Emisor **responsable inscripto** → **A** a otro inscripto, **B** a todos
 *   los demás (consumidor final, exento, monotributista).
 * - Emisor **monotributista** o **exento** → **C** siempre, sin importar
 *   quién compra.
 *
 * Y desde la RG 5616, TODA factura electrónica declara la condición de IVA
 * del receptor (`condicionIVAReceptorId`), incluso la C al consumidor final.
 */

export type CondicionIVA =
  | "responsable_inscripto"
  | "monotributo"
  | "exento"
  | "consumidor_final"
  | "no_categorizado";

export type Letra = "A" | "B" | "C";

export type ClaseComprobante = "factura" | "nota_debito" | "nota_credito";

/** Los códigos de tipo de comprobante de ARCA, por letra y clase. */
const CODIGOS: Record<Letra, Record<ClaseComprobante, number>> = {
  A: { factura: 1, nota_debito: 2, nota_credito: 3 },
  B: { factura: 6, nota_debito: 7, nota_credito: 8 },
  C: { factura: 11, nota_debito: 12, nota_credito: 13 },
};

/**
 * Los ids de condición de IVA del receptor (RG 5616). ARCA rechaza el
 * comprobante si falta o si no es coherente con la letra.
 */
export const CONDICION_IVA_ID: Record<CondicionIVA, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
  no_categorizado: 7,
};

export function letraPara(
  emisor: CondicionIVA,
  receptor: CondicionIVA
): Letra {
  if (emisor === "monotributo" || emisor === "exento") return "C";
  if (emisor === "responsable_inscripto")
    return receptor === "responsable_inscripto" ? "A" : "B";
  // Un consumidor final no emite facturas: si llegó hasta acá, los datos del
  // emisor están mal cargados y es mejor que explote acá que en ARCA.
  throw new Error(`Un ${emisor} no puede emitir comprobantes.`);
}

/** El código de ARCA del comprobante: letra + clase. */
export function tipoComprobante(
  emisor: CondicionIVA,
  receptor: CondicionIVA,
  clase: ClaseComprobante = "factura"
): { letra: Letra; codigo: number } {
  const letra = letraPara(emisor, receptor);
  return { letra, codigo: CODIGOS[letra][clase] };
}

/* ---------- documentos ---------- */

/** Tipos de documento del receptor que acepta ARCA. */
export const DOC_TIPO = {
  cuit: 80,
  cuil: 86,
  dni: 96,
  /** Consumidor final sin identificar (hasta el tope que fija ARCA). */
  sin_identificar: 99,
} as const;

/* ---------- alícuotas de IVA ---------- */

/**
 * Los ids de alícuota del WSFEv1. Las tasas van en puntos básicos (2100 =
 * 21%) para que nadie tenga que decidir si 10.5 es un float confiable.
 */
export const ALICUOTAS_IVA = [
  { id: 3, nombre: "0%", puntosBasicos: 0 },
  { id: 9, nombre: "2,5%", puntosBasicos: 250 },
  { id: 8, nombre: "5%", puntosBasicos: 500 },
  { id: 4, nombre: "10,5%", puntosBasicos: 1050 },
  { id: 5, nombre: "21%", puntosBasicos: 2100 },
  { id: 6, nombre: "27%", puntosBasicos: 2700 },
] as const;

export function alicuotaPorId(id: number) {
  return ALICUOTAS_IVA.find((a) => a.id === id) ?? null;
}
