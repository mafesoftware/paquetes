import { validarNombreTabla } from "./nombre-tabla.js";

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
 * consulta en DDL de Postgres), así que se valida con `validarNombreTabla`
 * (mismo patrón `^[a-z_][a-z0-9_]*$` y mismo tope de 40 caracteres que
 * `tablaAuditoria` — ver `nombre-tabla.ts`) y esta función TIRA si no pasa,
 * antes de armar cualquier string. No es una limitación cosmética: sin esta
 * validación, un `nombreTabla` que viniera de una fuente no confiable sería
 * una inyección SQL directa a esta función.
 *
 * **Este trigger frena errores de la APP, no al dueño de la base.** Un rol
 * con privilegios suficientes puede saltearlo igual — no es una barrera de
 * seguridad contra un atacante con esos privilegios o contra un error de
 * operación a ese nivel, es una red contra un bug/`UPDATE` manual accidental
 * desde el rol con el que corre la aplicación:
 *
 * - `SET session_replication_role = replica;` desactiva TODOS los triggers
 *   normales de la sesión (Postgres lo usa para replicación lógica, pero
 *   cualquier rol con privilegio para setearlo puede usarlo para esto).
 * - El DUEÑO de la tabla (o un superusuario) puede `ALTER TABLE ...
 *   DISABLE TRIGGER ALL` (o el trigger por nombre), corre el `UPDATE`/
 *   `DELETE`, y lo vuelve a habilitar — sin que el trigger se entere.
 * - `DROP TABLE` (o `DROP TABLE ... CASCADE`) se lleva el trigger puesto:
 *   no hay nada que "inmutabilizar" si la tabla entera desaparece.
 * - Un superusuario de Postgres puede, en general, saltear cualquier
 *   restricción a nivel de base (RLS incluido) salvo que se configure
 *   explícitamente lo contrario.
 *
 * **Recomendación**: el rol con el que corre la APP (el que usa
 * `auditar`/`listarAuditoria` en producción) NO debería ser el DUEÑO de la
 * tabla de auditoría — si lo es, `DISABLE TRIGGER` queda a un `ALTER TABLE`
 * de distancia de ese mismo rol, y el trigger deja de proteger ni siquiera
 * contra un bug de la propia app (una migración mal escrita que corra con
 * ese rol, por ejemplo). Crear la tabla (y agregar este trigger) con un rol
 * de migraciones separado, y dar al rol de la app solo `SELECT`/`INSERT` —
 * ni `UPDATE`/`DELETE`/`TRUNCATE` a nivel de PERMISOS de Postgres, ni
 * `ALTER TABLE`, es una capa adicional (independiente de este trigger, y
 * más fuerte: un permiso de Postgres denegado no se puede "desactivar"
 * desde una sesión que no lo tiene) que sí vale la pena sumar.
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
 * sqlInmutabilidad("a".repeat(41)); // tira: nombre demasiado largo
 * ```
 */
export function sqlInmutabilidad(nombreTabla: string): string {
  validarNombreTabla(nombreTabla, "sqlInmutabilidad");

  const funcion = `${nombreTabla}_bloquear_escritura`;

  return `
-- Trigger de inmutabilidad para "${nombreTabla}" (generado por
-- sqlInmutabilidad de @mafesoftware/auditoria/drizzle). Agregar como
-- migración A MANO, después de la que generó drizzle-kit para esta tabla.
-- Idempotente: se puede correr más de una vez sin fallar.
--
-- Frena errores de la APP, no al dueño de la base: session_replication_role
-- = replica, un ALTER TABLE ... DISABLE TRIGGER del dueño de la tabla, un
-- DROP TABLE, o un superusuario, lo saltean igual — ver el JSDoc de
-- sqlInmutabilidad en el paquete @mafesoftware/auditoria para el detalle y
-- la recomendación de que el rol de la app no sea dueño de esta tabla.

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
