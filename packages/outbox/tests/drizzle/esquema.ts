import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { tablaOutbox } from "../../src/drizzle/tabla.js";

/**
 * La tabla de outbox de UNA corrida de test, con `nombreTabla` (corto: ver
 * `postgres.test.ts`, que lo arma con pocos caracteres de un `randomUUID()`
 * para no pasar el límite de 63 caracteres de un identificador de Postgres
 * una vez que `tablaOutbox` le agrega el sufijo del índice único,
 * `"_tenant_clave_idem_key"`).
 *
 * Mismo criterio que `packages/numeradores/tests/drizzle/esquema.ts`: el
 * aislamiento es por NOMBRE DE TABLA en `public` (`tablaOutbox` no tiene un
 * parámetro de schema Postgres), no por `pgSchema`.
 */
export function crearEsquemaDePrueba(nombreTabla: string) {
  const outbox = tablaOutbox({ nombre: nombreTabla });
  return { outbox };
}

/**
 * El DDL que ejecuta `postgres.test.ts`, generado del MISMO esquema de
 * Drizzle que arma `tablaOutbox` (`crearEsquemaDePrueba` arriba) — no una
 * reimplementación a mano que podría desincronizarse. Usa `drizzle-kit/api`
 * (`generateDrizzleJson` + `generateMigration`), sin invocar la CLI ni
 * escribir migraciones en disco — este paquete no trae migraciones.
 */
export async function ddlDeEsquemaDePrueba(nombreTabla: string): Promise<string[]> {
  const { outbox } = crearEsquemaDePrueba(nombreTabla);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ outbox });
  return generateMigration(vacio, conTablas);
}
