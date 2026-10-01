/**
 * Jurisdicción de IIBB a partir de una provincia en texto libre (sin
 * catálogo cerrado del lado de quien llama). PURO: sin DB, sin framework —
 * mapea ese texto libre a la jurisdicción de padrón que este paquete
 * conoce (`ARBA`/`AGIP`, las únicas con padrón soportado hoy). Cualquier
 * otra provincia devuelve `null` (sin padrón conocido todavía) —
 * `retencionIibb` la trata como "no figura en el padrón", con la alícuota
 * "no padrón" de la config (nunca lanza). Quién es la jurisdicción de una
 * operación concreta (la provincia del proyecto, el domicilio fiscal de la
 * razón social cuando no hay proyecto, etc.) es una decisión de negocio de
 * la app — acá solo el mapeo provincia → jurisdicción de padrón.
 */
import type { Jurisdiccion } from "./tipos.js";

const NORMALIZAR = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const CABA = new Set(["caba", "ciudad autonoma de buenos aires", "capital federal"]);
const PBA = new Set(["buenos aires", "provincia de buenos aires", "pba"]);

/** `null` = provincia sin padrón de jurisdicción soportado todavía (gancho: se agrega cuando haga falta). */
export function jurisdiccionDeProvincia(provincia: string | null): Jurisdiccion | null {
  if (provincia == null) return null;
  const normalizada = NORMALIZAR(provincia);
  if (CABA.has(normalizada)) return "AGIP";
  if (PBA.has(normalizada)) return "ARBA";
  return null;
}
