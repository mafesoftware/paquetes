import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: prueba que la FK compuesta que
 * arma `fkTenant` (subpath `/drizzle`) hace que la BASE, no solo el
 * código de la app, rechace una fila hija que apunta al padre de otra
 * organización (spec 06 §3.1, regla 2; restricciones.md reglas 2-4 y 7).
 *
 * No hay mock que valga acá: lo que se prueba es un comportamiento de
 * Postgres (`foreign_key_violation`, código `23503`), y un test contra un
 * cliente simulado no lo detectaría si `fkTenant` armara mal las columnas.
 *
 * `DATABASE_URL_TEST` (default: el `docker-compose.yml` de la raíz del
 * monorepo, servicio `db_test`, puerto 5475). Si Postgres no está
 * levantado, este archivo FALLA con un mensaje claro — nunca se salta en
 * silencio (ver `beforeAll` abajo).
 */
const DATABASE_URL_TEST =
  process.env.DATABASE_URL_TEST ?? "postgres://postgres:postgres@localhost:5475/paquetes_test";

const NOMBRE_ESQUEMA = `tenant_test_${randomUUID().replace(/-/g, "_")}`;

let pool: Pool;
let conectado = false;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL_TEST, connectionTimeoutMillis: 3000 });
  try {
    await pool.query("select 1");
    conectado = true;
  } catch (error) {
    await pool.end().catch(() => {});
    throw new Error(
      `No se pudo conectar a Postgres de test en ${DATABASE_URL_TEST}. ` +
        `Correr "docker compose up -d db_test" desde la raíz del monorepo antes de testear ` +
        `(o setear DATABASE_URL_TEST si Postgres corre en otro lado). Causa original: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  for (const sentencia of ddlDeEsquemaDePrueba(NOMBRE_ESQUEMA)) {
    await pool.query(sentencia);
  }
});

afterAll(async () => {
  // Si la conexión falló arriba, el pool ya se cerró en el catch: no hay
  // nada que limpiar, y reusarlo acá solo taparía el error real de conexión
  // con un segundo error ("Cannot use a pool after calling end").
  if (!conectado) return;
  await pool.query(`drop schema if exists "${NOMBRE_ESQUEMA}" cascade`);
  await pool.end();
});

const e = `"${NOMBRE_ESQUEMA}"`;

async function insertarProyecto(id: string, organizacionId: string, nombre: string): Promise<void> {
  await pool.query(
    `insert into ${e}."proyectos" (id, organizacion_id, nombre) values ($1, $2, $3)`,
    [id, organizacionId, nombre],
  );
}

async function insertarUnidad(id: string, organizacionId: string, proyectoId: string, nombre: string): Promise<void> {
  await pool.query(
    `insert into ${e}."unidades" (id, organizacion_id, proyecto_id, nombre) values ($1, $2, $3, $4)`,
    [id, organizacionId, proyectoId, nombre],
  );
}

describe("FK compuesta (organizacion_id, id) — aislamiento entre organizaciones (Postgres real)", () => {
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const PROYECTO_A = randomUUID();
  const PROYECTO_B = randomUUID();

  it("siembra un proyecto por organización", async () => {
    await insertarProyecto(PROYECTO_A, ORG_A, "Torres del Parque (org A)");
    await insertarProyecto(PROYECTO_B, ORG_B, "Barrio Cerrado (org B)");
  });

  it("una unidad de la organización B que apunta al proyecto de la organización A es rechazada por la FK", async () => {
    await expect(insertarUnidad(randomUUID(), ORG_B, PROYECTO_A, "UF 1")).rejects.toMatchObject({
      code: "23503", // foreign_key_violation
    });
  });

  it("una unidad de la organización A que apunta a SU proyecto se guarda sin problema", async () => {
    await expect(insertarUnidad(randomUUID(), ORG_A, PROYECTO_A, "UF 1")).resolves.toBeUndefined();
  });

  it("una unidad de la organización B que apunta a SU proyecto se guarda sin problema", async () => {
    await expect(insertarUnidad(randomUUID(), ORG_B, PROYECTO_B, "UF 1")).resolves.toBeUndefined();
  });

  it("una unidad que apunta a un proyecto inexistente también es rechazada por la FK (no solo el cruce de organización)", async () => {
    await expect(insertarUnidad(randomUUID(), ORG_A, randomUUID(), "UF fantasma")).rejects.toMatchObject({
      code: "23503",
    });
  });
});
