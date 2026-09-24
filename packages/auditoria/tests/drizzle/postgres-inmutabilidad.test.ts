import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { sqlInmutabilidad } from "../../src/drizzle/inmutabilidad.js";
import { ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: prueba que `sqlInmutabilidad`
 * de verdad bloquea `UPDATE`/`DELETE`/`TRUNCATE` sobre la tabla que arma
 * `tablaAuditoria` — no hay mock que valga para un trigger de Postgres, es
 * la base la que tiene que rechazar la sentencia, no el código de la app.
 *
 * Archivo separado de `postgres.test.ts` (mismo glob `postgres*.test.ts`,
 * que `bun run test:sin-db` excluye entero) para no mezclar "¿la tabla
 * rechaza escrituras?" con "¿auditar/listarAuditoria funcionan bien?" en un
 * solo `describe` gigante.
 */
const NOMBRE_TABLA = `au_inmut_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const MENSAJE_ESPERADO = `La tabla "${NOMBRE_TABLA}" es de solo lectura`;

let pool: Pool;
let conectado = false;
let filaId: string;

beforeAll(async () => {
  pool = await poolDePrueba();
  conectado = true;

  for (const sentencia of await ddlDeEsquemaDePrueba(NOMBRE_TABLA)) {
    await pool.query(sentencia);
  }
  // La migración a mano, DESPUÉS de la generada por drizzle-kit — el flujo
  // que documenta `sqlInmutabilidad`.
  await pool.query(sqlInmutabilidad(NOMBRE_TABLA));

  const { rows } = await pool.query<{ id: string }>(
    `insert into "${NOMBRE_TABLA}" (organizacion_id, entidad, entidad_id, accion, actor_tipo, cambios)
     values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [randomUUID(), "producto", randomUUID(), "crear", "usuario", "[]"],
  );
  filaId = rows[0]!.id;
});

afterAll(async () => {
  // Si la conexión falló arriba, poolDePrueba() ya cerró el pool antes de
  // tirar: no hay nada que limpiar.
  if (!conectado) return;
  await pool.query(`drop table if exists "${NOMBRE_TABLA}" cascade`).catch(() => {});
  await pool.end();
});

describe("sqlInmutabilidad: la tabla rechaza UPDATE/DELETE/TRUNCATE (Postgres real)", () => {
  it("UPDATE falla con el mensaje del trigger", async () => {
    await expect(pool.query(`update "${NOMBRE_TABLA}" set accion = 'modificado' where id = $1`, [filaId])).rejects.toMatchObject(
      { message: expect.stringContaining(MENSAJE_ESPERADO) },
    );
  });

  it("DELETE falla con el mensaje del trigger", async () => {
    await expect(pool.query(`delete from "${NOMBRE_TABLA}" where id = $1`, [filaId])).rejects.toMatchObject({
      message: expect.stringContaining(MENSAJE_ESPERADO),
    });
  });

  it("TRUNCATE falla con el mensaje del trigger", async () => {
    await expect(pool.query(`truncate "${NOMBRE_TABLA}"`)).rejects.toMatchObject({
      message: expect.stringContaining(MENSAJE_ESPERADO),
    });
  });

  it("la fila sigue ahí, sin tocar, después de los tres intentos fallidos", async () => {
    const { rows } = await pool.query(`select accion from "${NOMBRE_TABLA}" where id = $1`, [filaId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accion).toBe("crear"); // no "modificado": el UPDATE nunca pasó
  });

  it("es idempotente: correr sqlInmutabilidad(...) de nuevo contra la misma tabla no tira, y el bloqueo sigue activo", async () => {
    await expect(pool.query(sqlInmutabilidad(NOMBRE_TABLA))).resolves.toBeDefined();
    await expect(pool.query(`update "${NOMBRE_TABLA}" set accion = 'x' where id = $1`, [filaId])).rejects.toMatchObject({
      message: expect.stringContaining(MENSAJE_ESPERADO),
    });
  });

  it("un INSERT normal sigue funcionando (el trigger solo bloquea UPDATE/DELETE/TRUNCATE)", async () => {
    await expect(
      pool.query(
        `insert into "${NOMBRE_TABLA}" (organizacion_id, entidad, entidad_id, accion, actor_tipo, cambios) values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), "producto", randomUUID(), "crear", "usuario", "[]"],
      ),
    ).resolves.toBeDefined();
  });
});
