import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { sql } from "drizzle-orm";
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
// M14: una tabla de "negocio" SEPARADA (no otra fila de auditoría) para
// probar que el SAVEPOINT deja viva la tx externa — insertar acá adentro de
// la misma tx que un `auditar` forzado a fallar, y confirmar que esta fila
// SÍ persiste, es una prueba más convincente que insertar otra fila de
// auditoría (que podría, en teoría, quedar en un estado especial por ser la
// misma tabla con el trigger).
const NOMBRE_TABLA_NEGOCIO = `au_negocio_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

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

  // Tabla de "negocio" de mentira para el test del SAVEPOINT (M14): una
  // tabla real de la app, sin relación con auditoría, sin trigger de
  // inmutabilidad (una app real SÍ puede actualizarla/borrarla).
  await poolChequeo.query(`create table "${NOMBRE_TABLA_NEGOCIO}" (id uuid primary key, nombre text not null)`);

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
  await poolChequeo.query(`drop table if exists "${NOMBRE_TABLA_NEGOCIO}" cascade`).catch(() => {});
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
    "M14: dentro de una tx, un fallo forzado del insert de auditoría (check constraint) NO aborta la tx externa — " +
      "una escritura de NEGOCIO REAL (tabla separada, no otra fila de auditoría) en la MISMA tx SÍ commitea (SAVEPOINT)",
    async () => {
      // M7: silenciar el console.error esperado (el segundo auditar de acá
      // abajo falla a propósito) para no ensuciar la salida de test — se
      // restaura en el finally.
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const tenantId = randomUUID();
        const idNegocio = randomUUID();

        const resultadoDelSegundo = await db.transaction(async (tx) => {
          // Trabajo de NEGOCIO real DENTRO de la misma tx — una tabla propia
          // de la app, sin relación con auditoría — que tiene que sobrevivir
          // aunque la llamada a `auditar` de más abajo falle. Usar una tabla
          // separada (no otra fila de auditoría) es una prueba más
          // convincente: confirma que el SAVEPOINT protege CUALQUIER trabajo
          // previo de la tx, no solo otro insert en la misma tabla con el
          // mismo trigger.
          await tx.execute(
            sql`insert into ${sql.identifier(NOMBRE_TABLA_NEGOCIO)} (id, nombre) values (${idNegocio}, 'trabajo de negocio real')`,
          );

          // Fuerza un 23514 (check_violation): "accion_no_vacia" no permite
          // accion = "". Sin el SAVEPOINT que arma `auditar`, esto dejaría la
          // tx externa ABORTADA y CUALQUIER sentencia posterior (incluido el
          // COMMIT implícito al salir del callback, que se hubiera llevado
          // puesta la fila de negocio de arriba) fallaría con "current
          // transaction is aborted".
          const segundo = await auditar(tx, auditoria, {
            tenantId,
            entidad: "producto",
            entidadId: randomUUID(),
            accion: "",
            actor: { tipo: "usuario" },
          });

          // auditar NUNCA tira: llegar hasta acá (y poder seguir usando `tx`,
          // incluido el COMMIT implícito al volver) ES la prueba de que el
          // SAVEPOINT funcionó.
          return segundo;
        });

        expect(resultadoDelSegundo.ok).toBe(false);
        if (resultadoDelSegundo.ok) throw new Error("no debería pasar");
        expect(resultadoDelSegundo.error).toBeDefined();
        expect(spyError).toHaveBeenCalled();

        // La tx externa COMMITEÓ: la fila de NEGOCIO (tabla separada) está
        // en la base.
        const negocio = await poolChequeo.query(`select nombre from "${NOMBRE_TABLA_NEGOCIO}" where id = $1`, [
          idNegocio,
        ]);
        expect(negocio.rows).toHaveLength(1);
        expect(negocio.rows[0].nombre).toBe("trabajo de negocio real");

        // Y la auditoría que forzó el check constraint NO dejó fila.
        const auditoriaFallida = await poolChequeo.query(
          `select count(*)::int as n from "${NOMBRE_TABLA}" where organizacion_id = $1`,
          [tenantId],
        );
        expect(auditoriaFallida.rows[0].n).toBe(0);
      } finally {
        spyError.mockRestore();
      }
    },
  );

  it('sin transacción explícita (db directo, no tx): un fallo forzado también da { ok: false }, nunca tira', async () => {
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {}); // M7: silenciar
    try {
      const tenantId = randomUUID();
      const resultado = await auditar(db, auditoria, {
        tenantId,
        entidad: "producto",
        entidadId: randomUUID(),
        accion: "", // check constraint
        actor: { tipo: "sistema" },
      });
      expect(resultado.ok).toBe(false);
      expect(spyError).toHaveBeenCalled();
    } finally {
      spyError.mockRestore();
    }
  });

  it("I2: el console.error de un fallo NUNCA incluye el objeto de error completo ni valores de la entrada (secretos/emails) — solo entidad/entidadId/accion y code/message de Postgres", async () => {
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tenantId = randomUUID();
      const entidadId = randomUUID();
      const emailSecreto = "no-deberia-aparecer-en-el-log@ejemplo.com";
      const passwordSecreto = "hunter2-no-deberia-aparecer-en-el-log";

      const resultado = await auditar(db, auditoria, {
        tenantId,
        entidad: "usuario",
        entidadId,
        accion: "", // check constraint: fuerza el fallo
        actor: { tipo: "usuario" },
        antes: { email: emailSecreto, contrasena: passwordSecreto },
        despues: { email: emailSecreto, contrasena: "otro-secreto-tampoco-deberia-aparecer" },
      });
      expect(resultado.ok).toBe(false);

      expect(spyError).toHaveBeenCalledTimes(1);
      const textoLogueado = spyError.mock.calls
        .flat()
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");

      // Nunca el valor sensible (ni siquiera el ya "redactado" — el punto es
      // que el error/params del driver JAMÁS se loguean, con o sin
      // redacción de por medio).
      expect(textoLogueado).not.toContain(emailSecreto);
      expect(textoLogueado).not.toContain(passwordSecreto);
      expect(textoLogueado).not.toContain("otro-secreto-tampoco-deberia-aparecer");
      // Nunca el error completo: ni el SQL armado ni el arreglo de params
      // que trae un DrizzleQueryError como propiedades propias.
      expect(textoLogueado).not.toContain("insert into");
      expect(textoLogueado).not.toContain("params:");

      // SÍ tiene el contexto útil para debuggear (sin datos sensibles).
      expect(textoLogueado).toContain("usuario"); // entidad
      expect(textoLogueado).toContain(entidadId);
      // Algún rastro del motivo real de Postgres (code 23514 o el nombre de
      // la constraint en el message) para que no sea un mensaje ciego.
      expect(textoLogueado.includes("23514") || textoLogueado.toLowerCase().includes("constraint")).toBe(true);
    } finally {
      spyError.mockRestore();
    }
  });

  it("Ronda 3: resultado.error (ok:false) es { codigo, mensaje } SANITIZADO — nunca el error crudo, sin query/params, sin datos de la entrada", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const emailSecreto = "no-deberia-aparecer-en-el-error@ejemplo.com";
    const passwordSecreto = "hunter2-no-deberia-aparecer-en-el-error";

    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "usuario",
      entidadId,
      accion: "", // check constraint: fuerza el fallo
      actor: { tipo: "usuario" },
      antes: { email: emailSecreto, contrasena: passwordSecreto },
      despues: { email: emailSecreto, contrasena: "otro-secreto-que-tampoco-deberia-aparecer" },
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("no debería pasar");

    // Forma exacta: { codigo: string | null, mensaje: string } — nada más.
    expect(Object.keys(resultado.error).sort()).toEqual(["codigo", "mensaje"]);
    expect(typeof resultado.error.mensaje).toBe("string");
    expect(resultado.error.codigo === null || typeof resultado.error.codigo === "string").toBe(true);

    // NUNCA las propiedades propias de un DrizzleQueryError (el SQL armado
    // y los parámetros bindeados).
    expect(resultado.error).not.toHaveProperty("query");
    expect(resultado.error).not.toHaveProperty("params");
    expect(resultado.error).not.toHaveProperty("cause");

    const textoDelError = JSON.stringify(resultado.error);
    expect(textoDelError).not.toContain(emailSecreto);
    expect(textoDelError).not.toContain(passwordSecreto);
    expect(textoDelError).not.toContain("otro-secreto-que-tampoco-deberia-aparecer");
    expect(textoDelError).not.toContain("insert into");
    expect(textoDelError).not.toContain("params:");

    // Sigue siendo útil: el code real de Postgres, o al menos una mención
    // de la restricción, en el mensaje.
    expect(resultado.error.codigo === "23514" || resultado.error.mensaje.toLowerCase().includes("constraint")).toBe(
      true,
    );
  });

  it("I4: pagina/porPagina con NaN o Infinity caen a los defaults en vez de romper la consulta", async () => {
    const tenantId = randomUUID();
    await auditar(db, auditoria, { tenantId, entidad: "x", entidadId: randomUUID(), accion: "crear", actor: { tipo: "sistema" } });

    await expect(listarAuditoria(db, auditoria, { tenantId, pagina: Number.NaN })).resolves.toMatchObject({ total: 1 });
    await expect(listarAuditoria(db, auditoria, { tenantId, porPagina: Number.NaN })).resolves.toMatchObject({ total: 1 });
    await expect(listarAuditoria(db, auditoria, { tenantId, pagina: Number.POSITIVE_INFINITY })).resolves.toMatchObject({
      total: 1,
    });
    await expect(listarAuditoria(db, auditoria, { tenantId, porPagina: Number.POSITIVE_INFINITY })).resolves.toMatchObject({
      total: 1,
    });
    await expect(listarAuditoria(db, auditoria, { tenantId, porPagina: Number.NEGATIVE_INFINITY })).resolves.toMatchObject({
      total: 1,
    });

    // Y da EXACTAMENTE el mismo resultado que no pasar la opción (el default real).
    const conNaN = await listarAuditoria(db, auditoria, { tenantId, pagina: Number.NaN, porPagina: Number.NaN });
    const sinOpciones = await listarAuditoria(db, auditoria, { tenantId });
    expect(conNaN.filas.map((f) => f.id)).toEqual(sinOpciones.filas.map((f) => f.id));
  });

  it("C1 (Postgres real): un secreto ANIDADO bajo una clave ancestro sensible no aparece en el jsonb crudo (antes/despues/cambios) ni siquiera con ::text", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const secretoAntes = "AAA-secreto-anidado-antes";
    const secretoDespues = "BBB-secreto-anidado-despues";

    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "integracion",
      entidadId,
      accion: "rotar_token",
      actor: { tipo: "sistema" },
      antes: { token: { access: secretoAntes }, nombre: "visible" },
      despues: { token: { access: secretoDespues }, nombre: "visible" },
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería pasar");

    // Casteo explícito a ::text de las tres columnas, tal como jsonb las
    // guarda CRUDAS en la base — no vía el parseo automático de "pg" (que
    // ya devuelve un objeto JS), para confirmar que el secreto no está ni
    // siquiera en el texto serializado tal cual vive en el disco.
    const { rows } = await poolChequeo.query<{ antes: string; despues: string; cambios: string }>(
      `select antes::text as antes, despues::text as despues, cambios::text as cambios from "${NOMBRE_TABLA}" where id = $1`,
      [resultado.id],
    );
    const fila = rows[0]!;
    expect(fila.antes).not.toContain(secretoAntes);
    expect(fila.despues).not.toContain(secretoDespues);
    expect(fila.cambios).not.toContain(secretoAntes);
    expect(fila.cambios).not.toContain(secretoDespues);
    // Lo no sensible SÍ queda legible (confirma que la redacción es
    // selectiva, no un borrado de toda la fila).
    expect(fila.antes).toContain("visible");
    // N1: el cambio SÍ queda registrado (con "[redactado]"), no desaparece
    // de "cambios" — confirma que el fix no reintroduce la regresión N1.
    expect(fila.cambios).toContain("token.access");
    expect(fila.cambios).toContain("[redactado]");
  });

  it("la redacción se aplica ANTES de llegar a la base: el jsonb crudo no tiene el valor sensible (ni en antes/despues ni en cambios)", async () => {
    const tenantId = randomUUID();
    const entidadId = randomUUID();
    const resultado = await auditar(db, auditoria, {
      tenantId,
      entidad: "usuario",
      entidadId,
      accion: "actualizar",
      actor: { tipo: "usuario" },
      // "contrasena" CAMBIA (hunter2 -> hunter3) y "email" también CAMBIA
      // (para confirmar que un cambio real en un campo NO sensible sigue
      // apareciendo en "cambios" con total normalidad).
      antes: { email: "ana@x.com", contrasena: "hunter2" },
      despues: { email: "ana2@x.com", contrasena: "hunter3" },
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
    expect(rows[0].despues.email).toBe("ana2@x.com");

    // N1 (fix de la regresión que había introducido la primera ronda de
    // C1): "contrasena" SÍ aparece en "cambios" — queda registrado que el
    // campo CAMBIÓ, con los dos lados tapados. `cambios` se calcula sobre
    // los valores CRUDOS y se redacta DESPUÉS por segmento de ruta, así que
    // un cambio real en un campo sensible no desaparece. "email" (no
    // sensible) aparece con sus valores reales, sin tocar.
    const cambios = rows[0].cambios as { campo: string; antes: unknown; despues: unknown }[];
    const cambioContrasena = cambios.find((c) => c.campo === "contrasena");
    expect(cambioContrasena?.antes).toBe("[redactado]");
    expect(cambioContrasena?.despues).toBe("[redactado]");
    const cambioEmail = cambios.find((c) => c.campo === "email");
    expect(cambioEmail?.antes).toBe("ana@x.com");
    expect(cambioEmail?.despues).toBe("ana2@x.com");
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
