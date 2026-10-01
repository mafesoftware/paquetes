/**
 * Clasificación de líneas de extracto que NO tienen contraparte en el
 * sistema (impuestos, comisiones, intereses bancarios): `clasificarSoloExtracto`.
 * Reglas por defecto a partir de las descripciones típicas de un extracto
 * bancario argentino; el llamador puede pasar las suyas (config por
 * organización/banco).
 */

export type ReglaClasificacion = { patron: RegExp; tipoOperacion: string };

export const REGLAS_CLASIFICACION_DEFECTO: ReglaClasificacion[] = [
  { patron: /IMP\.?\s*LEY\s*25\.?413|IMPUESTO\s*(DEB|CRED)/i, tipoOperacion: "impuesto_debitos_creditos" },
  { patron: /COMISION|MANTENIMIENTO/i, tipoOperacion: "comision_bancaria" },
  { patron: /INTERES(ES)?\s*(ACRED|GANAD)/i, tipoOperacion: "interes_ganado" },
  { patron: /IVA\s*(BASICO|21)/i, tipoOperacion: "iva_gastos_bancarios" },
  { patron: /SELLOS/i, tipoOperacion: "impuesto_sellos" },
];

export function clasificarSoloExtracto(
  descripcion: string,
  reglas: ReglaClasificacion[] = REGLAS_CLASIFICACION_DEFECTO,
): string | null {
  for (const regla of reglas) {
    if (regla.patron.test(descripcion)) return regla.tipoOperacion;
  }
  return null;
}
