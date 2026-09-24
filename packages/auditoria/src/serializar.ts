function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Date) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
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
  if (esObjetoPlano(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const resultado: Record<string, unknown> = {};
      for (const [clave, v] of Object.entries(valor)) {
        const serializado = serializar(v, pila);
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
  // string, number, boolean, null, o una instancia que no es un objeto
  // plano (Map, Set, clase propia, ...): se devuelve tal cual. No es
  // estrictamente JSON-safe en todos los casos (una clase propia con
  // métodos, por ejemplo), pero tampoco tira — es responsabilidad de quien
  // arma `antes`/`despues` no meter ahí algo así; el resto de la función sí
  // cubre los casos documentados (bigint, Date, undefined).
  return valor;
}

/**
 * Convierte `v` a algo seguro para guardar como JSON (una columna `jsonb`,
 * en particular): **nunca tira**, sin importar qué le pasen.
 *
 * - `bigint` se convierte a un STRING con sufijo `"n"` (`123n` → `"123n"`),
 *   no a un `number` — un `bigint` puede superar `Number.MAX_SAFE_INTEGER`
 *   sin que JS lo note (silenciosamente pierde precisión), y JSON no tiene
 *   un tipo `bigint` nativo (`JSON.stringify(123n)` directamente TIRA:
 *   `"Do not know how to serialize a BigInt"`). El sufijo `"n"` es una
 *   convención de este paquete (no un formato estándar): quien lea el
 *   registro de auditoría más adelante tiene que saber sacarlo para
 *   recuperar el valor numérico.
 * - `Date` se convierte a su ISO string (`.toISOString()`).
 * - `undefined` se DESCARTA: si es el valor de una clave de un objeto, esa
 *   clave desaparece del resultado (igual que hace `JSON.stringify`);
 *   adentro de un arreglo se convierte a `null` en vez de sacar el índice
 *   (sacarlo correría los elementos siguientes).
 * - Una referencia circular no hace loop infinito: esa rama queda como el
 *   string `"[ciclo]"`.
 * - `function`/`symbol` (no deberían aparecer en datos de negocio, pero
 *   pueden colarse) se convierten a un string en vez de tirar.
 *
 * Recorre arreglos y objetos planos recursivamente aplicando las mismas
 * reglas a cada valor.
 *
 * ```ts
 * import { serializarParaAuditoria } from "@mafesoftware/auditoria";
 *
 * serializarParaAuditoria({ saldo: 123n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined });
 * // { saldo: "123n", vence: "2026-01-01T00:00:00.000Z" } (sin "nota": era undefined)
 *
 * serializarParaAuditoria([1n, undefined, 3n]);
 * // ["1n", null, "3n"]
 * ```
 */
export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, new Set());
}
