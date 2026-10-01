import { describe, expect, it } from "vitest";
import { getTableConfig, uuid } from "drizzle-orm/pg-core";
import { tablaPadronIibb } from "../../src/drizzle/padron.js";

/**
 * Verifica que `tablaPadronIibb` arma la configuración de tabla correcta,
 * leyendo la metadata que expone `drizzle-orm/pg-core` (`getTableConfig`).
 * NO toca Postgres: corre siempre, con o sin Docker.
 */
describe("tablaPadronIibb (sin Postgres)", () => {
  it('con los defaults: tabla "padron_iibb", columna de tenant organizacion_id (uuid)', () => {
    const tabla = tablaPadronIibb();
    const config = getTableConfig(tabla);
    expect(config.name).toBe("padron_iibb");

    const tenantId = config.columns.find((c) => c.name === "organizacion_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("uuid");
  });

  it("admite columna/tipo de tenant custom y nombre de tabla custom", () => {
    const tabla = tablaPadronIibb({ tenant: { columna: "club_id", tipo: "text" }, nombre: "padron" });
    const config = getTableConfig(tabla);
    expect(config.name).toBe("padron");

    const tenantId = config.columns.find((c) => c.name === "club_id");
    expect(tenantId).toBeDefined();
    expect(tenantId?.notNull).toBe(true);
    expect(tenantId?.getSQLType()).toBe("text");
  });

  it("alicuota: numeric(11, 8), NOT NULL", () => {
    const config = getTableConfig(tablaPadronIibb());
    const alicuota = config.columns.find((c) => c.name === "alicuota");
    expect(alicuota?.notNull).toBe(true);
    expect(alicuota?.getSQLType()).toBe("numeric(11, 8)");
  });

  it("vigente_hasta: date, nullable (sin fin de vigencia)", () => {
    const config = getTableConfig(tablaPadronIibb());
    const vigenteHasta = config.columns.find((c) => c.name === "vigente_hasta");
    expect(vigenteHasta?.notNull).toBe(false);
    expect(vigenteHasta?.getSQLType()).toBe("date");
  });

  it("único por (tenant, jurisdiccion, periodo, cuit, tipo)", () => {
    const config = getTableConfig(tablaPadronIibb());
    const unico = config.indexes.find((i) => i.config.unique);
    expect(unico).toBeDefined();
    const columnas = unico!.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(columnas).toEqual(["organizacion_id", "jurisdiccion", "periodo", "cuit", "tipo"]);
  });

  it("admite columnasExtra además de las propias", () => {
    const tabla = tablaPadronIibb({ columnasExtra: { origen: uuid("origen_importacion_id") } });
    const config = getTableConfig(tabla);
    expect(config.columns.find((c) => c.name === "origen_importacion_id")).toBeDefined();
  });
});
