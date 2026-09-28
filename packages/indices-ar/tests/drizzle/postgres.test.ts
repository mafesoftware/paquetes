import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { valorVigente } from "../../src/drizzle/valor-vigente.js";
import { crearEsquemaDePrueba, ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: el DDL que arman `tablaIndices` /
 * `tablaValoresIndice` / `tablaCotizaciones` (los dos índices únicos
 * PARCIALES que reemplazan a un único índice normal cuando la columna de
 * tenant es nullable), y `valorVigente` resolviendo el override contra la
 * base real. Nada de esto se puede probar con un mock: lo que se ejercita
 * es el comportamiento de los índices únicos de Postgres sobre `NULL`, que
 * es justo la parte no trivial de esta tarea (spec 02 §3.1: "una
 * organización puede fijar su propio valor para un período").
 *
 * Conexión vía `poolDePrueba()` (`DATABASE_URL_TEST`, default: puerto 5475
 * del `docker-compose.yml` de la raíz) — tira con mensaje claro si Postgres
 * no está arriba, nunca se salta en silencio.
 */
const PREFIJO = `ia_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

let pool: Pool;
let db: NodePgDatabase;
let conectado = false;

const { indices, valoresIndice, cotizaciones } = crearEsquemaDePrueba(PREFIJO);

beforeAll(async () => {
  pool = await poolDePrueba();
  conectado = true;
  db = drizzle(pool);

  for (const sentencia of await ddlDeEsquemaDePrueba(PREFIJO)) {
    await pool.query(sentencia);
  }
});

afterAll(async () => {
  if (!conectado) return;
  await pool
    .query(
      `drop table if exists "${PREFIJO}_indices" cascade;
       drop table if exists "${PREFIJO}_valores" cascade;
       drop table if exists "${PREFIJO}_cotizaciones" cascade;`,
    )
    .catch(() => {});
  await pool.end();
});

describe("tablaIndices (Postgres)", () => {
  it("inserta el catálogo y respeta la PK por código", async () => {
    await db.insert(indices).values({ codigo: "UVA", nombre: "UVA", fuente: "BCRA", frecuencia: "diaria" });
    await expect(
      db.insert(indices).values({ codigo: "UVA", nombre: "otro nombre", fuente: "BCRA", frecuencia: "diaria" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});

describe("tablaValoresIndice: índices únicos parciales (Postgres)", () => {
  it("dos filas GLOBALES (tenant null) del mismo (indice, periodo) chocan", async () => {
    const periodo = "2026-09";
    await db.insert(valoresIndice).values({
      tenantId: null,
      indice: "UVA",
      periodo,
      valor: "2113.20000000",
      estado: "provisorio",
      fechaPublicacion: "2026-09-10",
      fuente: "bcra",
    });

    await expect(
      db.insert(valoresIndice).values({
        tenantId: null,
        indice: "UVA",
        periodo,
        valor: "2113.20000000",
        estado: "provisorio",
        fechaPublicacion: "2026-09-10",
        fuente: "bcra",
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("dos filas del MISMO tenant, mismo (indice, periodo) chocan", async () => {
    const tenantId = randomUUID();
    const periodo = "2026-08";
    await db.insert(valoresIndice).values({
      tenantId,
      indice: "CAC_GENERAL",
      periodo,
      valor: "100.00000000",
      estado: "definitivo",
      fechaPublicacion: "2026-08-05",
      fuente: "manual",
    });

    await expect(
      db.insert(valoresIndice).values({
        tenantId,
        indice: "CAC_GENERAL",
        periodo,
        valor: "101.00000000",
        estado: "definitivo",
        fechaPublicacion: "2026-08-05",
        fuente: "manual",
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("un override de tenant y el valor global del MISMO (indice, periodo) coexisten sin chocar", async () => {
    const tenantId = randomUUID();
    const periodo = "2026-07";

    await expect(
      db.insert(valoresIndice).values({
        tenantId: null,
        indice: "IPC",
        periodo,
        valor: "50.00000000",
        estado: "definitivo",
        fechaPublicacion: "2026-07-05",
        fuente: "indec",
      }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(valoresIndice).values({
        tenantId,
        indice: "IPC",
        periodo,
        valor: "51.00000000",
        estado: "definitivo",
        fechaPublicacion: "2026-07-05",
        fuente: "manual",
      }),
    ).resolves.toBeDefined();
  });

  it("dos tenants distintos, mismo (indice, periodo): no chocan entre sí", async () => {
    const periodo = "2026-06";
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    await expect(
      db.insert(valoresIndice).values({
        tenantId: tenantA,
        indice: "ICL",
        periodo,
        valor: "1.00000000",
        estado: "provisorio",
        fechaPublicacion: "2026-06-01",
        fuente: "manual",
      }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(valoresIndice).values({
        tenantId: tenantB,
        indice: "ICL",
        periodo,
        valor: "1.10000000",
        estado: "provisorio",
        fechaPublicacion: "2026-06-01",
        fuente: "manual",
      }),
    ).resolves.toBeDefined();
  });
});

describe("valorVigente (Postgres)", () => {
  it("sin override de tenant: devuelve el valor GLOBAL", async () => {
    const periodo = "2026-05";
    const tenantId = randomUUID();
    await db.insert(valoresIndice).values({
      tenantId: null,
      indice: "UVA",
      periodo,
      valor: "2000.12345678",
      estado: "definitivo",
      fechaPublicacion: "2026-05-05",
      fuente: "bcra",
    });

    const v = await valorVigente(db, valoresIndice, { tenantId, indice: "UVA", periodo });
    expect(v).toMatchObject({ valor: "2000.12345678", estado: "definitivo", fuente: "bcra", tenantId: null });
  });

  it("con override de tenant: el override GANA sobre el global", async () => {
    const periodo = "2026-04";
    const tenantId = randomUUID();

    await db.insert(valoresIndice).values({
      tenantId: null,
      indice: "CER",
      periodo,
      valor: "700.00000000",
      estado: "definitivo",
      fechaPublicacion: "2026-04-05",
      fuente: "bcra",
    });
    await db.insert(valoresIndice).values({
      tenantId,
      indice: "CER",
      periodo,
      valor: "999.99999999",
      estado: "provisorio",
      fechaPublicacion: "2026-04-05",
      fuente: "manual",
    });

    const v = await valorVigente(db, valoresIndice, { tenantId, indice: "CER", periodo });
    expect(v).toMatchObject({ valor: "999.99999999", estado: "provisorio", fuente: "manual", tenantId });
  });

  it("otro tenant (sin su propio override) sigue viendo el GLOBAL, no el override ajeno", async () => {
    const periodo = "2026-04"; // mismo período que el test anterior: comparte el global ya cargado
    const otroTenant = randomUUID();

    const v = await valorVigente(db, valoresIndice, { tenantId: otroTenant, indice: "CER", periodo });
    expect(v).toMatchObject({ valor: "700.00000000", tenantId: null });
  });

  it("sin tenantId: busca DIRECTO el global, ignora cualquier override que exista", async () => {
    const v = await valorVigente(db, valoresIndice, { indice: "CER", periodo: "2026-04" });
    expect(v).toMatchObject({ valor: "700.00000000", tenantId: null });
  });

  it("nada publicado para ese (indice, periodo): null", async () => {
    const v = await valorVigente(db, valoresIndice, { tenantId: randomUUID(), indice: "UVA", periodo: "2099-01" });
    expect(v).toBeNull();
  });
});

describe("tablaCotizaciones: índices únicos parciales (Postgres)", () => {
  it("dos filas globales del mismo (fecha, fuente) chocan; un override de tenant coexiste", async () => {
    const fecha = "2026-09-28";

    await expect(
      db.insert(cotizaciones).values({ tenantId: null, fecha, fuente: "oficial", compra: "1500.000000", venta: "1550.000000" }),
    ).resolves.toBeDefined();

    await expect(
      db.insert(cotizaciones).values({ tenantId: null, fecha, fuente: "oficial", compra: "1500.000000", venta: "1551.000000" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const tenantId = randomUUID();
    await expect(
      db.insert(cotizaciones).values({ tenantId, fecha, fuente: "oficial", compra: "1499.000000", venta: "1549.000000" }),
    ).resolves.toBeDefined();
  });
});
