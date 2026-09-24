/**
 * Normalización compartida por todo el paquete: la gente escribe puntos,
 * guiones y espacios alrededor de un CUIT, un DNI, un CBU o un teléfono, y
 * cada validador tiene que leer eso igual. Se queda solo con los dígitos.
 *
 * Vive en un módulo interno y no se re-exporta desde `index.ts` — mismo
 * patrón que `interno.ts` en `@mafesoftware/fechas-ar`: es una pieza de
 * implementación compartida entre módulos, no parte de la API pública.
 */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}
