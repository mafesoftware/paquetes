import { describe, expect, it } from "vitest";
import { getTableConfig, text } from "drizzle-orm/pg-core";
import { tablaIntentos } from "../../src/drizzle/tabla.js";

/**
 * Verifica que `tablaIntentos` arma la configuración de tabla correcta,
 * leyendo la metadata que expone `drizzle-orm/pg-core` (`getTableConfig`).
 * NO toca Postgres: corre siempre, con o sin Docker (a diferencia de
 * `postgres.test.ts`, en esta misma carpeta).
 */
describe("tablaIntentos (sin Postgres)", () => {
  it('con los defaults: tabla "limite_intentos", sin columna de tenant', () => {
    const tabla = tablaIntentos();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("limite_intentos");
    expect(config.columns.some((c) => c.name === "organizacion_id")).toBe(false);
  });

  it("admite nombre de tabla custom", () => {
    const tabla = tablaIntentos({ nombre: "intentos_login" });
    expect(getTableConfig(tabla).name).toBe("intentos_login");
  });

  it("clave: text, PRIMARY KEY", () => {
    const config = getTableConfig(tablaIntentos());
    const clave = config.columns.find((c) => c.name === "clave");
    expect(clave).toBeDefined();
    expect(clave?.primary).toBe(true);
    expect(clave?.getSQLType()).toBe("text");
  });

  it("contador: integer, NOT NULL, default 0", () => {
    const config = getTableConfig(tablaIntentos());
    const contador = config.columns.find((c) => c.name === "contador");
    expect(contador?.notNull).toBe(true);
    expect(contador?.getSQLType()).toBe("integer");
    expect(contador?.default).toBe(0);
  });

  it("ventana_desde: timestamptz, NOT NULL, defaultNow()", () => {
    const config = getTableConfig(tablaIntentos());
    const ventanaDesde = config.columns.find((c) => c.name === "ventana_desde");
    expect(ventanaDesde?.notNull).toBe(true);
    expect(ventanaDesde?.getSQLType()).toBe("timestamp with time zone");
    expect(ventanaDesde?.hasDefault).toBe(true);
  });

  it("bloqueado_hasta: timestamptz, nullable, sin default", () => {
    const config = getTableConfig(tablaIntentos());
    const bloqueadoHasta = config.columns.find((c) => c.name === "bloqueado_hasta");
    expect(bloqueadoHasta).toBeDefined();
    expect(bloqueadoHasta?.notNull).toBe(false);
    expect(bloqueadoHasta?.getSQLType()).toBe("timestamp with time zone");
    expect(bloqueadoHasta?.hasDefault).toBe(false);
  });

  it("actualizado_en: timestamptz, NOT NULL, defaultNow()", () => {
    const config = getTableConfig(tablaIntentos());
    const actualizadoEn = config.columns.find((c) => c.name === "actualizado_en");
    expect(actualizadoEn?.notNull).toBe(true);
    expect(actualizadoEn?.getSQLType()).toBe("timestamp with time zone");
    expect(actualizadoEn?.hasDefault).toBe(true);
  });

  it("sin índices/uniques aparte de la PK de clave (no hay índice único extra)", () => {
    const config = getTableConfig(tablaIntentos());
    expect(config.indexes).toHaveLength(0);
    expect(config.uniqueConstraints).toHaveLength(0);
  });

  describe("tenant (opcional)", () => {
    it("con tenant: agrega la columna, NULLABLE, con los defaults (organizacion_id, uuid)", () => {
      const config = getTableConfig(tablaIntentos({ tenant: {} }));
      const tenantId = config.columns.find((c) => c.name === "organizacion_id");
      expect(tenantId).toBeDefined();
      expect(tenantId?.notNull).toBe(false);
      expect(tenantId?.getSQLType()).toBe("uuid");
    });

    it("admite columna/tipo de tenant custom (club_id, text), sigue NULLABLE", () => {
      const config = getTableConfig(tablaIntentos({ tenant: { columna: "club_id", tipo: "text" } }));
      const tenantId = config.columns.find((c) => c.name === "club_id");
      expect(tenantId).toBeDefined();
      expect(tenantId?.notNull).toBe(false);
      expect(tenantId?.getSQLType()).toBe("text");
    });
  });

  it("columnasExtra se agregan a la tabla junto con las propias", () => {
    const tabla = tablaIntentos({ columnasExtra: { canal: text("canal") } });
    const config = getTableConfig(tabla);
    expect(config.columns.some((c) => c.name === "canal")).toBe(true);
  });
});
