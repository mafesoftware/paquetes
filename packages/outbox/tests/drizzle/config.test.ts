import { describe, expect, it } from "vitest";
import { getTableConfig, text } from "drizzle-orm/pg-core";
import { tablaOutbox } from "../../src/drizzle/tabla.js";

/**
 * Verifica que `tablaOutbox` arma la configuración de tabla correcta,
 * leyendo la metadata que expone `drizzle-orm/pg-core` (`getTableConfig`).
 * NO toca Postgres: corre siempre, con o sin Docker (a diferencia de
 * `postgres.test.ts`, en esta misma carpeta).
 */
describe("tablaOutbox (sin Postgres)", () => {
  it('con los defaults: tabla "outbox", columna de tenant organizacion_id (uuid)', () => {
    const tabla = tablaOutbox();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("outbox");

    const tenantId = config.columns.find((c) => c.name === "organizacion_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("uuid");
  });

  it("admite columna/tipo de tenant custom (club_id, text) y nombre de tabla custom", () => {
    const tabla = tablaOutbox({ tenant: { columna: "club_id", tipo: "text" }, nombre: "avisos" });
    const config = getTableConfig(tabla);
    expect(config.name).toBe("avisos");

    const tenantId = config.columns.find((c) => c.name === "club_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("text");
  });

  it("id: uuid, PK, con default", () => {
    const config = getTableConfig(tablaOutbox());
    const id = config.columns.find((c) => c.name === "id");
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("uuid");
    expect(id?.hasDefault).toBe(true);
  });

  it("canal/destino/plantilla: text, NOT NULL, sin default", () => {
    const config = getTableConfig(tablaOutbox());
    for (const nombre of ["canal", "destino", "plantilla"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(true);
      expect(columna?.getSQLType(), nombre).toBe("text");
    }
  });

  it("datos: jsonb, NOT NULL, con default", () => {
    const config = getTableConfig(tablaOutbox());
    const datos = config.columns.find((c) => c.name === "datos");
    expect(datos?.notNull).toBe(true);
    expect(datos?.getSQLType()).toBe("jsonb");
    expect(datos?.hasDefault).toBe(true);
  });

  it("clave_idempotencia: text, NOT NULL, sin default", () => {
    const config = getTableConfig(tablaOutbox());
    const clave = config.columns.find((c) => c.name === "clave_idempotencia");
    expect(clave?.notNull).toBe(true);
    expect(clave?.default).toBeUndefined();
  });

  it('estado: text, NOT NULL, default "pendiente"', () => {
    const config = getTableConfig(tablaOutbox());
    const estado = config.columns.find((c) => c.name === "estado");
    expect(estado?.notNull).toBe(true);
    expect(estado?.default).toBe("pendiente");
  });

  it("intentos: integer, NOT NULL, default 0; max_intentos: integer, NOT NULL, default 5", () => {
    const config = getTableConfig(tablaOutbox());
    const intentos = config.columns.find((c) => c.name === "intentos");
    const maxIntentos = config.columns.find((c) => c.name === "max_intentos");
    expect(intentos?.notNull).toBe(true);
    expect(intentos?.getSQLType()).toBe("integer");
    expect(intentos?.default).toBe(0);
    expect(maxIntentos?.notNull).toBe(true);
    expect(maxIntentos?.default).toBe(5);
  });

  it("programado_para: timestamptz, NOT NULL, con default (now())", () => {
    const config = getTableConfig(tablaOutbox());
    const programadoPara = config.columns.find((c) => c.name === "programado_para");
    expect(programadoPara?.notNull).toBe(true);
    expect(programadoPara?.getSQLType()).toBe("timestamp with time zone");
    expect(programadoPara?.hasDefault).toBe(true);
  });

  it("proximo_intento_en / bloqueado_hasta: timestamptz, nullable, sin default", () => {
    const config = getTableConfig(tablaOutbox());
    for (const nombre of ["proximo_intento_en", "bloqueado_hasta"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(false);
      expect(columna?.getSQLType(), nombre).toBe("timestamp with time zone");
    }
  });

  it("ultimo_error_categoria / ultimo_error_codigo / id_externo: text, nullable", () => {
    const config = getTableConfig(tablaOutbox());
    for (const nombre of ["ultimo_error_categoria", "ultimo_error_codigo", "id_externo"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(false);
    }
  });

  it("enviado_en: timestamptz, nullable; creado_en/actualizado_en: timestamptz, NOT NULL, con default", () => {
    const config = getTableConfig(tablaOutbox());
    const enviadoEn = config.columns.find((c) => c.name === "enviado_en");
    expect(enviadoEn?.notNull).toBe(false);

    for (const nombre of ["creado_en", "actualizado_en"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(true);
      expect(columna?.hasDefault, nombre).toBe(true);
    }
  });

  it("índice único sobre (tenant, clave_idempotencia)", () => {
    const config = getTableConfig(tablaOutbox());
    const unico = config.indexes.find((i) => i.config.unique);
    expect(unico).toBeDefined();
    const columnas = unico!.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(columnas).toEqual(["organizacion_id", "clave_idempotencia"]);
  });

  it("índice (no único) sobre (estado, proximo_intento_en)", () => {
    const config = getTableConfig(tablaOutbox());
    const noUnico = config.indexes.find((i) => !i.config.unique);
    expect(noUnico).toBeDefined();
    const columnas = noUnico!.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(columnas).toEqual(["estado", "proximo_intento_en"]);
  });

  it("exactamente dos índices (el único y el de estado/proximo_intento_en)", () => {
    const config = getTableConfig(tablaOutbox());
    expect(config.indexes).toHaveLength(2);
  });

  it("columnasExtra se agregan a la tabla junto con las propias", () => {
    const tabla = tablaOutbox({ columnasExtra: { creadoPor: text("creado_por") } });
    const config = getTableConfig(tabla);
    expect(config.columns.some((c) => c.name === "creado_por")).toBe(true);
  });
});
