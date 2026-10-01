/**
 * Exclusiones/certificados de no retención de un proveedor: `exclusionVigente`
 * filtra por régimen + vigencia inclusive sobre un listado ya resuelto. La
 * búsqueda por proveedor en la base (consultar `exclusiones` por id) queda
 * del lado de la app — este paquete no conoce esa tabla.
 */
import type { Exclusion, Regimen } from "./tipos.js";

/** La primera exclusión vigente a `fecha` (inclusive en ambos extremos) para ese régimen, o `null`. */
export function exclusionVigente(exclusiones: readonly Exclusion[], regimen: Regimen, fecha: string): Exclusion | null {
  return exclusiones.find((e) => e.regimen === regimen && e.desde <= fecha && fecha <= e.hasta) ?? null;
}
