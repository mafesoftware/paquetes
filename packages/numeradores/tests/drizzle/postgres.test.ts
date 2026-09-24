import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE_URL_TEST, poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { configurarNumerador } from "../../src/drizzle/configurar-numerador.js";
import { siguienteNumero } from "../../src/drizzle/siguiente-numero.js";
import { crearEsquemaDePrueba, ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: prueba las garantías de
 * concurrencia de `siguienteNumero`/`configurarNumerador` (spec de la
 * tarea P.9) — sin gaps con 100 transacciones concurrentes, sin consumir un
 * número si la transacción hace rollback, ámbitos/tenants independientes,
 * y el error de "requiere transacción". No hay mock que valga para nada de
 * esto: lo que se prueba es el comportamiento de Postgres bajo carreras
 * reales (bloqueo de fila, aislamiento de transacción), no la lógica de la
 * app en el vacío.
 *
 * La conexión (`DATABASE_URL_TEST`, default: el `docker-compose.yml` de la
 * raíz, servicio `db_test`, puerto 5475) la arma `poolDePrueba()`, el mismo
 * helper que usa `packages/tenant` (ver `tests/lib/postgres-de-prueba.ts`
 * en la raíz). Si Postgres no está levantado, TIRA con un mensaje claro —
 * nunca se salta en silencio.
 *
 * Además de esa conexión de chequeo/DDL, este archivo abre un `Pool` propio
 * de al menos 20 conexiones (`POOL_MAXIMO`) para las 100 transacciones
 * concurrentes del primer test: cada una toma su PROPIA conexión física del
 * pool (como pasaría con 100 requests HTTP concurrentes en producción), no
 * las 100 comparten una sola conexión en serie — que no probaría nada sobre
 * condiciones de carrera reales.
 */
const POOL_MAXIMO = 25;

/** Nombre de tabla corto (no un `pgSchema`, ver `esquema.ts`) para que el índice único de `tablaNumeradores` no pase los 63 caracteres de Postgres. */
const NOMBRE_TABLA = `nu_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

let poolChequeo: Pool;
let poolGrande: PgPool;
let db: NodePgDatabase;
let conectado = false;

const { numeradores } = crearEsquemaDePrueba(NOMBRE_TABLA);

beforeAll(async () => {
  poolChequeo = await poolDePrueba();
  conectado = true;

  for (const sentencia of await ddlDeEsquemaDePrueba(NOMBRE_TABLA)) {
    await poolChequeo.query(sentencia);
  }

  poolGrande = new PgPool({ connectionString: DATABASE_URL_TEST, max: POOL_MAXIMO });
  db = drizzle(poolGrande);
});

afterAll(async () => {
  // Si la conexión falló arriba, poolDePrueba() ya cerró su pool antes de
  // tirar: no hay nada que limpiar.
  if (!conectado) return;
  await poolGrande.end();
  await poolChequeo.query(`drop table if exists "${NOMBRE_TABLA}" cascade`);
  await poolChequeo.end();
});

describe("siguienteNumero bajo concurrencia real (Postgres)", () => {
  it(
    "100 transacciones concurrentes (una conexión propia cada una) piden el mismo (tenant, tipo): dan exactamente 1..100, sin huecos ni repetidos",
    async () => {
      const tenantId = randomUUID();
      const resultados = await Promise.all(
        Array.from({ length: 100 }, () =>
          db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" })),
        ),
      );

      const numeros = resultados.map((r) => Number(r.numero)).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));

      // Cada resultado ya viene formateado con el prefijo/relleno por
      // defecto de la fila ("" / 0): el texto es el número tal cual.
      const formateados = new Set(resultados.map((r) => r.formateado));
      expect(formateados.size).toBe(100);
    },
    30_000,
  );

  it(
    "la primera llamada para un (tenant, ambito, tipo) nuevo crea la fila y devuelve 1",
    async () => {
      const tenantId = randomUUID();
      const { numero, formateado } = await db.transaction((tx) =>
        siguienteNumero(tx, numeradores, { tenantId, tipo: "orden_compra" }),
      );
      expect(numero).toBe(1n);
      expect(formateado).toBe("1");
    },
    10_000,
  );

  it(
    "50 transacciones concurrentes, cada 3ra hace rollback: los números COMMITEADOS son contiguos desde 1, sin huecos, y el contador queda en commits + 1",
    async () => {
      class RollbackIntencional extends Error {}
      const tenantId = randomUUID();

      const resultados = await Promise.all(
        Array.from({ length: 50 }, async (_, i) => {
          try {
            const numero = await db.transaction(async (tx) => {
              const r = await siguienteNumero(tx, numeradores, { tenantId, tipo: "orden_pago" });
              // Cada 3ra transacción (índices 2, 5, 8, ... => (i+1) % 3 === 0)
              // hace rollback DESPUÉS de pedir el número, como pasaría si
              // algo más adelante en la misma transacción falla.
              if ((i + 1) % 3 === 0) throw new RollbackIntencional("rollback intencional de test");
              return r.numero;
            });
            return { commiteo: true as const, numero };
          } catch (error) {
            if (error instanceof RollbackIntencional) return { commiteo: false as const };
            throw error;
          }
        }),
      );

      const commiteados = resultados.filter((r): r is { commiteo: true; numero: bigint } => r.commiteo);
      const cantidadRollbacks = resultados.length - commiteados.length;
      expect(cantidadRollbacks).toBe(Math.floor(50 / 3)); // 16 de 50

      const numeros = commiteados.map((r) => Number(r.numero)).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: commiteados.length }, (_, i) => i + 1));

      // El contador quedó en (cantidad de commits) + 1, no en 51: los
      // números que pidieron las transacciones que hicieron rollback NO
      // quedaron "gastados".
      const [fila] = (
        await poolChequeo.query<{ proximo: string }>(
          `select proximo from "${NOMBRE_TABLA}" where organizacion_id = $1 and ambito = '' and tipo = 'orden_pago'`,
          [tenantId],
        )
      ).rows;
      expect(fila).toBeDefined();
      expect(BigInt(fila!.proximo)).toBe(BigInt(commiteados.length) + 1n);
    },
    30_000,
  );

  it("ámbitos independientes: A y B del mismo tenant/tipo arrancan cada uno en 1 y avanzan por separado", async () => {
    const tenantId = randomUUID();
    const a1 = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, ambito: "A", tipo: "recibo" }));
    const b1 = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, ambito: "B", tipo: "recibo" }));
    const a2 = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, ambito: "A", tipo: "recibo" }));

    expect(a1.numero).toBe(1n);
    expect(b1.numero).toBe(1n);
    expect(a2.numero).toBe(2n);
  });

  it("tenants independientes: mismo tipo (sin ámbito), tenants distintos arrancan cada uno en 1", async () => {
    const tenantX = randomUUID();
    const tenantY = randomUUID();
    const x1 = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId: tenantX, tipo: "recibo" }));
    const y1 = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId: tenantY, tipo: "recibo" }));

    expect(x1.numero).toBe(1n);
    expect(y1.numero).toBe(1n);
  });

  it('llamado con "db" plano (sin transacción) tira ErrorNumeradores("requiere_transaccion")', async () => {
    const tenantId = randomUUID();
    await expect(siguienteNumero(db, numeradores, { tenantId, tipo: "recibo" })).rejects.toMatchObject({
      name: "ErrorNumeradores",
      codigo: "requiere_transaccion",
    });
  });

  it("el formateado usa el prefijo/relleno configurados en la fila (no los defaults)", async () => {
    const tenantId = randomUUID();
    await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "R-", relleno: 4 });

    const { numero, formateado } = await db.transaction((tx) =>
      siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
    );
    expect(numero).toBe(1n);
    expect(formateado).toBe("R-0001");
  });
});

describe("configurarNumerador (Postgres)", () => {
  it("crea el numerador con prefijo/relleno/proximo dados", async () => {
    const tenantId = randomUUID();
    await configurarNumerador(db, numeradores, { tenantId, tipo: "orden_pago", prefijo: "OP-", relleno: 6, proximo: 501n });

    const { numero, formateado } = await db.transaction((tx) =>
      siguienteNumero(tx, numeradores, { tenantId, tipo: "orden_pago" }),
    );
    expect(numero).toBe(501n);
    expect(formateado).toBe("OP-000501");
  });

  it("NO permite bajar proximo por debajo del valor actual, y no toca nada si lo intenta", async () => {
    const tenantId = randomUUID();
    await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 10n });

    await expect(configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 5n })).rejects.toMatchObject({
      name: "ErrorNumeradores",
      codigo: "retroceso_no_permitido",
    });

    // Nada cambió: el próximo número sigue siendo 10, no 5.
    const { numero } = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }));
    expect(numero).toBe(10n);
  });

  it("SÍ permite fijar proximo al mismo valor que ya tiene (no es un retroceso)", async () => {
    const tenantId = randomUUID();
    await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 7n });
    await expect(
      configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "X-", proximo: 7n }),
    ).resolves.toBeUndefined();

    const { numero, formateado } = await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }));
    expect(numero).toBe(7n);
    expect(formateado).toBe("X-7");
  });
});
