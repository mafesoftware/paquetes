import { describe, expect, it } from "vitest";
import { getTableConfig, uuid } from "drizzle-orm/pg-core";
import { tablaExclusiones } from "../../src/drizzle/exclusiones.js";

/**
 * Verifica que `tablaExclusiones` arma la configuración de tabla correcta,
 * leyendo la metadata que expone `drizzle-orm/pg-core` (`getTableConfig`).
 * NO toca Postgres: corre siempre, con o sin Docker.
 */
describe("tablaExclusiones (sin Postgres)", () => {
  it('con los defaults: tabla "exclusiones_retencion", columna de tenant organizacion_id (uuid)', () => {
    const tabla = tablaExclusiones();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("exclusiones_retencion");

    const tenantId = config.columns.find((c) => c.name === "organizacion_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("uuid");
  });

  it("admite columna/tipo de tenant custom y nombre de tabla custom", () => {
    const tabla = tablaExclusiones({ tenant: { columna: "club_id", tipo: "text" }, nombre: "certificados_no_retencion" });
    const config = getTableConfig(tabla);
    expect(config.name).toBe("certificados_no_retencion");

    const tenantId = config.columns.find((c) => c.name === "club_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("text");
  });

  it("porcentaje: numeric(11, 8), NOT NULL", () => {
    const config = getTableConfig(tablaExclusiones());
    const porcentaje = config.columns.find((c) => c.name === "porcentaje");
    expect(porcentaje?.notNull).toBe(true);
    expect(porcentaje?.getSQLType()).toBe("numeric(11, 8)");
  });

  it("jurisdiccion: text, nullable (solo aplica a iibb)", () => {
    const config = getTableConfig(tablaExclusiones());
    const jurisdiccion = config.columns.find((c) => c.name === "jurisdiccion");
    expect(jurisdiccion?.notNull).toBe(false);
  });

  it("archivado_en: timestamptz, nullable — nada se borra", () => {
    const config = getTableConfig(tablaExclusiones());
    const archivadoEn = config.columns.find((c) => c.name === "archivado_en");
    expect(archivadoEn?.notNull).toBe(false);
  });

  it("sin FK al sujeto retenido por defecto: se agrega vía columnasExtra", () => {
    const tabla = tablaExclusiones({ columnasExtra: { proveedorId: uuid("proveedor_id").notNull() } });
    const config = getTableConfig(tabla);
    const proveedorId = config.columns.find((c) => c.name === "proveedor_id");
    expect(proveedorId).toBeDefined();
    expect(proveedorId?.notNull).toBe(true);
  });
});
