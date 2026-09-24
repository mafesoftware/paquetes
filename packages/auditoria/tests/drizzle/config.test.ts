import { describe, expect, it } from "vitest";
import { getTableConfig, text } from "drizzle-orm/pg-core";
import { tablaAuditoria } from "../../src/drizzle/tabla.js";
import { sqlInmutabilidad } from "../../src/drizzle/inmutabilidad.js";

/**
 * Verifica que `tablaAuditoria` arma la configuración de tabla correcta
 * (metadata de `drizzle-orm/pg-core`, `getTableConfig`) y que
 * `sqlInmutabilidad` valida su argumento — NO toca Postgres: corre siempre,
 * con o sin Docker (a diferencia de `tests/drizzle/postgres*.test.ts`).
 */
describe("tablaAuditoria (sin Postgres)", () => {
  it('con los defaults: tabla "auditoria", columna de tenant organizacion_id (uuid)', () => {
    const tabla = tablaAuditoria();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("auditoria");

    const tenantId = config.columns.find((c) => c.name === "organizacion_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("uuid");
  });

  it("admite columna/tipo de tenant custom (club_id, text) y nombre de tabla custom", () => {
    const tabla = tablaAuditoria({ tenant: { columna: "club_id", tipo: "text" }, nombre: "auditoria_club" });
    const config = getTableConfig(tabla);
    expect(config.name).toBe("auditoria_club");

    const tenantId = config.columns.find((c) => c.name === "club_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("text");
  });

  it("id: uuid, primary key, con default", () => {
    const config = getTableConfig(tablaAuditoria());
    const id = config.columns.find((c) => c.name === "id");
    expect(id).toBeDefined();
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("uuid");
    expect(id?.hasDefault).toBe(true);
  });

  it("entidad/entidad_id/accion/actor_tipo: text, NOT NULL", () => {
    const config = getTableConfig(tablaAuditoria());
    for (const nombre of ["entidad", "entidad_id", "accion", "actor_tipo"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(true);
      expect(columna?.getSQLType(), nombre).toBe("text");
    }
  });

  it("actor_id: text, nullable", () => {
    const config = getTableConfig(tablaAuditoria());
    const actorId = config.columns.find((c) => c.name === "actor_id");
    expect(actorId).toBeDefined();
    expect(actorId?.notNull).toBe(false);
  });

  it("antes/despues: jsonb, nullable; cambios: jsonb, NOT NULL", () => {
    const config = getTableConfig(tablaAuditoria());
    const antes = config.columns.find((c) => c.name === "antes");
    const despues = config.columns.find((c) => c.name === "despues");
    const cambios = config.columns.find((c) => c.name === "cambios");
    expect(antes?.getSQLType()).toBe("jsonb");
    expect(antes?.notNull).toBe(false);
    expect(despues?.getSQLType()).toBe("jsonb");
    expect(despues?.notNull).toBe(false);
    expect(cambios?.getSQLType()).toBe("jsonb");
    expect(cambios?.notNull).toBe(true);
  });

  it("ip/user_agent: text, nullable", () => {
    const config = getTableConfig(tablaAuditoria());
    for (const nombre of ["ip", "user_agent"]) {
      const columna = config.columns.find((c) => c.name === nombre);
      expect(columna, nombre).toBeDefined();
      expect(columna?.notNull, nombre).toBe(false);
    }
  });

  it("creado_en: timestamptz, NOT NULL, defaultNow()", () => {
    const config = getTableConfig(tablaAuditoria());
    const creadoEn = config.columns.find((c) => c.name === "creado_en");
    expect(creadoEn).toBeDefined();
    expect(creadoEn?.notNull).toBe(true);
    expect(creadoEn?.getSQLType()).toBe("timestamp with time zone");
    expect(creadoEn?.hasDefault).toBe(true);
  });

  it("dos índices NO únicos: (tenant, entidad, entidad_id, creado_en) y (tenant, creado_en)", () => {
    const config = getTableConfig(tablaAuditoria());
    expect(config.indexes).toHaveLength(2);
    for (const indice of config.indexes) {
      expect(indice.config.unique).toBeFalsy();
    }
    const columnasPorIndice = config.indexes.map((i) => i.config.columns.map((c) => ("name" in c ? c.name : undefined)));
    expect(columnasPorIndice).toContainEqual(["organizacion_id", "entidad", "entidad_id", "creado_en"]);
    expect(columnasPorIndice).toContainEqual(["organizacion_id", "creado_en"]);
  });

  it("columnasExtra se agregan a la tabla junto con las propias", () => {
    const tabla = tablaAuditoria({ columnasExtra: { correlationId: text("correlation_id") } });
    const config = getTableConfig(tabla);
    expect(config.columns.some((c) => c.name === "correlation_id")).toBe(true);
  });

  it("M9: valida \"nombre\" con el MISMO patrón que sqlInmutabilidad y tira si no matchea", () => {
    expect(() => tablaAuditoria({ nombre: "Auditoria" })).toThrow(); // mayúscula
    expect(() => tablaAuditoria({ nombre: "2auditoria" })).toThrow(); // empieza con dígito
    expect(() => tablaAuditoria({ nombre: "con espacio" })).toThrow();
    expect(() => tablaAuditoria({ nombre: "" })).toThrow();
    expect(() => tablaAuditoria({ nombre: "auditoria_valida" })).not.toThrow();
  });

  it("M8/M9: tira si \"nombre\" supera el largo máximo (mismo tope que sqlInmutabilidad)", () => {
    expect(() => tablaAuditoria({ nombre: "a".repeat(41) })).toThrow();
    expect(() => tablaAuditoria({ nombre: "a".repeat(40) })).not.toThrow();
  });
});

describe("sqlInmutabilidad (sin Postgres)", () => {
  it("devuelve SQL con CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS y los tres triggers (UPDATE, DELETE, TRUNCATE)", () => {
    const sqlTexto = sqlInmutabilidad("auditoria");
    expect(sqlTexto).toContain("CREATE OR REPLACE FUNCTION");
    expect(sqlTexto).toContain("DROP TRIGGER IF EXISTS");
    expect(sqlTexto).toContain("BEFORE UPDATE OR DELETE");
    expect(sqlTexto).toContain("BEFORE TRUNCATE");
    expect(sqlTexto).toContain('"auditoria"');
  });

  it("es idempotente en su TEXTO: correrlo dos veces da exactamente el mismo SQL", () => {
    expect(sqlInmutabilidad("auditoria")).toBe(sqlInmutabilidad("auditoria"));
  });

  it("nombres de tabla válidos (^[a-z_][a-z0-9_]*$) no tiran", () => {
    expect(() => sqlInmutabilidad("auditoria")).not.toThrow();
    expect(() => sqlInmutabilidad("_auditoria_2")).not.toThrow();
    expect(() => sqlInmutabilidad("a")).not.toThrow();
  });

  it("nombres de tabla inválidos tiran (mayúsculas, espacios, empieza con dígito, caracteres de inyección)", () => {
    expect(() => sqlInmutabilidad("Auditoria")).toThrow();
    expect(() => sqlInmutabilidad("auditoria; drop table x --")).toThrow();
    expect(() => sqlInmutabilidad("2auditoria")).toThrow();
    expect(() => sqlInmutabilidad("con espacio")).toThrow();
    expect(() => sqlInmutabilidad("")).toThrow();
  });

  it("M8: tira si el nombre de tabla supera el largo máximo (40 caracteres), para que los identificadores derivados queden bajo el límite de 63 de Postgres", () => {
    const nombreLargo = "a".repeat(41);
    expect(() => sqlInmutabilidad(nombreLargo)).toThrow();

    const nombreLimite = "a".repeat(40);
    expect(() => sqlInmutabilidad(nombreLimite)).not.toThrow();
    // El identificador más largo que arma (la función) queda bajo 63.
    const funcionMasLarga = `${nombreLimite}_bloquear_escritura`;
    expect(funcionMasLarga.length).toBeLessThanOrEqual(63);
  });

  it("M9: tablaAuditoria y sqlInmutabilidad aceptan/rechazan EXACTAMENTE los mismos nombres", () => {
    const nombres = ["auditoria", "Auditoria", "2x", "a".repeat(40), "a".repeat(41), "con espacio", "_ok_"];
    for (const nombre of nombres) {
      let tablaTira = false;
      let inmutabilidadTira = false;
      try {
        tablaAuditoria({ nombre });
      } catch {
        tablaTira = true;
      }
      try {
        sqlInmutabilidad(nombre);
      } catch {
        inmutabilidadTira = true;
      }
      expect(tablaTira, nombre).toBe(inmutabilidadTira);
    }
  });
});
