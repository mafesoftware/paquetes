/**
 * Lee `objeto[clave]`, atrapando una excepción si `clave` es un getter que
 * tira — para que una lectura rota de UNA clave no tire toda la
 * serialización. Devuelve `{ ok: true, valor }` o `{ ok: false }`.
 */
function leerPropiedad(objeto: Record<string, unknown>, clave: string): { ok: true; valor: unknown } | { ok: false } {
  try {
    return { ok: true, valor: objeto[clave] };
  } catch {
    return { ok: false };
  }
}

function serializar(valor: unknown, pila: Set<object>): unknown {
  if (valor === undefined) return undefined;
  if (typeof valor === "bigint") return `${valor}n`;
  // Una Date "Invalid Date" (`new Date("no es una fecha")`) tiene
  // `getTime()` NaN, y `.toISOString()` TIRA `RangeError: Invalid time
  // value` en ese caso — la única forma de que este recorrido pudiera
  // lanzar si no se la cubriera explícitamente.
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? "[fecha-invalida]" : valor.toISOString();
  if (typeof valor === "function") return "[funcion]";
  if (typeof valor === "symbol") return valor.toString();
  if (Array.isArray(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // `undefined` adentro de un arreglo NO se saca (a diferencia de una
      // clave de objeto): sacarlo correría los índices de los elementos
      // siguientes, que es peor que dejar un `null` — JSON.stringify hace
      // lo mismo (convierte el `undefined` de un arreglo en `null`).
      return valor.map((v) => serializar(v, pila) ?? null);
    } finally {
      pila.delete(valor);
    }
  }
  if (valor instanceof Map) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const resultado: Record<string, unknown> = {};
      for (const [clave, v] of valor.entries()) {
        const serializado = serializar(v, pila);
        if (serializado !== undefined) resultado[String(clave)] = serializado;
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
      return Array.from(valor).map((v) => serializar(v, pila) ?? null);
    } finally {
      pila.delete(valor);
    }
  }
  if (typeof valor === "object" && valor !== null) {
    // CUALQUIER objeto que no sea arreglo/Date/Map/Set — objeto plano,
    // instancia de una clase propia, lo que sea — se recorre por sus
    // claves propias ENUMERABLES. Antes de este cambio solo se recorrían
    // objetos con `Object.prototype`/sin prototipo; una instancia de clase
    // (`this.password = ...`) quedaba sin serializar sus bigint/Date
    // internos y se devolvía tal cual (la instancia entera, no JSON-safe).
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const objeto = valor as Record<string, unknown>;
      const resultado: Record<string, unknown> = {};
      for (const clave of Object.keys(objeto)) {
        const leido = leerPropiedad(objeto, clave);
        if (!leido.ok) {
          // Un getter que tira: no se propaga — "nunca tira" es la garantía
          // de esta función, incluso si el DATO que le pasan está roto.
          resultado[clave] = "[error]";
          continue;
        }
        const serializado = serializar(leido.valor, pila);
        // Acá sí se saca la clave entera (no se deja en `null`): "undefined
        // se descarta" es la regla pedida, y en un objeto (a diferencia de
        // un arreglo) sacar una clave no mueve a ninguna otra.
        if (serializado !== undefined) resultado[clave] = serializado;
      }
      return resultado;
    } finally {
      pila.delete(valor);
    }
  }
  // string, number, boolean, null: se devuelven tal cual.
  return valor;
}

/**
 * Convierte `v` a algo seguro para guardar como JSON (una columna `jsonb`,
 * en particular): **nunca tira**, sin importar qué le pasen — incluida una
 * clave cuyo `get` tira (esa clave queda como el string `"[error]"` en vez
 * de propagar la excepción).
 *
 * - `bigint` se convierte a un STRING con sufijo `"n"` (`123n` → `"123n"`),
 *   no a un `number` — un `bigint` puede superar `Number.MAX_SAFE_INTEGER`
 *   sin que JS lo note (silenciosamente pierde precisión), y JSON no tiene
 *   un tipo `bigint` nativo (`JSON.stringify(123n)` directamente TIRA:
 *   `"Do not know how to serialize a BigInt"`). El sufijo `"n"` es una
 *   convención de este paquete (no un formato estándar): quien lea el
 *   registro de auditoría más adelante tiene que saber sacarlo para
 *   recuperar el valor numérico.
 * - `Date` se convierte a su ISO string (`.toISOString()`); una `Date`
 *   inválida (`new Date("no es una fecha")`) da `"[fecha-invalida]"` en vez
 *   de tirar (`.toISOString()` de una Invalid Date tira `RangeError`).
 * - `undefined` se DESCARTA: si es el valor de una clave de un objeto, esa
 *   clave desaparece del resultado (igual que hace `JSON.stringify`);
 *   adentro de un arreglo se convierte a `null` en vez de sacar el índice
 *   (sacarlo correría los elementos siguientes).
 * - Una referencia circular no hace loop infinito: esa rama queda como el
 *   string `"[ciclo]"`.
 * - `function`/`symbol` (no deberían aparecer en datos de negocio, pero
 *   pueden colarse) se convierten a un string en vez de tirar.
 * - `Map` se convierte a un objeto de entradas (clave `String(clave)`);
 *   `Set` se convierte a un arreglo. Cualquier otro objeto — plano o
 *   instancia de una clase propia — se recorre por sus claves propias
 *   enumerables, igual que un objeto plano.
 *
 * Recorre arreglos y objetos recursivamente aplicando las mismas reglas a
 * cada valor.
 *
 * ```ts
 * import { serializarParaAuditoria } from "@mafesoftware/auditoria";
 *
 * serializarParaAuditoria({ saldo: 123n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined });
 * // { saldo: "123n", vence: "2026-01-01T00:00:00.000Z" } (sin "nota": era undefined)
 *
 * serializarParaAuditoria([1n, undefined, 3n]);
 * // ["1n", null, "3n"]
 *
 * serializarParaAuditoria(new Map([["a", 1n]]));
 * // { a: "1n" }
 *
 * serializarParaAuditoria(new Set([1n, 2n]));
 * // ["1n", "2n"]
 * ```
 */
export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, new Set());
}
