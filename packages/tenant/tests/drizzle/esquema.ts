import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
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
 * DDL equivalente al que emitiría `drizzle-kit generate` para el esquema de
 * arriba (hand-written: no se invoca drizzle-kit en el test para no
 * depender de su CLI ni de escribir migraciones en disco — este paquete no
 * trae migraciones, spec 06 §3.2). La FK compuesta es la pieza que importa
 * probar contra Postgres de verdad: es la que un ORM sin este helper no
 * arma sola.
 */
export function ddlDeEsquemaDePrueba(nombreEsquema: string): string[] {
  const e = `"${nombreEsquema}"`;
  return [
    `create schema ${e}`,
    `create table ${e}."proyectos" (
      "id" uuid not null,
      "organizacion_id" uuid not null,
      "nombre" text not null,
      constraint "proyectos_pkey" primary key ("id"),
      constraint "proyectos_organizacion_id_id_unique" unique ("organizacion_id","id")
    )`,
    `create table ${e}."unidades" (
      "id" uuid not null,
      "organizacion_id" uuid not null,
      "proyecto_id" uuid not null,
      "nombre" text not null,
      constraint "unidades_pkey" primary key ("id"),
      constraint "unidades_organizacion_id_proyecto_id_fk"
        foreign key ("organizacion_id", "proyecto_id")
        references ${e}."proyectos" ("organizacion_id", "id")
    )`,
  ];
}
