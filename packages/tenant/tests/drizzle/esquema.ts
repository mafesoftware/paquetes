import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { columnaTenant, fkTenant, unicoConTenant } from "../../src/drizzle/index.js";

/**
 * El par `proyectos` (padre) + `unidades` (hija) del ejemplo del README,
 * armado con las tres funciones de `src/drizzle/`, dentro de un esquema
 * Postgres propio (`nombreEsquema`) para que cada corrida de test quede
 * aislada de las demás y se pueda limpiar con un solo `drop schema ...
 * cascade`.
 */
export function crearEsquemaDePrueba(nombreEsquema: string) {
  const esquema = pgSchema(nombreEsquema);

  const proyectos = esquema.table(
    "proyectos",
    {
      id: uuid("id").notNull(),
      organizacionId: columnaTenant(),
      nombre: text("nombre").notNull(),
    },
    (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
  );

  const unidades = esquema.table(
    "unidades",
    {
      id: uuid("id").notNull(),
      organizacionId: columnaTenant(),
      proyectoId: uuid("proyecto_id").notNull(),
      nombre: text("nombre").notNull(),
    },
    (t) => [
      fkTenant({
        columnas: { tenant: t.organizacionId, padreId: t.proyectoId },
        columnasPadre: { tenant: proyectos.organizacionId, id: proyectos.id },
      }),
    ],
  );

  return { esquema, proyectos, unidades };
}

/**
 * El DDL que ejecuta el test de Postgres, generado del MISMO esquema de
 * Drizzle que arman `columnaTenant`/`unicoConTenant`/`fkTenant`
 * (`crearEsquemaDePrueba` arriba) — no una reimplementación a mano que
 * podría desincronizarse y dejar de probar lo que este paquete realmente
 * produce.
 *
 * Usa `drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`, lo
 * mismo que corre `drizzle-kit generate` por atrás) para pasar de "esquema
 * vacío" a "el esquema de `crearEsquemaDePrueba`", sin invocar la CLI de
 * drizzle-kit ni escribir migraciones en disco — este paquete no trae
 * migraciones (spec 06 §3.2), esto es solo cómo se arma la base de UN test.
 *
 * `generateMigration` no emite el `create schema`: Postgres necesita que el
 * esquema (`nombreEsquema`) ya exista antes de crear tablas adentro, así
 * que esa única línea se antepone a mano.
 */
export async function ddlDeEsquemaDePrueba(nombreEsquema: string): Promise<string[]> {
  const { proyectos, unidades } = crearEsquemaDePrueba(nombreEsquema);

  const vacio = await generateDrizzleJson({});
  const conTablas = await generateDrizzleJson({ proyectos, unidades });
  const statements = await generateMigration(vacio, conTablas);

  return [`create schema "${nombreEsquema}"`, ...statements];
}
