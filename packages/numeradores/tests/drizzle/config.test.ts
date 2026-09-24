import { describe, expect, it } from "vitest";
import { getTableConfig, text } from "drizzle-orm/pg-core";
import { tablaNumeradores } from "../../src/drizzle/tabla.js";

/**
 * Verifica que `tablaNumeradores` arma la configuración de tabla correcta,
 * leyendo la metadata que expone `drizzle-orm/pg-core` (`getTableConfig`).
 * NO toca Postgres: corre siempre, con o sin Docker (a diferencia de
 * `postgres.test.ts`, en esta misma carpeta).
 */
describe("tablaNumeradores (sin Postgres)", () => {
  it("con los defaults: tabla \"numeradores\", columna de tenant organizacion_id (uuid)", () => {
    const tabla = tablaNumeradores();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("numeradores");

    const tenantId = config.columns.find((c) => c.name === "organizacion_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("uuid");
  });

  it("admite columna/tipo de tenant custom (club_id, text) y nombre de tabla custom", () => {
    const tabla = tablaNumeradores({ tenant: { columna: "club_id", tipo: "text" }, nombre: "numeradores_club" });
    const config = getTableConfig(tabla);
    expect(config.name).toBe("numeradores_club");

    const tenantId = config.columns.find((c) => c.name === "club_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("text");
  });

  it("ambito: text, NOT NULL, default \"\" (\"sin ámbito\", nunca NULL)", () => {
    const config = getTableConfig(tablaNumeradores());
    const ambito = config.columns.find((c) => c.name === "ambito");
    expect(ambito).toBeDefined();
    expect(ambito?.notNull).toBe(true);
    expect(ambito?.getSQLType()).toBe("text");
    expect(ambito?.default).toBe("");
  });

  it("tipo: text, NOT NULL, sin default", () => {
    const config = getTableConfig(tablaNumeradores());
    const tipo = config.columns.find((c) => c.name === "tipo");
    expect(tipo).toBeDefined();
    expect(tipo?.notNull).toBe(true);
    expect(tipo?.getSQLType()).toBe("text");
    expect(tipo?.default).toBeUndefined();
  });

  it("prefijo: text, NOT NULL, default \"\"; relleno: integer, NOT NULL, default 0", () => {
    const config = getTableConfig(tablaNumeradores());
    const prefijo = config.columns.find((c) => c.name === "prefijo");
    const relleno = config.columns.find((c) => c.name === "relleno");
    expect(prefijo?.notNull).toBe(true);
    expect(prefijo?.default).toBe("");
    expect(relleno?.notNull).toBe(true);
    expect(relleno?.getSQLType()).toBe("integer");
    expect(relleno?.default).toBe(0);
  });

  it("proximo: bigint modo bigint, NOT NULL, con default (1, como expresión SQL — ver el porqué en tabla.ts)", () => {
    const config = getTableConfig(tablaNumeradores());
    const proximo = config.columns.find((c) => c.name === "proximo");
    expect(proximo).toBeDefined();
    expect(proximo?.notNull).toBe(true);
    expect(proximo?.getSQLType()).toBe("bigint");
    expect(proximo?.hasDefault).toBe(true);
    // El default real (que la primera fila arranca en 1) lo prueba
    // postgres.test.ts contra Postgres de verdad; acá solo se verifica que
    // haya un default declarado, sin atarse a cómo drizzle representa
    // internamente una expresión SQL.
  });

  it("creado_en / actualizado_en: timestamp con zona horaria, NOT NULL, defaultNow()", () => {
    const config = getTableConfig(tablaNumeradores());
    for (const nombre of ["creado_en", "actualizado_en"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull).toBe(true);
      expect(columna?.getSQLType()).toBe("timestamp with time zone");
      expect(columna?.hasDefault).toBe(true);
    }
  });

  it("índice único sobre (tenant, ambito, tipo)", () => {
    const config = getTableConfig(tablaNumeradores());
    expect(config.indexes).toHaveLength(1);
    const indice = config.indexes[0]!;
    expect(indice.config.unique).toBe(true);
    const columnas = indice.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(columnas).toEqual(["organizacion_id", "ambito", "tipo"]);
  });

  it("columnasExtra se agregan a la tabla junto con las propias", () => {
    const tabla = tablaNumeradores({ columnasExtra: { creadoPor: text("creado_por") } });
    const config = getTableConfig(tabla);
    expect(config.columns.some((c) => c.name === "creado_por")).toBe(true);
  });
});
