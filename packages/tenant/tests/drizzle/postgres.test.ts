import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
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
 * El DDL que se ejecuta sale del esquema de Drizzle real (`esquema.ts`,
 * generado con `drizzle-kit/api`), no de SQL escrito a mano — así este test
 * ejercita de verdad lo que `fkTenant` produce.
 *
 * La conexión (`DATABASE_URL_TEST`, default: el `docker-compose.yml` de la
 * raíz del monorepo, servicio `db_test`, puerto 5475) la arma
 * `poolDePrueba()`, compartido con `packages/numeradores` — ver
 * `tests/lib/postgres-de-prueba.ts` en la raíz para por qué ese helper vive
 * ahí y no en un paquete. Si Postgres no está levantado, `poolDePrueba()`
 * TIRA con un mensaje claro — nunca se salta en silencio (ver `beforeAll`
 * abajo).
 */
const NOMBRE_ESQUEMA = `tenant_test_${randomUUID().replace(/-/g, "_")}`;
const e = `"${NOMBRE_ESQUEMA}"`;

let pool: Pool;
let conectado = false;

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PROYECTO_A = randomUUID();
const PROYECTO_B = randomUUID();

async function insertarProyecto(id: string, organizacionId: string, nombre: string): Promise<void> {
  await pool.query(`insert into ${e}."proyectos" (id, organizacion_id, nombre) values ($1, $2, $3)`, [
    id,
    organizacionId,
    nombre,
  ]);
}

async function insertarUnidad(id: string, organizacionId: string, proyectoId: string, nombre: string): Promise<void> {
  await pool.query(`insert into ${e}."unidades" (id, organizacion_id, proyecto_id, nombre) values ($1, $2, $3, $4)`, [
    id,
    organizacionId,
    proyectoId,
    nombre,
  ]);
}

beforeAll(async () => {
  // poolDePrueba() (tests/lib/postgres-de-prueba.ts, raíz) arma el Pool
  // contra DATABASE_URL_TEST y tira con mensaje claro (URL sin password,
  // instrucción de "docker compose up -d db_test", causa original) si no
  // hay conexión — nunca se saltea en silencio.
  pool = await poolDePrueba();
  conectado = true;

  for (const sentencia of await ddlDeEsquemaDePrueba(NOMBRE_ESQUEMA)) {
    await pool.query(sentencia);
  }

  // Sembrado acá, no en un `it` separado: los tests de abajo no pueden
  // depender de que vitest los corra en orden de aparición (no lo garantiza
  // entre archivos, y hace más frágil el archivo si mañana se reordenan o
  // se corren con --sequence.shuffle).
  await insertarProyecto(PROYECTO_A, ORG_A, "Torres del Parque (org A)");
  await insertarProyecto(PROYECTO_B, ORG_B, "Barrio Cerrado (org B)");
});

afterAll(async () => {
  // Si la conexión falló arriba, poolDePrueba() ya cerró el pool antes de
  // tirar: no hay nada que limpiar, y reusarlo acá solo taparía el error
  // real de conexión con uno nuevo ("Cannot use a pool after calling end").
  if (!conectado) return;
  await pool.query(`drop schema if exists "${NOMBRE_ESQUEMA}" cascade`);
  await pool.end();
});

describe("FK compuesta (organizacion_id, id) — aislamiento entre organizaciones (Postgres real)", () => {
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
