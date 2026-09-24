/** Mismo patrón que un identificador de Postgres sin comillas: minúsculas, empieza con letra o `_`, el resto letras/dígitos/`_`. */
export const NOMBRE_TABLA_VALIDO = /^[a-z_][a-z0-9_]*$/;

/**
 * Tope de largo para `nombre` (`tablaAuditoria`) / `nombreTabla`
 * (`sqlInmutabilidad`). Postgres trunca cualquier identificador a 63
 * caracteres (y silenciosamente — dos identificadores que solo difieren
 * después del carácter 63 colisionan); `sqlInmutabilidad` arma un nombre de
 * función de hasta 20 caracteres extra (`"_bloquear_escritura"`) además del
 * nombre de la tabla — `40 + 20 = 60`, con margen para el resto de los
 * sufijos (`"_no_update_delete"`, `"_no_truncate"`, más cortos). Se elige
 * RECHAZAR un nombre largo (en vez de derivar un identificador con hash)
 * porque un identificador con hash sería distinto en cada corrida de
 * `sqlInmutabilidad` para la MISMA tabla si el hash no fuera 100%
 * determinístico contra el nombre, y complicaría el mensaje de error sin
 * necesidad — un nombre de tabla de más de 40 caracteres es en la práctica
 * siempre un error de quien llama (un nombre generado, no uno elegido a
 * mano), no un caso real a soportar.
 */
export const LARGO_MAXIMO_NOMBRE_TABLA = 40;

/**
 * Valida `nombre` contra `NOMBRE_TABLA_VALIDO` y `LARGO_MAXIMO_NOMBRE_TABLA`;
 * TIRA `Error` con un mensaje claro (que incluye `quien`, la función que
 * llama) si no pasa. Compartida entre `tablaAuditoria` y `sqlInmutabilidad`
 * para que las dos acepten/rechacen EXACTAMENTE los mismos nombres: una
 * tabla que `tablaAuditoria` deja crear tiene que poder recibir después el
 * trigger de `sqlInmutabilidad` sin que ESE rechace el nombre por separado
 * (o viceversa) — antes de esto, `tablaAuditoria` no validaba `nombre` en
 * absoluto.
 */
export function validarNombreTabla(nombre: string, quien: string): void {
  if (!NOMBRE_TABLA_VALIDO.test(nombre)) {
    throw new Error(
      `${quien}: nombre de tabla inválido: "${nombre}". Tiene que matchear ${NOMBRE_TABLA_VALIDO} (minúsculas, empieza con letra o "_") — se interpola directo en el DDL, sin placeholders posibles.`,
    );
  }
  if (nombre.length > LARGO_MAXIMO_NOMBRE_TABLA) {
    throw new Error(
      `${quien}: nombre de tabla demasiado largo (${nombre.length} caracteres, máximo ${LARGO_MAXIMO_NOMBRE_TABLA}) — los identificadores derivados (índices de tablaAuditoria, función/triggers de sqlInmutabilidad) tienen que quedar bajo el límite de 63 caracteres de Postgres.`,
    );
  }
}
