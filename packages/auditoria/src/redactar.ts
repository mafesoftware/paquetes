import { esClaveSensible, normalizarTerminos } from "./coincidencia-sensible.js";

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
  if (valor instanceof Date) return new Date(valor.getTime());
  if (valor instanceof Map) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const resultado: Record<string, unknown> = {};
      for (const [clave, v] of valor.entries()) {
        const claveTexto = String(clave);
        resultado[claveTexto] = esClaveSensible(claveTexto, sensibles) ? "[redactado]" : redactarValor(v, sensibles, pila);
      }
      return resultado;
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
    // CUALQUIER objeto que no sea arreglo/Date/Map/Set — objeto plano,
    // instancia de una clase propia, lo que sea — se recorre por sus
    // claves propias ENUMERABLES (`Object.keys`, que para una instancia de
    // clase son los campos de instancia, ej. `this.password = ...` en el
    // constructor, NUNCA los métodos del prototipo). Antes de este cambio
    // solo se recorrían objetos con `Object.prototype`/sin prototipo; una
    // clase propia con un campo sensible quedaba SIN redactar.
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const objeto = valor as Record<string, unknown>;
      const resultado: Record<string, unknown> = {};
      for (const clave of Object.keys(objeto)) {
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
 * Recorre CUALQUIER objeto (plano, instancia de clase propia, `Map`
 * convertido a un objeto de entradas con la clave como `String(clave)`,
 * `Set` convertido a arreglo) y arreglos. Nunca tira por una referencia
 * circular (esa rama queda como `"[ciclo]"`) ni por una clave cuyo `get`
 * tira (esa clave queda como `"[error]"`) — un `Date` se copia por valor,
 * no se recorre como objeto.
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
 * CAMPOS_SENSIBLES_POR_DEFECTO; // ["contrasena", "password", "hash", "token", "secreto", "secret", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
 * ```
 */
export function redactar<T>(obj: T, camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO): T {
  const sensibles = normalizarTerminos(camposSensibles);
  return redactarValor(obj, sensibles, new Set()) as T;
}
