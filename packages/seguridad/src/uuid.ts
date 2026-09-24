/**
 * Un id inventado tiene que ser "no existe", no un error del servidor.
 *
 * Con una columna `uuid` en Postgres, cualquier otra cosa hace que la
 * consulta TIRE (`invalid input syntax for type uuid`, `22P02`) en vez de
 * devolver cero filas. Chequear la FORMA antes de consultar convierte eso en
 * el camino que ya existe: no encontrado.
 */

// Versión (13º carácter, nibble alto de "time_hi_and_version"): 1-8, los
// definidos por RFC 9562. Variante (17º carácter): 8/9/a/b (RFC 4122/9562).
// El UUID nulo (Nil UUID, RFC 9562 §5.9) es todo ceros y no cumple ni
// versión ni variante, así que se acepta aparte.
const UUID_VERSIONADO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_NULO = "00000000-0000-0000-0000-000000000000";

/** ¿Tiene forma de UUID v1–v8 canónico, o es el UUID nulo? No dice que exista: dice que se puede preguntar. */
export function esUuid(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  return valor === UUID_NULO || UUID_VERSIONADO.test(valor);
}

/**
 * El valor si está entre `opciones`, o `porOmision` si no.
 *
 * Para columnas `text` con una lista cerrada declarada solo en TypeScript
 * (sin `CHECK` del lado de Postgres): sin este filtro, un formulario puede
 * escribir cualquier cosa en la columna y el código que después compara
 * `=== "publicado"` la trata como si fuera otro estado, sin decir nada. No
 * tira: se queda con el valor por omisión, porque un estado mal escrito no
 * es motivo para no guardar el resto.
 */
export function unaDe<T extends string>(valor: unknown, opciones: readonly T[], porOmision: T): T {
  const v = typeof valor === "string" ? valor.trim() : "";
  return (opciones as readonly string[]).includes(v) ? (v as T) : porOmision;
}
