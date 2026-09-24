import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { tablaNumeradores } from "../../src/drizzle/tabla.js";

/**
 * La tabla de numeradores de UNA corrida de test, con `nombreTabla` (corto:
 * ver `postgres.test.ts`, que lo arma con pocos caracteres de un
 * `randomUUID()` para no pasar el límite de 63 caracteres de un
 * identificador de Postgres una vez que `tablaNumeradores` le agrega el
 * sufijo del índice único, `"_tenant_ambito_tipo_key"`).
 *
 * A diferencia de `packages/tenant/tests/drizzle/esquema.ts` (que aísla
 * cada corrida con su propio `pgSchema`, limpiado con `drop schema ...
 * cascade`), acá el aislamiento es por NOMBRE DE TABLA en `public`: la
 * firma pública de `tablaNumeradores` (`{ tenant, nombre, columnasExtra }`,
 * fija por el brief de la tarea) no tiene un parámetro de schema Postgres,
 * y agregarle uno solo para este test reimplementaría la tabla en vez de
 * ejercitar la real. `postgres.test.ts` limpia con `drop table ... cascade`
 * en vez de `drop schema`, mismo efecto de "no deja nada atrás".
 */
export function crearEsquemaDePrueba(nombreTabla: string) {
  const numeradores = tablaNumeradores({ nombre: nombreTabla });
  return { numeradores };
}

/**
 * El DDL que ejecuta `postgres.test.ts`, generado del MISMO esquema de
 * Drizzle que arma `tablaNumeradores` (`crearEsquemaDePrueba` arriba) — no
 * una reimplementación a mano que podría desincronizarse y dejar de probar
 * lo que este paquete realmente produce. Usa `drizzle-kit/api`
 * (`generateDrizzleJson` + `generateMigration`, lo mismo que corre
 * `drizzle-kit generate` por atrás), sin invocar la CLI ni escribir
 * migraciones en disco — este paquete no trae migraciones (spec 06 §3.2).
 */
export async function ddlDeEsquemaDePrueba(nombreTabla: string): Promise<string[]> {
  const { numeradores } = crearEsquemaDePrueba(nombreTabla);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ numeradores });
  return generateMigration(vacio, conTablas);
}
