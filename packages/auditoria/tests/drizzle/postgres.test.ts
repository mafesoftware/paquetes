import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE_URL_TEST, poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { auditar } from "../../src/drizzle/auditar.js";
import { listarAuditoria } from "../../src/drizzle/listar.js";
import { sqlInmutabilidad } from "../../src/drizzle/inmutabilidad.js";
import { crearEsquemaDePrueba, ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: `auditar`/`listarAuditoria` contra
 * la tabla que arma `tablaAuditoria`, con el trigger de `sqlInmutabilidad`
 * aplicado igual que lo haría una app real (una migración a mano después de
 * la generada por drizzle-kit) — no hay mock que valga para el
 * comportamiento de un `SAVEPOINT` bajo una transacción abortada, ni para
 * que la redacción llegue de verdad tapada al `jsonb` guardado.
 *
 * La conexión (`DATABASE_URL_TEST`, default: el `docker-compose.yml` de la
 * raíz, servicio `db_test`, puerto 5475) la arma `poolDePrueba()`, el mismo
 * helper que usan `packages/tenant` y `packages/numeradores`. Si Postgres no
 * está levantado, TIRA con un mensaje claro — nunca se salta en silencio.
 *
 * Los tests que verifican que la tabla RECHAZA `UPDATE`/`DELETE`/`TRUNCATE`
 * viven en `postgres-inmutabilidad.test.ts`, en esta misma carpeta (ambos
 * matchean el glob `tests/drizzle/postgres*.test.ts` que excluye `bun run
 * test:sin-db`).
 */
const NOMBRE_TABLA = `au_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

let poolChequeo: Pool;
let poolGrande: PgPool;
let db: NodePgDatabase;
let conectado = false;

const { auditoria } = crearEsquemaDePrueba(NOMBRE_TABLA);

beforeAll(async () => {
  poolChequeo = await poolDePrueba();
  conectado = true;

  for (const sentencia of await ddlDeEsquemaDePrueba(NOMBRE_TABLA)) {
    await poolChequeo.query(sentencia);
  }
  // Migración a mano, DESPUÉS de la generada por drizzle-kit — el flujo que
  // documenta `sqlInmutabilidad`. `auditar` solo hace INSERT, así que el
  // trigger (que bloquea UPDATE/DELETE/TRUNCATE) no le molesta.
  await poolChequeo.query(sqlInmutabilidad(NOMBRE_TABLA));
  // Para forzar, a propósito, un fallo de INSERT en el test del SAVEPOINT
  // (ver más abajo): un check constraint real de Postgres, no alcanzable
  // desde el tipo de `EntradaAuditoria` (que no impide un string vacío).
  await poolChequeo.query(`alter table "${NOMBRE_TABLA}" add constraint accion_no_vacia check (accion <> '')`);

  poolGrande = new PgPool({ connectionString: DATABASE_URL_TEST, max: 10 });
  db = drizzle(poolGrande);
});

afterAll(async () => {
  // Si la conexión falló arriba, poolDePrueba() ya cerró su pool antes de
  // tirar: no hay nada que limpiar.
  if (!conectado) return;
  // `poolGrande` se crea DESPUÉS del DDL en `beforeAll` — si ese DDL falla a
  // mitad de camino, `conectado` ya es `true` pero `poolGrande` nunca llegó
  // a asignarse. `?.` evita que ese caso tire acá y tape el error real, y
  // que se salte el resto de la limpieza.
  await poolGrande?.end().catch(() => {});
  await poolChequeo.query(`drop table if exists "${NOMBRE_TABLA}" cascade`).catch(() => {});
  await poolChequeo.end();
});

describe("auditar (Postgres real)", () => {
  it("inserta una fila y devuelve { ok: true, id }", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "producto",
      entidadId,
      accion: "crear",
      actor: { tipo: "usuario", id: randomUUID() },
      despues: { nombre: "Silla" },
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería pasar");
    expect(typeof resultado.id).toBe("string");

    const { rows } = await poolChequeo.query(`select * from "${NOMBRE_TABLA}" where id = $1`, [resultado.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entidad).toBe("producto");
    expect(rows[0].accion).toBe("crear");
    // "antes" ausente contra el objeto de "despues" se expande campo a
    // campo (ver loQueCambio): un cambio para "nombre", con "antes" que no
    // aparece en absoluto (serializarParaAuditoria descarta las claves
    // undefined, así que ni siquiera queda como null).
    expect(rows[0].cambios).toEqual([{ campo: "nombre", despues: "Silla" }]);
  });

  it("sin antes ni despues: cambios queda [], antes/despues quedan null", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "sesion",
      entidadId,
      accion: "login",
      actor: { tipo: "usuario" },
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería pasar");

    const { rows } = await poolChequeo.query(`select antes, despues, cambios from "${NOMBRE_TABLA}" where id = $1`, [
      resultado.id,
    ]);
    expect(rows[0].antes).toBeNull();
    expect(rows[0].despues).toBeNull();
    expect(rows[0].cambios).toEqual([]);
  });

  it("dentro de una tx que hace ROLLBACK completo: no queda ninguna fila", async () => {
    const tenantId = randomUUID();
    class RollbackIntencional extends Error {}

    await expect(
      db.transaction(async (tx) => {
        const r = await auditar(tx, auditoria, {
          tenantId,
          entidad: "producto",
          entidadId: randomUUID(),
          accion: "crear",
          actor: { tipo: "usuario" },
        });
        expect(r.ok).toBe(true);
        throw new RollbackIntencional("rollback intencional de test");
      }),
    ).rejects.toBeInstanceOf(RollbackIntencional);

    const { rows } = await poolChequeo.query(
      `select count(*)::int as n from "${NOMBRE_TABLA}" where organizacion_id = $1`,
      [tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  it(
    "dentro de una tx: un fallo forzado del insert de auditoría (check constraint) NO aborta la tx externa — " +
      "sigue viva y commitea el resto de su trabajo (SAVEPOINT)",
    async () => {
      const tenantId = randomUUID();
      const entidadIdValida = randomUUID();

      const resultadoDelSegundo = await db.transaction(async (tx) => {
        // Trabajo de negocio real DENTRO de la misma tx: una auditoría
        // válida que tiene que sobrevivir aunque la llamada de más abajo
        // falle.
        const primero = await auditar(tx, auditoria, {
          tenantId,
          entidad: "producto",
          entidadId: entidadIdValida,
          accion: "crear",
          actor: { tipo: "usuario" },
        });
        expect(primero.ok).toBe(true);

        // Fuerza un 23514 (check_violation): "accion_no_vacia" no permite
        // accion = "". Sin el SAVEPOINT que arma `auditar`, esto dejaría la
        // tx externa ABORTADA y CUALQUIER sentencia posterior (incluido el
        // COMMIT implícito al salir del callback) fallaría con "current
        // transaction is aborted".
        const segundo = await auditar(tx, auditoria, {
          tenantId,
          entidad: "producto",
          entidadId: randomUUID(),
          accion: "",
          actor: { tipo: "usuario" },
        });

        // auditar NUNCA tira: llegar hasta acá (y poder seguir usando `tx`)
        // ES la prueba de que el SAVEPOINT funcionó.
        return segundo;
      });

      expect(resultadoDelSegundo.ok).toBe(false);
      if (resultadoDelSegundo.ok) throw new Error("no debería pasar");
      expect(resultadoDelSegundo.error).toBeDefined();

      // La tx externa COMMITEÓ: la primera fila (válida) está en la base.
      const { rows } = await poolChequeo.query(
        `select count(*)::int as n from "${NOMBRE_TABLA}" where organizacion_id = $1 and entidad_id = $2`,
        [tenantId, entidadIdValida],
      );
      expect(rows[0].n).toBe(1);

      // Y la segunda (la que forzó el check constraint) NO dejó fila.
      const total = await poolChequeo.query(
        `select count(*)::int as n from "${NOMBRE_TABLA}" where organizacion_id = $1`,
        [tenantId],
      );
      expect(total.rows[0].n).toBe(1);
    },
  );

  it('sin transacción explícita (db directo, no tx): un fallo forzado también da { ok: false }, nunca tira', async () => {
    const tenantId = randomUUID();
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "producto",
      entidadId: randomUUID(),
      accion: "", // check constraint
      actor: { tipo: "sistema" },
    });
    expect(resultado.ok).toBe(false);
  });

  it("la redacción se aplica ANTES de llegar a la base: el jsonb crudo no tiene el valor sensible", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "usuario",
      entidadId,
      accion: "actualizar",
      actor: { tipo: "usuario" },
      antes: { email: "ana@x.com", contrasena: "hunter2" },
      despues: { email: "ana@x.com", contrasena: "hunter3" },
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería pasar");

    const { rows } = await poolChequeo.query(`select antes, despues, cambios from "${NOMBRE_TABLA}" where id = $1`, [
      resultado.id,
    ]);
    const crudo = JSON.stringify(rows[0]);
    expect(crudo).not.toContain("hunter2");
    expect(crudo).not.toContain("hunter3");

    expect(rows[0].antes.contrasena).toBe("[redactado]");
    expect(rows[0].despues.contrasena).toBe("[redactado]");
    expect(rows[0].antes.email).toBe("ana@x.com"); // lo no sensible queda legible

    const cambioContrasena = (rows[0].cambios as { campo: string; antes: unknown; despues: unknown }[]).find(
      (c) => c.campo === "contrasena",
    );
    expect(cambioContrasena?.antes).toBe("[redactado]");
    expect(cambioContrasena?.despues).toBe("[redactado]");
  });

  it("bigint/Date en antes/despues llegan serializados (no tira insertando)", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const vence = new Date("2026-01-01T00:00:00.000Z");
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "factura",
      entidadId,
      accion: "actualizar",
      actor: { tipo: "sistema" },
      antes: { total: 1000n, vence },
      despues: { total: 2000n, vence },
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería pasar");

    const { rows } = await poolChequeo.query(`select antes, despues from "${NOMBRE_TABLA}" where id = $1`, [
      resultado.id,
    ]);
    expect(rows[0].antes.total).toBe("1000n");
    expect(rows[0].despues.total).toBe("2000n");
    expect(rows[0].antes.vence).toBe(vence.toISOString());
  });
});

describe("listarAuditoria (Postgres real)", () => {
  it("nunca devuelve filas de otro tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await auditar(db, auditoria, { tenantId: tenantA, entidad: "x", entidadId: randomUUID(), accion: "crear", actor: { tipo: "sistema" } });
    await auditar(db, auditoria, { tenantId: tenantB, entidad: "x", entidadId: randomUUID(), accion: "crear", actor: { tipo: "sistema" } });

    const { filas, total } = await listarAuditoria(db, auditoria, { tenantId: tenantA });
    expect(total).toBe(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.tenantId).toBe(tenantA);
  });

  it("filtra por entidad, entidadId, actorId y rango de fechas (desde/hasta)", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const actorId = randomUUID();
    await auditar(db, auditoria, { tenantId, entidad: "producto", entidadId, accion: "crear", actor: { tipo: "usuario", id: actorId } });
    await auditar(db, auditoria, { tenantId, entidad: "producto", entidadId: randomUUID(), accion: "crear", actor: { tipo: "usuario", id: randomUUID() } });
    await auditar(db, auditoria, { tenantId, entidad: "caja", entidadId, accion: "abrir", actor: { tipo: "sistema" } });

    const porEntidadYEntidadId = await listarAuditoria(db, auditoria, { tenantId, entidad: "producto", entidadId });
    expect(porEntidadYEntidadId.total).toBe(1);

    const porActor = await listarAuditoria(db, auditoria, { tenantId, actorId });
    expect(porActor.total).toBe(1);
    expect(porActor.filas[0]!.actorId).toBe(actorId);

    const enElFuturo = await listarAuditoria(db, auditoria, { tenantId, desde: new Date(Date.now() + 60_000) });
    expect(enElFuturo.total).toBe(0);

    const desdeElPasado = await listarAuditoria(db, auditoria, { tenantId, desde: new Date(Date.now() - 60_000) });
    expect(desdeElPasado.total).toBe(3);
  });

  it("pagina correctamente y ordena por creado_en desc, id desc (sin repetidos ni faltantes entre páginas)", async () => {
    const tenantId = randomUUID();
    for (let i = 0; i < 5; i++) {
      await auditar(db, auditoria, {
        tenantId,
        entidad: "x",
        entidadId: randomUUID(),
        accion: `accion_${i}`,
        actor: { tipo: "sistema" },
      });
    }

    const pagina1 = await listarAuditoria(db, auditoria, { tenantId, porPagina: 2, pagina: 1 });
    const pagina2 = await listarAuditoria(db, auditoria, { tenantId, porPagina: 2, pagina: 2 });
    const pagina3 = await listarAuditoria(db, auditoria, { tenantId, porPagina: 2, pagina: 3 });

    expect(pagina1.total).toBe(5);
    expect(pagina2.total).toBe(5);
    expect(pagina1.filas).toHaveLength(2);
    expect(pagina2.filas).toHaveLength(2);
    expect(pagina3.filas).toHaveLength(1);

    const ids = [...pagina1.filas, ...pagina2.filas, ...pagina3.filas].map((f) => f.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("porPagina se cap-ea a 200 aunque se pida más", async () => {
    const tenantId = randomUUID();
    await poolChequeo.query(
      `insert into "${NOMBRE_TABLA}" (organizacion_id, entidad, entidad_id, accion, actor_tipo, cambios)
       select $1, 'bulk', gen_random_uuid()::text, 'crear', 'sistema', '[]'::jsonb from generate_series(1, 250)`,
      [tenantId],
    );

    const { filas, total } = await listarAuditoria(db, auditoria, { tenantId, porPagina: 10_000 });
    expect(total).toBe(250);
    expect(filas).toHaveLength(200);
  });

  it("pagina < 1 se trata como 1", async () => {
    const tenantId = randomUUID();
    await auditar(db, auditoria, { tenantId, entidad: "x", entidadId: randomUUID(), accion: "crear", actor: { tipo: "sistema" } });

    const normal = await listarAuditoria(db, auditoria, { tenantId, pagina: 1 });
    const negativa = await listarAuditoria(db, auditoria, { tenantId, pagina: -5 });
    expect(negativa.filas.map((f) => f.id)).toEqual(normal.filas.map((f) => f.id));
  });
});
