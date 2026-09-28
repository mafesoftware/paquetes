import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { tablaIntentos } from "../../src/drizzle/tabla.js";

/**
 * La tabla de intentos de UNA corrida de test, con `nombreTabla` (corto: ver
 * `postgres.test.ts`, que lo arma con pocos caracteres de un `randomUUID()`
 * para no pasar el límite de 63 caracteres de un identificador de
 * Postgres).
 *
 * Igual que `packages/numeradores/tests/drizzle/esquema.ts`: el aislamiento
 * entre corridas es por NOMBRE DE TABLA en `public` (la firma pública de
 * `tablaIntentos` no tiene un parámetro de schema de Postgres), no por
 * `pgSchema` — `postgres.test.ts` limpia con `drop table ... cascade`.
 */
export function crearEsquemaDePrueba(nombreTabla: string) {
  const limiteIntentos = tablaIntentos({ nombre: nombreTabla });
  return { limiteIntentos };
}

/**
 * El DDL que ejecuta `postgres.test.ts`, generado del MISMO esquema de
 * Drizzle que arma `tablaIntentos` (`crearEsquemaDePrueba` arriba) — no una
 * reimplementación a mano que podría desincronizarse. Usa `drizzle-kit/api`
 * (`generateDrizzleJson` + `generateMigration`, lo mismo que corre
 * `drizzle-kit generate` por atrás), sin invocar la CLI ni escribir
 * migraciones en disco.
 */
export async function ddlDeEsquemaDePrueba(nombreTabla: string): Promise<string[]> {
  const { limiteIntentos } = crearEsquemaDePrueba(nombreTabla);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ limiteIntentos });
  return generateMigration(vacio, conTablas);
}
