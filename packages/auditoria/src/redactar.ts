/**
 * Los nombres de campo que `redactar` tapa por defecto, en cualquier
 * profundidad. Cubren credenciales/secretos genéricos (`password`, `hash`,
 * `token`, `secret`, `api_key`, `totp`, `authorization`) y los datos
 * bancarios argentinos que este paquete espera ver en los productos de MAFE
 * Software (`cbu`, `cvu`) — `documentos-ar` valida su formato, pero nunca
 * deberían aparecer en texto plano en un registro de auditoría legible por
 * cualquiera con acceso de soporte.
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

/** Minúsculas y sin `_`/`-`: así `"API-Key"`, `"apiKey"` y `"api_key"` matchean el mismo nombre normalizado. */
function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[_-]/g, "");
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Date) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
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
  if (esObjetoPlano(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const resultado: Record<string, unknown> = {};
      for (const [clave, v] of Object.entries(valor)) {
        resultado[clave] = sensibles.has(normalizarClave(clave)) ? "[redactado]" : redactarValor(v, sensibles, pila);
      }
      return resultado;
    } finally {
      pila.delete(valor);
    }
  }
  // Valor hoja (string, number, bigint, boolean, null, undefined, o una
  // instancia que no es un objeto plano — Map, Set, clase propia, ...): se
  // devuelve tal cual, no hay clave que revisar acá arriba.
  return valor;
}

/**
 * Una copia profunda de `obj` donde cualquier CLAVE cuyo nombre (en
 * minúsculas y sin `_`/`-`) matchee `camposSensibles` queda reemplazada por
 * `"[redactado]"`, sin importar la profundidad ni si está adentro de un
 * arreglo. `camposSensibles` es por defecto `CAMPOS_SENSIBLES_POR_DEFECTO`.
 *
 * Es una redacción por NOMBRE DE CLAVE, no por valor: no mira si el string
 * "parece" una contraseña, mira si la clave que lo contiene es una de la
 * lista. `"API-Key"`, `"apiKey"` y `"api_key"` matchean todos el mismo
 * nombre de la lista (`"api_key"`/`"apikey"`) porque la comparación
 * normaliza a minúsculas y saca `_`/`-` de los dos lados.
 *
 * Nunca tira por una referencia circular: una rama que se referencia a sí
 * misma queda como `"[ciclo]"` en vez de recursión infinita — un `Date` se
 * copia (por valor, no por referencia) y no se recorre como si fuera un
 * objeto plano; un valor que no es objeto/arreglo/`Date` (incluido
 * `undefined`) se devuelve tal cual.
 *
 * ```ts
 * import { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";
 *
 * redactar({ usuario: "ana", contrasena: "hunter2" });
 * // { usuario: "ana", contrasena: "[redactado]" }
 *
 * redactar({ pago: { cbu: "0000003100010000000001", monto: 100 } });
 * // { pago: { cbu: "[redactado]", monto: 100 } }
 *
 * redactar({ "API-Key": "abc", apiKey: "def" }); // las dos formas matchean "api_key"/"apikey"
 * // { "API-Key": "[redactado]", apiKey: "[redactado]" }
 *
 * redactar({ token: "t1", extra: "visible" }, ["token"]); // lista propia
 * // { token: "[redactado]", extra: "visible" }
 *
 * CAMPOS_SENSIBLES_POR_DEFECTO; // ["contrasena", "password", "hash", "token", "secreto", "secret", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
 * ```
 */
export function redactar<T>(obj: T, camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO): T {
  const sensibles = new Set(camposSensibles.map(normalizarClave));
  return redactarValor(obj, sensibles, new Set()) as T;
}
