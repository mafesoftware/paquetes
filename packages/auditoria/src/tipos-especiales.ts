/**
 * Detección y conversión de tipos "especiales" — COMPARTIDA entre
 * `redactar` y `serializarParaAuditoria`, para que las dos los reconozcan
 * en el MISMO orden y con la MISMA forma final. Antes de esto, la
 * recursión "cualquier objeto que no sea arreglo/Date/Map/Set se recorre
 * por sus claves propias" (agregada para cubrir instancias de clase, ver
 * el changelog) trataba a un `Buffer`, un `RegExp`, una `URL` o un `Error`
 * como si fueran objetos de datos genéricos — un `RegExp` quedaba `{}` (sin
 * claves propias enumerables), un `Buffer` de 1 MB se recorría byte a byte
 * como un arreglo de 1.048.576 números, una `URL` con `?token=...` quedaba
 * con el token intacto (sus claves propias no incluyen `search`/`hash`,
 * pero si alguna vez tuviera `toJSON` devolvería el `href` COMPLETO), y un
 * `Error` exponía su `.message`/`.stack` si alguna vez pasaban a ser
 * enumerables (no lo son por defecto, pero no había ninguna garantía
 * explícita).
 *
 * Orden de reconocimiento (el mismo en `redactar` y `serializarParaAuditoria`):
 * binario (`Buffer`/`TypedArray`/`ArrayBuffer`/`DataView`) → `Date` → `RegExp`
 * → `URL` → `Error` → cualquier OTRO objeto con un `toJSON` propio → (recién
 * ahí) `Map`/`Set`/objeto genérico. El orden importa: `URL.prototype.toJSON`
 * existe y devuelve el `href` ENTERO (con query/hash) — si el chequeo
 * genérico de `toJSON` corriera ANTES que el de `URL`, la redacción de
 * `URL` (que corta query/hash a propósito) nunca se alcanzaría.
 */

/** `Buffer` (que hereda de `Uint8Array`), cualquier `TypedArray`, `ArrayBuffer` o `DataView`. */
export function esBinario(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

/** `"[binario N bytes]"` — nunca el contenido: un buffer de 1 MB recorrido byte a byte (el comportamiento antes de este fix) es tanto un problema de rendimiento como de ruido — y puede contener cualquier cosa, imágenes con EXIF incluido. */
export function textoBinario(v: ArrayBuffer | ArrayBufferView): string {
  return `[binario ${v.byteLength} bytes]`;
}

/** ISO string, o `"[fecha-invalida]"` si `v` es una Date inválida (`.toISOString()` de una Invalid Date tira `RangeError`). */
export function textoFecha(v: Date): string {
  return Number.isNaN(v.getTime()) ? "[fecha-invalida]" : v.toISOString();
}

/** `String(re)` — la representación con barras, ej. `"/abc/gi"`. */
export function textoRegExp(v: RegExp): string {
  return String(v);
}

/**
 * `origin` + `pathname`, SIN `search` (query string) ni `hash` — los dos
 * pueden traer secretos (`?token=...`, `#access_token=...`, típico de
 * flujos OAuth implícitos) que no tienen por qué terminar en un registro
 * de auditoría. Documentado también en el JSDoc de `redactar`/
 * `serializarParaAuditoria`.
 */
export function textoUrl(v: URL): string {
  return `${v.origin}${v.pathname}`;
}

/** `{ name }` únicamente — nunca `.message` (puede traer el valor que causó el error) ni `.stack` (rutas de archivo, y en algunos casos valores interpolados en el mensaje). */
export function objetoError(v: Error): { name: string } {
  return { name: v.name };
}

/** ¿`v` tiene un `toJSON` propio (o heredado) invocable? */
export function tieneToJSON(v: object): v is { toJSON: () => unknown } {
  return typeof (v as { toJSON?: unknown }).toJSON === "function";
}

/** Llama a `v.toJSON()` atrapando una excepción. */
export function llamarToJSON(v: { toJSON: () => unknown }): { ok: true; valor: unknown } | { ok: false } {
  try {
    return { ok: true, valor: v.toJSON() };
  } catch {
    return { ok: false };
  }
}

/** `String(clave)`, atrapando una excepción — un objeto sin prototipo (`Object.create(null)`, sin `toString`) o con un `toString`/`Symbol.toPrimitive` que tira hacen que `String(...)` tire. Devuelve `"[clave]"` en ese caso. */
export function claveComoTexto(clave: unknown): string {
  try {
    return String(clave);
  } catch {
    return "[clave]";
  }
}

/** `Object.keys(objeto)`, atrapando una excepción — un `Proxy` cuya trampa `ownKeys` tira hace que `Object.keys(...)` tire. Devuelve `{ ok: false }` en ese caso. */
export function clavesPropias(objeto: object): { ok: true; claves: string[] } | { ok: false } {
  try {
    return { ok: true, claves: Object.keys(objeto) };
  } catch {
    return { ok: false };
  }
}
