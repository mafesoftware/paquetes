/** Mismo patrón que un identificador de Postgres sin comillas: minúsculas, empieza con letra o `_`, el resto letras/dígitos/`_`. */
const NOMBRE_TABLA_VALIDO = /^[a-z_][a-z0-9_]*$/;

/**
 * El SQL (función `plpgsql` + triggers) que hace INMUTABLE la tabla
 * `nombreTabla`: ningún `UPDATE`, `DELETE` ni `TRUNCATE` pasa, cada uno
 * falla con `RAISE EXCEPTION` y un mensaje claro que dice qué operación se
 * intentó (`TG_OP`).
 *
 * **No es una migración de drizzle-kit.** `tablaAuditoria` (este mismo
 * subpath) define la FORMA de la tabla — columnas, índices — que
 * drizzle-kit sabe generar; un trigger no entra en ese modelo. El flujo
 * pensado es: 1) `drizzle-kit generate` con un esquema que use
 * `tablaAuditoria()`, como cualquier otra tabla; 2) agregar una migración
 * ESCRITA A MANO (un archivo `.sql` más en la carpeta de migraciones de la
 * app, con el número de secuencia que le toque) con el resultado de esta
 * función — después de la generada por drizzle-kit para que la tabla ya
 * exista cuando el trigger se cree. `sql/ejemplo.sql` de este paquete
 * incluye el resultado de `sqlInmutabilidad("auditoria")` como referencia.
 *
 * **Idempotente**: `CREATE OR REPLACE FUNCTION` (nunca falla si la función
 * ya existe) y `DROP TRIGGER IF EXISTS` antes de cada `CREATE TRIGGER` (un
 * `CREATE TRIGGER` a secas SÍ falla si el trigger ya existe) — se puede
 * correr esta migración más de una vez sin romper nada, útil si una app
 * necesita re-aplicarla (por ejemplo, después de un `DROP TABLE` +
 * recreate en un entorno de test).
 *
 * Una sola función de trigger sirve para los tres casos (`UPDATE`,
 * `DELETE`, `TRUNCATE`): un trigger a nivel de FILA (`BEFORE UPDATE OR
 * DELETE ... FOR EACH ROW`) para las primeras dos, y uno a nivel de
 * SENTENCIA (`BEFORE TRUNCATE ... FOR EACH STATEMENT`, porque `TRUNCATE`
 * no dispara triggers de fila) para la tercera — `TG_OP` distingue cuál
 * disparó en el mensaje de error, sin necesitar tres funciones.
 *
 * **`nombreTabla` se interpola directo en el SQL** (no hay forma de
 * parametrizar un nombre de tabla/función/trigger con un placeholder de
 * consulta en DDL de Postgres), así que se valida contra
 * `^[a-z_][a-z0-9_]*$` — el mismo patrón que un identificador de Postgres
 * sin comillas — y esta función TIRA si no matchea, antes de armar
 * cualquier string. No es una limitación cosmética: sin esta validación,
 * un `nombreTabla` que viniera de una fuente no confiable sería una
 * inyección SQL directa a esta función.
 *
 * ```ts
 * import { sqlInmutabilidad } from "@mafesoftware/auditoria/drizzle";
 *
 * // En una migración a mano, después de la que generó drizzle-kit:
 * const sql = sqlInmutabilidad("auditoria");
 * // corrida contra Postgres, dv ahora UPDATE/DELETE/TRUNCATE sobre
 * // "auditoria" tiran, por ejemplo:
 * // error: La tabla "auditoria" es de solo lectura (auditoría inmutable): no se permite UPDATE en esta tabla.
 *
 * sqlInmutabilidad("Auditoria; DROP TABLE x --"); // tira: nombre inválido
 * ```
 */
export function sqlInmutabilidad(nombreTabla: string): string {
  if (!NOMBRE_TABLA_VALIDO.test(nombreTabla)) {
    throw new Error(
      `sqlInmutabilidad: nombre de tabla inválido: "${nombreTabla}". Tiene que matchear ${NOMBRE_TABLA_VALIDO} (minúsculas, empieza con letra o "_") — se interpola directo en el DDL, sin placeholders posibles.`,
    );
  }

  const funcion = `${nombreTabla}_bloquear_escritura`;

  return `
-- Trigger de inmutabilidad para "${nombreTabla}" (generado por
-- sqlInmutabilidad de @mafesoftware/auditoria/drizzle). Agregar como
-- migración A MANO, después de la que generó drizzle-kit para esta tabla.
-- Idempotente: se puede correr más de una vez sin fallar.

CREATE OR REPLACE FUNCTION "${funcion}"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla "${nombreTabla}" es de solo lectura (auditoría inmutable): no se permite % en esta tabla.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "${nombreTabla}_no_update_delete" ON "${nombreTabla}";
CREATE TRIGGER "${nombreTabla}_no_update_delete"
  BEFORE UPDATE OR DELETE ON "${nombreTabla}"
  FOR EACH ROW EXECUTE FUNCTION "${funcion}"();

DROP TRIGGER IF EXISTS "${nombreTabla}_no_truncate" ON "${nombreTabla}";
CREATE TRIGGER "${nombreTabla}_no_truncate"
  BEFORE TRUNCATE ON "${nombreTabla}"
  FOR EACH STATEMENT EXECUTE FUNCTION "${funcion}"();
`.trim();
}
