import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { tablaAuditoria } from "../../src/drizzle/tabla.js";

/**
 * La tabla de auditoría de UNA corrida de test, con `nombreTabla` (corto:
 * ver `postgres.test.ts`, que lo arma con pocos caracteres de un
 * `randomUUID()` para no pasar el límite de 63 caracteres de un
 * identificador de Postgres una vez que `sqlInmutabilidad` le agrega sus
 * propios sufijos de función/trigger).
 *
 * Igual que `packages/numeradores/tests/drizzle/esquema.ts`: el aislamiento
 * entre corridas es por NOMBRE DE TABLA en `public`, no por `pgSchema` — la
 * firma pública de `tablaAuditoria` no tiene un parámetro de schema de
 * Postgres, y agregarle uno solo para este test reimplementaría la tabla en
 * vez de ejercitar la real.
 */
export function crearEsquemaDePrueba(nombreTabla: string) {
  const auditoria = tablaAuditoria({ nombre: nombreTabla });
  return { auditoria };
}

/**
 * El DDL que ejecutan los tests de Postgres, generado del MISMO esquema de
 * Drizzle que arma `tablaAuditoria` (`crearEsquemaDePrueba` arriba) — no una
 * reimplementación a mano que podría desincronizarse. Usa `drizzle-kit/api`
 * (`generateDrizzleJson` + `generateMigration`), sin invocar la CLI ni
 * escribir migraciones en disco — este paquete no trae migraciones (spec 06
 * §3.2). NO incluye el trigger de inmutabilidad (`sqlInmutabilidad`, que
 * cada test agrega aparte, como corresponde a una migración escrita a
 * mano DESPUÉS de esta).
 */
export async function ddlDeEsquemaDePrueba(nombreTabla: string): Promise<string[]> {
  const { auditoria } = crearEsquemaDePrueba(nombreTabla);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ auditoria });
  return generateMigration(vacio, conTablas);
}
