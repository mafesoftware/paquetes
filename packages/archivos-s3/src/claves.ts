import { randomBytes } from "node:crypto";

/** Cualquier corrida de un carácter fuera de [A-Za-z0-9._-] se colapsa a un solo "-". */
const CARACTERES_NO_SEGUROS = /[^A-Za-z0-9._-]+/g;

/** Nombre por omisión cuando, después de sanear, no queda ningún carácter útil. */
const NOMBRE_POR_OMISION = "archivo";

/** Largo máximo del nombre saneado (una clave de S3 completa admite hasta 1024 bytes; esto deja margen de sobra para el prefijo + el id al azar). */
const LARGO_MAXIMO_NOMBRE = 150;

/**
 * Deja de un nombre de archivo arbitrario (lo manda quien sube — hostil por
 * definición: puede traer "/", "..", espacios, acentos, emoji o control
 * chars) solo los caracteres seguros para vivir en una clave de S3 y en un
 * header `Content-Disposition`. Nunca se usa el nombre original tal cual en
 * la clave — sirve para que el archivo final conserve algo reconocible del
 * nombre que subió la persona, no para identificarlo.
 *
 * - Se sacan los acentos (NFKD + quitar los diacríticos) para no perder
 *   directamente el nombre entero cuando cae fuera de [A-Za-z0-9._-].
 * - Cualquier corrida de caracteres no seguros (incluidos "/" y "..", que
 *   permitirían escapar del prefijo) se colapsa a un solo "-".
 * - Se recorta el "-"/"." de las puntas (evita nombres tipo "-oculto" o
 *   ".oculto" que algunos sistemas de archivos tratan distinto).
 * - Si no queda nada útil (un nombre hecho solo de emoji o símbolos), se usa
 *   `"archivo"` en vez de una clave con un segmento vacío.
 */
export function sanitizarNombre(nombre: string): string {
  const sinAcentos = nombre.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const limpio = sinAcentos
    .replace(CARACTERES_NO_SEGUROS, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, LARGO_MAXIMO_NOMBRE);
  return limpio.length > 0 ? limpio : NOMBRE_POR_OMISION;
}

/**
 * Clave al azar bajo `prefijo`, con el nombre original saneado al final
 * (legible en la consola de S3, no usado para nada que dependa de su
 * contenido). El identificador usa `node:crypto` (CSPRNG) — con
 * `Math.random()` las claves quedan adivinables conociendo otra generada en
 * el mismo proceso.
 */
export function generarClaveTemporal(prefijo: string, nombre: string): string {
  const id = randomBytes(16).toString("hex");
  return `${prefijo}${id}-${sanitizarNombre(nombre)}`;
}

/**
 * Una clave que viene de afuera (`claveTemporal`/`claveFinal` de
 * `promover`, o `clave` de `urlFirmada`) es seguro usarla como `Key` de S3
 * si no está vacía, no arranca con "/" (una clave absoluta cambiaría de
 * intención según el cliente que la interprete) y ningún segmento partido
 * por "/" es exactamente "..". Sin esto, una clave con un segmento ".."
 * podría hacer que `CopyObjectCommand`/`DeleteObjectCommand` operen fuera
 * del prefijo que la app esperaba.
 */
export function esClaveSegura(clave: string): boolean {
  if (clave.length === 0 || clave.startsWith("/")) {
    return false;
  }
  return !clave.split("/").some((segmento) => segmento === "..");
}

/** ¿`clave` cae bajo `prefijo`? Se usa tanto para validar una clave temporal como para bloquear la descarga directa de lo que todavía no se promovió. */
export function estaBajoPrefijo(clave: string, prefijo: string): boolean {
  return clave.startsWith(prefijo);
}

/** Caracteres de control (C0, DEL, C1) y separadores de ruta: nunca van en un nombre de descarga. */
const NO_VAN_EN_NOMBRE_DE_DESCARGA = /[\u0000-\u001f\u007f-\u009f/\\]+/g;

/** Mitades de un par sustituto UTF-16 sueltas: `encodeURIComponent` TIRA con ellas (URIError). */
const SUSTITUTOS_SUELTOS = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Percent-encoding de RFC 5987 (`ext-value`): solo quedan sin codificar los
 * `attr-char` (letras, dígitos y ``!#$&+-.^_`|~``). `encodeURIComponent` deja
 * además `'()*` sin codificar, y `'` cortaría el `ext-value`.
 */
function codificarRfc5987(valor: string): string {
  return encodeURIComponent(valor).replace(
    /['()*]/g,
    (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Valor de `Content-Disposition` que fuerza la descarga de un archivo con su
 * nombre original (RFC 6266): `attachment; filename="<ascii>";
 * filename*=UTF-8''<percent-encoded>`.
 *
 * - `filename` lleva el nombre pasado por `sanitizarNombre` — ASCII seguro,
 *   sin comillas ni `\` que puedan romper el header; es el que usa un
 *   cliente viejo que no entiende `filename*`.
 * - `filename*` lleva el nombre original (normalizado a NFC, sin caracteres
 *   de control ni separadores de ruta ni sustitutos UTF-16 sueltos,
 *   recortado), percent-encoded: los navegadores lo prefieren y conserva
 *   tildes y eñes. Si después de limpiar no queda nada, usa el saneado.
 */
export function contentDispositionAdjunto(nombre: string): string {
  const ascii = sanitizarNombre(nombre);
  const limpio = nombre
    .replace(SUSTITUTOS_SUELTOS, "-")
    .normalize("NFC")
    .replace(NO_VAN_EN_NOMBRE_DE_DESCARGA, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, ""); // mismo criterio que sanitizarNombre con las puntas
  // Recorte por code point (no por unidad UTF-16): cortar en medio de un
  // emoji dejaría un sustituto suelto y `encodeURIComponent` tiraría.
  const original = Array.from(limpio).slice(0, LARGO_MAXIMO_NOMBRE).join("");
  const extendido = original.length > 0 ? original : ascii;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificarRfc5987(extendido)}`;
}
