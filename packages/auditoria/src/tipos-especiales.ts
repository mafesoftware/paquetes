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

/**
 * Corre `fn()` atrapando CUALQUIER excepción. Para chequeos que pueden
 * tirar por un DATO roto — no por un bug de este paquete — en vez de
 * propagar: un `instanceof` sobre un `Proxy` con la trampa `getPrototypeOf`
 * rota tira (`instanceof` sin un `Symbol.hasInstance` custom hace
 * `[[GetPrototypeOf]]` del VALOR para caminar su cadena de prototipos, y en
 * un `Proxy` eso dispara la trampa); leer `.toJSON` (`tieneToJSON`) puede
 * tirar si es un getter roto; leer `.name` de un `Error` (`objetoError`)
 * puede tirar si es un getter roto en una subclase. La garantía de "nunca
 * tira" de `redactar`/`serializarParaAuditoria`/`normalizarParaDiff`
 * depende de envolver estos chequeos en cada nodo que recorren, no solo
 * las lecturas de propiedades "de datos" normales (que ya cubrían
 * `leerPropiedad`/`clavesPropias`/`claveComoTexto` desde antes).
 */
export function intentar<T>(fn: () => T): { ok: true; valor: T } | { ok: false } {
  try {
    return { ok: true, valor: fn() };
  } catch {
    return { ok: false };
  }
}

/**
 * El resultado de clasificar un valor NO arreglo (el llamador filtra
 * arreglos aparte, antes de llegar acá) en uno de los tipos especiales que
 * reconoce este paquete: `"resuelto"` trae el valor YA CONVERTIDO para los
 * casos "hoja" (binario/`Date`/`RegExp`/`URL`/`Error`, que no necesitan más
 * recorrido); las demás etiquetas (`"toJSON"`/`"map"`/`"set"`/`"objeto"`)
 * le dicen al llamador CÓMO seguir recorriendo — cada función
 * (`redactar`/`serializarParaAuditoria`/`normalizarParaDiff`) hace ese
 * recorrido a su manera (`redactar` chequea claves sensibles, las otras
 * dos no), así que esa parte no se comparte.
 */
export type Clasificacion =
  | { tipo: "resuelto"; valor: unknown }
  | { tipo: "toJSON" }
  | { tipo: "map" }
  | { tipo: "set" }
  | { tipo: "objeto" };

/**
 * Clasifica `valor` (que el llamador ya confirmó que es un objeto no
 * arreglo) en uno de los tipos especiales, en el ORDEN que importa (ver el
 * comentario de arriba del archivo: `URL` antes que el chequeo genérico de
 * `toJSON`, porque `URL.prototype.toJSON` existe y da el `href` completo).
 *
 * **Se llama SIEMPRE envuelta en `intentar(...)`** — nunca directo: los
 * `instanceof` de acá adentro (`Date`, `RegExp`, `URL`, `Error`, `Map`,
 * `Set`), la lectura de `.toJSON` (`tieneToJSON`) y la de `.name` (dentro
 * de `objetoError`, para el caso `Error`) pueden tirar por un dato roto —
 * ver el JSDoc de `intentar`. Si `clasificar` tira, el llamador convierte
 * TODO el nodo en `"[error]"`, sin poder saber a qué categoría pertenecía.
 */
export function clasificar(valor: object): Clasificacion {
  if (esBinario(valor)) return { tipo: "resuelto", valor: textoBinario(valor) };
  if (valor instanceof Date) return { tipo: "resuelto", valor: textoFecha(valor) };
  if (valor instanceof RegExp) return { tipo: "resuelto", valor: textoRegExp(valor) };
  if (valor instanceof URL) return { tipo: "resuelto", valor: textoUrl(valor) };
  if (valor instanceof Error) return { tipo: "resuelto", valor: objetoError(valor) };
  if (tieneToJSON(valor)) return { tipo: "toJSON" };
  if (valor instanceof Map) return { tipo: "map" };
  if (valor instanceof Set) return { tipo: "set" };
  return { tipo: "objeto" };
}
