import { clasificar, clavesPropias, definirPropiedad, elementosDeSet, entradasDeMap, intentar, llamarToJSON } from "./tipos-especiales.js";

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
  if (typeof valor !== "object" || valor === null) {
    // string, number, boolean, null: se devuelven tal cual.
    return valor;
  }

  // `clasificar` (ver tipos-especiales.ts) reconoce binario/Date/RegExp/
  // URL/Error/toJSON/Map/Set en ESE orden — `URL` tiene que resolverse
  // ANTES del chequeo genérico de `toJSON` (`URL.prototype.toJSON` existe y
  // devuelve el `href` COMPLETO, con query/hash). Corre SIEMPRE envuelta en
  // `intentar`: los `instanceof`/`tieneToJSON` de adentro pueden tirar por
  // un dato roto (un `Proxy` con `getPrototypeOf`/`get` rotos, un `Error`
  // con `.name` que tira) — si tira, TODO el nodo queda `"[error]"`.
  const clasificacion = intentar(() => clasificar(valor));
  if (!clasificacion.ok) return "[error]";
  const c = clasificacion.valor;

  if (c.tipo === "resuelto") return c.valor;

  if (c.tipo === "toJSON") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const llamado = llamarToJSON(valor as { toJSON: () => unknown });
      if (!llamado.ok) return "[error]";
      return serializar(llamado.valor, pila);
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "map") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // Ronda 5: OBJETO plano con la clave como texto, desambiguada con
      // " (2)", " (3)"… — mismo cálculo que `redactar`/`normalizarParaDiff`
      // (`entradasDeMap`). Una iteración que tira deja el nodo en "[error]".
      const leidas = entradasDeMap(valor as Map<unknown, unknown>);
      if (!leidas.ok) return "[error]";
      const resultado: Record<string, unknown> = {};
      for (const { clave, valor: v } of leidas.entradas) {
        const serializado = serializar(v, pila);
        if (serializado !== undefined) definirPropiedad(resultado, clave, serializado);
      }
      return resultado;
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "set") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const leidos = elementosDeSet(valor as Set<unknown>);
      if (!leidos.ok) return "[error]";
      return leidos.elementos.map((v) => serializar(v, pila) ?? null);
    } finally {
      pila.delete(valor);
    }
  }

  // c.tipo === "objeto": CUALQUIER objeto que no sea arreglo/binario/Date/
  // RegExp/URL/Error/(algo con toJSON)/Map/Set — objeto plano, instancia
  // de una clase propia, lo que sea — se recorre por sus claves propias
  // ENUMERABLES.
  if (pila.has(valor)) return "[ciclo]";
  pila.add(valor);
  try {
    const objeto = valor as Record<string, unknown>;
    const clavesLeidas = clavesPropias(objeto);
    // Object.keys puede tirar (un Proxy cuya trampa ownKeys tira): sin
    // poder enumerar nada, se devuelve "[error]" para todo el objeto.
    if (!clavesLeidas.ok) return "[error]";
    const resultado: Record<string, unknown> = {};
    for (const clave of clavesLeidas.claves) {
      const leido = leerPropiedad(objeto, clave);
      if (!leido.ok) {
        // Un getter que tira: no se propaga — "nunca tira" es la garantía
        // de esta función, incluso si el DATO que le pasan está roto.
        definirPropiedad(resultado, clave, "[error]");
        continue;
      }
      const serializado = serializar(leido.valor, pila);
      // Acá sí se saca la clave entera (no se deja en `null`): "undefined
      // se descarta" es la regla pedida, y en un objeto (a diferencia de
      // un arreglo) sacar una clave no mueve a ninguna otra.
      if (serializado !== undefined) definirPropiedad(resultado, clave, serializado);
    }
    return resultado;
  } finally {
    pila.delete(valor);
  }
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
 * - `undefined` se DESCARTA: si es el valor de una clave de un objeto, esa
 *   clave desaparece del resultado (igual que hace `JSON.stringify`);
 *   adentro de un arreglo se convierte a `null` en vez de sacar el índice
 *   (sacarlo correría los elementos siguientes).
 * - Una referencia circular no hace loop infinito: esa rama queda como el
 *   string `"[ciclo]"`.
 * - `function`/`symbol` (no deberían aparecer en datos de negocio, pero
 *   pueden colarse) se convierten a un string en vez de tirar.
 *
 * **Tipos especiales** (mismo tratamiento que `redactar`, mismo orden — ver
 * `tipos-especiales.ts`):
 * - `Buffer`/`TypedArray`/`ArrayBuffer`/`DataView` → `"[binario N bytes]"`
 *   (nunca el contenido byte a byte — antes de esto, un buffer de 1 MB se
 *   recorría como un arreglo de 1.048.576 números).
 * - `Date` → ISO string (`.toISOString()`); una `Date` inválida da
 *   `"[fecha-invalida]"` en vez de tirar (`.toISOString()` de una Invalid
 *   Date tira `RangeError`).
 * - `RegExp` → `String(re)` (ej. `"/abc/gi"`) — antes quedaba `{}` (sin
 *   claves propias enumerables).
 * - `URL` → `origin` + `pathname`, SIN `search` ni `hash` (pueden traer
 *   secretos: `?token=...`, `#access_token=...`).
 * - `Error` → `{ name }` únicamente (nunca `.message`/`.stack`).
 * - Cualquier OTRO objeto con un `toJSON` propio: se llama (atrapando una
 *   excepción — `"[error]"` si tira) y el resultado se serializa
 *   recursivamente. Corre DESPUÉS de los casos de arriba (`URL` tiene su
 *   propio `toJSON` que devuelve el `href` completo; por eso `URL` se
 *   resuelve antes).
 * - `Map` se convierte a un OBJETO plano con la clave como texto; si dos
 *   claves distintas dan el mismo texto (el número `1` y el string `"1"`),
 *   la que llegó después lleva un sufijo `" (2)"`, `" (3)"`… (orden de
 *   inserción), así ninguna se pierde. `Set` se convierte a un arreglo. Un
 *   `Map`/`Set` cuya iteración tira queda `"[error]"`.
 *   Cualquier otro objeto — plano o instancia de una clase propia — se
 *   recorre por sus claves propias enumerables, igual que un objeto plano.
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
 *
 * serializarParaAuditoria(new URL("https://api.com/x?token=SECRETO"));
 * // "https://api.com/x" (sin "?token=SECRETO")
 *
 * serializarParaAuditoria(new Error("mensaje que puede tener datos"));
 * // { name: "Error" } (nunca .message)
 * ```
 */
export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, new Set());
}
