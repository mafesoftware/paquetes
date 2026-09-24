import { describe, expect, it } from "vitest";
import { getTableConfig, pgTable, text as textCol, uuid as uuidCol } from "drizzle-orm/pg-core";
import { columnaTenant } from "../../src/drizzle/index.js";
import { crearEsquemaDePrueba } from "./esquema.js";

/**
 * Verifica que `columnaTenant`/`unicoConTenant`/`fkTenant` arman la
 * configuración de tabla correcta, leyendo la metadata que expone
 * `drizzle-orm/pg-core` (`getTableConfig`). NO toca Postgres: es una
 * verificación estructural sobre el objeto que arma drizzle en JS, así que
 * corre siempre, con o sin Docker (a diferencia de `postgres.test.ts`, en
 * esta misma carpeta).
 */
describe("configuración de tabla (sin Postgres)", () => {
  const { proyectos, unidades } = crearEsquemaDePrueba("tenant_test_config");

  it("columnaTenant agrega organizacion_id uuid not null", () => {
    const columna = getTableConfig(proyectos).columns.find((c) => c.name === "organizacion_id");
    expect(columna).toBeDefined();
    expect(columna?.notNull).toBe(true);
    expect(columna?.getSQLType()).toBe("uuid");
  });

  it("columnaTenant admite nombre y tipo custom (club_id, text)", () => {
    const tabla = pgTable("club_scoped", {
      clubId: columnaTenant("club_id", "text"),
      id: uuidCol("id").notNull(),
      nombre: textCol("nombre").notNull(),
    });
    const columna = getTableConfig(tabla).columns.find((c) => c.name === "club_id");
    expect(columna).toBeDefined();
    expect(columna?.notNull).toBe(true);
    expect(columna?.getSQLType()).toBe("text");
  });

  it("unicoConTenant agrega el unique (organizacion_id, id) en la tabla padre", () => {
    const config = getTableConfig(proyectos);
    expect(config.uniqueConstraints).toHaveLength(1);
    const nombres = config.uniqueConstraints[0]!.columns.map((c) => c.name).sort();
    expect(nombres).toEqual(["id", "organizacion_id"]);
  });

  it("fkTenant agrega la FK compuesta (organizacion_id, proyecto_id) -> proyectos(organizacion_id, id)", () => {
    const config = getTableConfig(unidades);
    expect(config.foreignKeys).toHaveLength(1);

    const referencia = config.foreignKeys[0]!.reference();
    expect(referencia.columns.map((c) => c.name)).toEqual(["organizacion_id", "proyecto_id"]);
    expect(referencia.foreignColumns.map((c) => c.name)).toEqual(["organizacion_id", "id"]);
    expect(referencia.foreignTable).toBe(proyectos);
  });

  it("la tabla hija NO tiene un unique propio (solo la padre lo necesita)", () => {
    expect(getTableConfig(unidades).uniqueConstraints).toHaveLength(0);
  });
});
