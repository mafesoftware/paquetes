import { describe, expect, it } from "vitest";
import { getTableConfig, pgTable, text as textCol, uuid as uuidCol } from "drizzle-orm/pg-core";
import { columnaTenant, fkTenant, unicoConTenant } from "../../src/drizzle/index.js";
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

  it('el nombre por defecto de la FK es corto: "unidades_proyecto_id_tenant_fk", no el que arma drizzle solo', () => {
    const config = getTableConfig(unidades);
    const nombre = config.foreignKeys[0]!.getName();
    expect(nombre).toBe("unidades_proyecto_id_tenant_fk");
    expect(nombre.length).toBeLessThanOrEqual(63);
  });

  it("fkTenant respeta un nombre explícito", () => {
    const padre = pgTable(
      "padre_nombre",
      { id: uuidCol("id").notNull(), organizacionId: columnaTenant() },
      (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
    );
    const hijo = pgTable(
      "hijo_nombre",
      { id: uuidCol("id").notNull(), organizacionId: columnaTenant(), padreId: uuidCol("padre_id").notNull() },
      (t) => [
        fkTenant({
          columnas: { tenant: t.organizacionId, padreId: t.padreId },
          columnasPadre: { tenant: padre.organizacionId, id: padre.id },
          nombre: "mi_fk_a_mano",
        }),
      ],
    );
    expect(getTableConfig(hijo).foreignKeys[0]!.getName()).toBe("mi_fk_a_mano");
  });
});

describe("fkTenant: nombre por defecto con tabla/columna de nombre largo", () => {
  /**
   * Postgres trunca un identificador a 63 caracteres (`NAMEDATALEN` 64 - 1)
   * EN SILENCIO — dos FKs cuyo nombre completo difiere solo después del
   * carácter 63 terminan con el MISMO nombre real en la base, y la segunda
   * falla al crearse con "constraint already exists" (o peor, ninguna falla
   * y quedan indistinguibles). `fkTenant` tiene que evitar los 63
   * caracteres ANTES de que lleguen a Postgres.
   */
  function fkConNombresLargos(tablaHija: string, columnaPadre: string) {
    const padre = pgTable(
      "padre_largo",
      { id: uuidCol("id").notNull(), organizacionId: columnaTenant() },
      (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
    );
    const hijo = pgTable(
      tablaHija,
      { id: uuidCol("id").notNull(), organizacionId: columnaTenant(), [columnaPadre]: uuidCol(columnaPadre).notNull() },
      (t) => [
        fkTenant({
          columnas: { tenant: t["organizacionId"]!, padreId: t[columnaPadre]! },
          columnasPadre: { tenant: padre.organizacionId, id: padre.id },
        }),
      ],
    );
    return getTableConfig(hijo).foreignKeys[0]!.getName();
  }

  const TABLA_LARGA = "unidades_de_un_proyecto_de_construccion_con_un_nombre_extremadamente_largo_para_forzar_el_truncamiento";
  const COLUMNA_LARGA = "proyecto_de_construccion_con_nombre_tambien_muy_largo_id";

  it("el nombre resultante nunca supera los 63 caracteres, aunque tabla y columna sean largas", () => {
    const nombre = fkConNombresLargos(TABLA_LARGA, COLUMNA_LARGA);
    expect(nombre.length).toBeLessThanOrEqual(63);
    expect(nombre.length).toBeGreaterThan(0);
  });

  it("es determinístico: la misma tabla/columna siempre produce el mismo nombre truncado", () => {
    const primero = fkConNombresLargos(TABLA_LARGA, COLUMNA_LARGA);
    const segundo = fkConNombresLargos(TABLA_LARGA, COLUMNA_LARGA);
    expect(primero).toBe(segundo);
  });

  it("dos nombres largos que truncan al mismo prefijo NO colisionan (el hash los distingue)", () => {
    const a = fkConNombresLargos(TABLA_LARGA, `${COLUMNA_LARGA}_variante_a`);
    const b = fkConNombresLargos(TABLA_LARGA, `${COLUMNA_LARGA}_variante_b`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(b.length).toBeLessThanOrEqual(63);
  });
});
