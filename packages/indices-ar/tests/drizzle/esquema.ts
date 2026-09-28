import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { tablaCotizaciones } from "../../src/drizzle/tabla-cotizaciones.js";
import { tablaIndices } from "../../src/drizzle/tabla-indices.js";
import { tablaValoresIndice } from "../../src/drizzle/tabla-valores-indice.js";

/**
 * Las tres tablas de UNA corrida de test, con nombres únicos (ver
 * `postgres.test.ts`, que los arma con pocos caracteres de un `randomUUID()`
 * para no pasar el límite de 63 caracteres de un identificador de Postgres
 * una vez que cada fábrica les agrega el sufijo de sus índices únicos).
 */
export function crearEsquemaDePrueba(prefijo: string) {
  const indices = tablaIndices({ nombre: `${prefijo}_indices` });
  const valoresIndice = tablaValoresIndice({ nombre: `${prefijo}_valores` });
  const cotizaciones = tablaCotizaciones({ nombre: `${prefijo}_cotizaciones` });
  return { indices, valoresIndice, cotizaciones };
}

/**
 * El DDL que ejecuta `postgres.test.ts`, generado del MISMO esquema de
 * Drizzle que arman las fábricas de arriba (`crearEsquemaDePrueba`) — no una
 * reimplementación a mano que podría desincronizarse. Usa `drizzle-kit/api`
 * (`generateDrizzleJson` + `generateMigration`), sin invocar la CLI ni
 * escribir migraciones en disco — este paquete no trae migraciones (spec 06
 * §3.2).
 */
export async function ddlDeEsquemaDePrueba(prefijo: string): Promise<string[]> {
  const tablas = crearEsquemaDePrueba(prefijo);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ ...tablas });
  return generateMigration(vacio, conTablas);
}
