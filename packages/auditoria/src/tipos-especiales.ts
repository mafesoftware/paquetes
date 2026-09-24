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

/**
 * Asigna `objeto[clave] = valor` como propiedad PROPIA (enumerable,
 * escribible, configurable) con `Object.defineProperty`, nunca con `=`. La
 * diferencia importa para una sola clave: `"__proto__"`. Con `=`, sobre un
 * objeto normal, eso no crea una propiedad: CAMBIA EL PROTOTIPO del
 * resultado (si el valor es un objeto) o no hace nada (si no lo es) — en
 * los dos casos la entrada se pierde en silencio. Aparece de verdad: una
 * clave `"__proto__"` de un `Map`, o una propia de un objeto que vino de
 * `JSON.parse('{"__proto__": ...}')`.
 */
export function definirPropiedad(objeto: Record<string, unknown>, clave: string, valor: unknown): void {
  Object.defineProperty(objeto, clave, { value: valor, enumerable: true, writable: true, configurable: true });
}

/** Una entrada de un `Map` ya convertida para usarse como propiedad de un objeto plano. */
export interface EntradaDeMap {
  /** La clave FINAL: `claveComoTexto(claveOriginal)`, con sufijo `" (2)"`, `" (3)"`… si colisionó. Si es sensible lo decide `esClaveSensible`, que saca el sufijo. */
  clave: string;
  valor: unknown;
}

/**
 * Las entradas de `map`, con la clave convertida a texto seguro
 * (`claveComoTexto`) y **desambiguada**: si dos claves distintas del `Map`
 * dan el mismo texto (el número `1` y el string `"1"`, o un objeto cuyo
 * `toString` da `"password"` y el string `"password"`), la que llegó
 * DESPUÉS (orden de inserción) lleva un sufijo `" (2)"`, la siguiente
 * `" (3)"`, etc. — ninguna entrada se pierde. Si el texto con sufijo
 * también está tomado (una clave literal `"1 (2)"`), se sigue contando.
 *
 * Es el MISMO cálculo para `redactar`, `serializarParaAuditoria` y
 * `normalizarParaDiff` — así las tres dan las mismas claves para el mismo
 * `Map`, y `cambios` (que sale de `normalizarParaDiff`) usa las mismas
 * rutas que las copias guardadas (que salen de `redactar` +
 * `serializarParaAuditoria`).
 *
 * **Nunca tira**: la iteración (`map.entries()` y recorrerla) va en un
 * `try/catch` — un `Proxy` sobre un `Map` (`instanceof Map` da `true`,
 * pero `entries()` con el Proxy como `this` tira `TypeError: incompatible
 * receiver`), una subclase con un `entries()` que tira, o un iterador que
 * da algo que no es un par, dan `{ ok: false }`, y el llamador convierte el
 * nodo entero en `"[error]"`.
 */
export function entradasDeMap(map: Map<unknown, unknown>): { ok: true; entradas: EntradaDeMap[] } | { ok: false } {
  try {
    const usadas = new Set<string>();
    const entradas: EntradaDeMap[] = [];
    for (const [claveOriginal, valor] of map.entries()) {
      const claveBase = claveComoTexto(claveOriginal);
      let clave = claveBase;
      for (let n = 2; usadas.has(clave); n++) clave = `${claveBase} (${n})`;
      usadas.add(clave);
      entradas.push({ clave, valor });
    }
    return { ok: true, entradas };
  } catch {
    return { ok: false };
  }
}

/**
 * Los elementos de `set` en un arreglo, atrapando una excepción de la
 * iteración (`Array.from` usa `[Symbol.iterator]`): un `Proxy` sobre un
 * `Set` o una subclase con un iterador que tira dan `{ ok: false }` — el
 * llamador convierte el nodo en `"[error]"`.
 */
export function elementosDeSet(set: Set<unknown>): { ok: true; elementos: unknown[] } | { ok: false } {
  try {
    return { ok: true, elementos: Array.from(set) };
  } catch {
    return { ok: false };
  }
}

/**
 * La profundidad máxima que recorren `redactar`, `serializarParaAuditoria`,
 * `normalizarParaDiff` y `loQueCambio`. La raíz está en la profundidad 0 y
 * cada nivel de objeto, arreglo, `Map`, `Set` o `toJSON` suma 1. Un
 * CONTENEDOR (cualquier objeto no `null`) más hondo que esto queda
 * `"[profundidad]"`, sin recorrerlo; un primitivo se conserva. Existe para
 * que "nunca tira" valga también con datos muy anidados: sin tope, la
 * recursión revienta el stack de Node (`RangeError`) entre ~1650 y ~2600
 * niveles. Todas las funciones cortan en el MISMO lugar, así las copias
 * guardadas y `cambios` coinciden.
 */
export const PROFUNDIDAD_MAXIMA = 500;

/** El texto que reemplaza a un contenedor más hondo que `PROFUNDIDAD_MAXIMA`. */
export const TEXTO_PROFUNDIDAD = "[profundidad]";

/** ¿`valor` es un contenedor que hay que cortar a esta `profundidad`? */
export function excedeProfundidad(valor: unknown, profundidad: number): boolean {
  return profundidad > PROFUNDIDAD_MAXIMA && typeof valor === "object" && valor !== null;
}

/** `Array.isArray(valor)` atrapando una excepción (un `Proxy` revocado hace tirar a `Array.isArray`): `"error"` en ese caso. */
export function esArreglo(valor: unknown): boolean | "error" {
  try {
    return Array.isArray(valor);
  } catch {
    return "error";
  }
}
