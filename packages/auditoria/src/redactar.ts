import { esClaveSensible, normalizarTerminos } from "./coincidencia-sensible.js";
import {
  claveComoTexto,
  clavesPropias,
  esBinario,
  llamarToJSON,
  objetoError,
  textoBinario,
  textoFecha,
  textoRegExp,
  textoUrl,
  tieneToJSON,
} from "./tipos-especiales.js";

/**
 * Los nombres de campo que `redactar` tapa por defecto, en cualquier
 * profundidad. Cubren credenciales/secretos genéricos (`password`, `hash`,
 * `token`, `secret`, `api_key`, `totp`, `authorization`) y los datos
 * bancarios argentinos que este paquete espera ver en los productos de MAFE
 * Software (`cbu`, `cvu`) — `documentos-ar` valida su formato, pero nunca
 * deberían aparecer en texto plano en un registro de auditoría legible por
 * cualquiera con acceso de soporte.
 *
 * El matching no es por igualdad exacta: ver `esClaveSensible` (matchea
 * también si el nombre TERMINA con un término de esta lista) y el JSDoc de
 * `redactar` para la regla completa con ejemplos.
 */
export const CAMPOS_SENSIBLES_POR_DEFECTO: readonly string[] = [
  "contrasena",
  "password",
  "hash",
  "token",
  "secreto",
  "secret",
  "cbu",
  "cvu",
  "clave",
  "api_key",
  "apikey",
  "totp",
  "authorization",
];

/**
 * Lee `objeto[clave]`, atrapando una excepción si `clave` es un getter que
 * tira (una clase con una propiedad computada rota, por ejemplo) — para que
 * una lectura rota de UNA clave no tire toda la redacción. Devuelve
 * `{ ok: true, valor }` o `{ ok: false }`.
 */
function leerPropiedad(objeto: Record<string, unknown>, clave: string): { ok: true; valor: unknown } | { ok: false } {
  try {
    return { ok: true, valor: objeto[clave] };
  } catch {
    return { ok: false };
  }
}

function redactarValor(valor: unknown, sensibles: ReadonlySet<string>, pila: Set<object>): unknown {
  if (Array.isArray(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      return valor.map((v) => redactarValor(v, sensibles, pila));
    } finally {
      pila.delete(valor);
    }
  }
  // Tipos especiales, en ESTE orden (ver tipos-especiales.ts): binario,
  // Date, RegExp, URL, Error, y recién después cualquier otro objeto con
  // toJSON propio. Antes de esto, el bloque genérico de más abajo ("recorre
  // por claves propias enumerables") los mangleaba: un RegExp quedaba `{}`,
  // un Buffer se recorría byte a byte, una URL con "?token=..." conservaba
  // el token porque `search`/`hash` no son claves propias enumerables (pero
  // SÍ hubieran salido enteras si algo llamaba a su `toJSON`, que devuelve
  // el href completo — por eso URL se resuelve ACÁ, antes del chequeo
  // genérico de toJSON de más abajo).
  if (esBinario(valor)) return textoBinario(valor);
  if (valor instanceof Date) return textoFecha(valor);
  if (valor instanceof RegExp) return textoRegExp(valor);
  if (valor instanceof URL) return textoUrl(valor);
  if (valor instanceof Error) return objetoError(valor);
  if (typeof valor === "object" && valor !== null && tieneToJSON(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const llamado = llamarToJSON(valor);
      if (!llamado.ok) return "[error]";
      // El resultado de toJSON() se redacta/recorre recursivamente — puede
      // ser cualquier cosa (un string, como en decimal.js; un objeto; un
      // arreglo). `pila` sigue agregado por si el toJSON devuelve `this`
      // (patológico, pero posible): la próxima vuelta lo detecta como
      // ancestro y corta con "[ciclo]" en vez de loopear para siempre.
      return redactarValor(llamado.valor, sensibles, pila);
    } finally {
      pila.delete(valor);
    }
  }
  if (valor instanceof Map) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // Arreglo de pares `[clave, valor]`, NO un objeto `{ [String(clave)]:
      // valor }`: dos claves DISTINTAS del Map (ej. el número `1` y el
      // string `"1"`) pueden normalizar a la MISMA clave de objeto — con un
      // objeto, la segunda pisaría a la primera en silencio. Un arreglo de
      // pares no pierde ninguna entrada, sin importar qué colisione.
      const pares: [string, unknown][] = [];
      for (const [clave, v] of valor.entries()) {
        const claveTexto = claveComoTexto(clave);
        pares.push([claveTexto, esClaveSensible(claveTexto, sensibles) ? "[redactado]" : redactarValor(v, sensibles, pila)]);
      }
      return pares;
    } finally {
      pila.delete(valor);
    }
  }
  if (valor instanceof Set) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      return Array.from(valor, (v) => redactarValor(v, sensibles, pila));
    } finally {
      pila.delete(valor);
    }
  }
  if (typeof valor === "object" && valor !== null) {
    // CUALQUIER objeto que no sea arreglo/binario/Date/RegExp/URL/Error/
    // (algo con toJSON)/Map/Set — objeto plano, instancia de una clase
    // propia, lo que sea — se recorre por sus claves propias ENUMERABLES
    // (`Object.keys`, que para una instancia de clase son los campos de
    // instancia, ej. `this.password = ...` en el constructor, NUNCA los
    // métodos del prototipo).
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const objeto = valor as Record<string, unknown>;
      const clavesLeidas = clavesPropias(objeto);
      // Object.keys puede tirar (un Proxy cuya trampa ownKeys tira): sin
      // poder enumerar nada, no hay forma de redactar nada adentro — se
      // devuelve "[error]" para todo el objeto, no se propaga la excepción.
      if (!clavesLeidas.ok) return "[error]";
      const resultado: Record<string, unknown> = {};
      for (const clave of clavesLeidas.claves) {
        const leido = leerPropiedad(objeto, clave);
        if (!leido.ok) {
          resultado[clave] = "[error]";
          continue;
        }
        resultado[clave] = esClaveSensible(clave, sensibles) ? "[redactado]" : redactarValor(leido.valor, sensibles, pila);
      }
      return resultado;
    } finally {
      pila.delete(valor);
    }
  }
  // Valor hoja (string, number, bigint, boolean, null, undefined, symbol,
  // función): se devuelve tal cual, no hay clave que revisar acá arriba.
  return valor;
}

/**
 * Una copia profunda de `obj` donde cualquier CLAVE sensible (según
 * `esClaveSensible`: matchea el nombre normalizado — minúsculas, sin
 * `_`/`-` — de `camposSensibles` por IGUALDAD o por TERMINAR CON un
 * término de la lista) queda reemplazada por `"[redactado]"`, sin importar
 * la profundidad ni si está adentro de un arreglo, un `Map`, un `Set` o una
 * instancia de una clase propia. `camposSensibles` es por defecto
 * `CAMPOS_SENSIBLES_POR_DEFECTO`.
 *
 * **La regla de matching es "igual O termina con", no "contiene".** Con
 * `"password"` en la lista:
 * - `"passwordHash"` / `"password_hash"` SÍ se redactan (normalizan a
 *   `"passwordhash"`, que no es igual a `"password"` pero SÍ termina con
 *   `"hash"`, que también está en la lista por defecto).
 * - `"accessToken"` / `"refresh_token"` SÍ (terminan en `"token"`).
 * - `"clientSecret"` SÍ (termina en `"secret"`).
 * - `"x-api-key"` SÍ (normaliza a `"xapikey"`, termina en `"apikey"`).
 * - `"passwordHint"` NO se redacta: normaliza a `"passwordhint"`, que NO
 *   termina en `"password"` (`"password"` es un PREFIJO ahí, no un
 *   sufijo) ni en ningún otro término de la lista.
 * - `"tokenizer"` NO se redacta: no termina en `"token"` (queda al
 *   principio, no al final).
 *
 * Es una redacción por NOMBRE DE CLAVE, no por valor: no mira si el string
 * "parece" una contraseña. **Límite documentado**: un secreto guardado bajo
 * una clave NO sensible (ej. `{ notas: "la clave temporal es Xy9$zK" }`,
 * donde la clave del objeto es `"notas"`, no `"clave"`) NO se detecta —
 * `redactar` nunca mira el CONTENIDO de un string, solo el nombre de la
 * clave que lo contiene.
 *
 * **Tipos especiales** (mismo tratamiento que `serializarParaAuditoria`,
 * mismo orden — ver `tipos-especiales.ts`):
 * - `Buffer`/`TypedArray`/`ArrayBuffer`/`DataView` → `"[binario N bytes]"`
 *   (nunca el contenido byte a byte).
 * - `Date` → ISO string (`"[fecha-invalida]"` si es una Date inválida).
 * - `RegExp` → `String(re)` (ej. `"/abc/gi"`).
 * - `URL` → `origin` + `pathname`, SIN `search` ni `hash` (pueden traer
 *   secretos: `?token=...`, `#access_token=...`).
 * - `Error` → `{ name }` únicamente (nunca `.message`, que puede traer el
 *   valor que causó el error).
 * - Cualquier OTRO objeto con un `toJSON` propio: se llama (atrapando una
 *   excepción — `"[error]"` si tira) y el resultado se redacta
 *   recursivamente. Corre DESPUÉS de los casos de arriba a propósito:
 *   `URL.prototype.toJSON` existe y devuelve el `href` COMPLETO (con
 *   query/hash), así que si este chequeo corriera antes, la redacción
 *   específica de `URL` nunca se alcanzaría.
 * - `Map` se convierte a un arreglo de pares `[String(clave), valor]` (NO
 *   un objeto: dos claves de Map distintas pueden normalizar al MISMO
 *   nombre de propiedad — ej. el número `1` y el string `"1"` — y un
 *   objeto perdería una en silencio; ver el JSDoc de `redactarValor`
 *   interno). Un par cuya clave (ya convertida a texto) es sensible tiene
 *   su VALOR redactado.
 * - `Set` se convierte a un arreglo.
 *
 * Nunca tira: una referencia circular queda como `"[ciclo]"`, una clave
 * cuyo `get` tira queda como `"[error]"`, una clave de `Map` cuyo
 * `toString` tira (o un objeto sin prototipo como clave) queda como
 * `"[clave]"`, y un objeto cuyas claves no se pueden enumerar (un `Proxy`
 * con una trampa `ownKeys` que tira) queda como `"[error]"` entero.
 *
 * ```ts
 * import { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";
 *
 * redactar({ usuario: "ana", contrasena: "hunter2" });
 * // { usuario: "ana", contrasena: "[redactado]" }
 *
 * redactar({ pago: { datos: { cbu: "0000003100010000000001", monto: 100 } } });
 * // { pago: { datos: { cbu: "[redactado]", monto: 100 } } }
 *
 * redactar({ passwordHash: "h1", accessToken: "t1", refresh_token: "t2", clientSecret: "s1", "x-api-key": "k1" });
 * // { passwordHash: "[redactado]", accessToken: "[redactado]", refresh_token: "[redactado]", clientSecret: "[redactado]", "x-api-key": "[redactado]" }
 *
 * redactar({ passwordHint: "el nombre de tu mascota", tokenizer: "spacy" });
 * // { passwordHint: "el nombre de tu mascota", tokenizer: "spacy" } (NINGUNO se toca: no terminan en un término sensible)
 *
 * redactar({ token: "t1", extra: "visible" }, ["token"]); // lista propia
 * // { token: "[redactado]", extra: "visible" }
 *
 * class Usuario { constructor(public nombre: string, public password: string) {} }
 * redactar(new Usuario("ana", "hunter2"));
 * // { nombre: "ana", password: "[redactado]" } (instancia de clase: se redactan sus campos propios)
 *
 * redactar(new URL("https://api.com/perfil?token=SECRETO#frag"));
 * // "https://api.com/perfil" (sin "?token=SECRETO" ni "#frag")
 *
 * class Dinero { constructor(private centavos: bigint) {} toJSON() { return `${this.centavos}c`; } }
 * redactar({ precio: new Dinero(1250n) });
 * // { precio: "1250c" } (toJSON corre y su resultado se redacta/recorre)
 *
 * redactar(new Map([[1, "hunter2"], ["contrasena", "hunter3"]]));
 * // [["1", "hunter2"], ["contrasena", "[redactado]"]] (arreglo de pares, no objeto)
 *
 * CAMPOS_SENSIBLES_POR_DEFECTO; // ["contrasena", "password", "hash", "token", "secreto", "secret", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
 * ```
 */
export function redactar<T>(obj: T, camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO): T {
  const sensibles = normalizarTerminos(camposSensibles);
  return redactarValor(obj, sensibles, new Set()) as T;
}
