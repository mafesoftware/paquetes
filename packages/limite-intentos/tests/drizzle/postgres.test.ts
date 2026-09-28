import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE_URL_TEST, poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { claveCuenta, claveIp } from "../../src/claves.js";
import { ErrorLimiteIntentos } from "../../src/errores.js";
import { registrarIntento } from "../../src/drizzle/registrar-intento.js";
import { consultarIntento } from "../../src/drizzle/consultar-intento.js";
import { limpiarIntentos } from "../../src/drizzle/limpiar-intentos.js";
import { tablaIntentos } from "../../src/drizzle/tabla.js";
import { crearEsquemaDePrueba, ddlDeEsquemaDePrueba } from "./esquema.js";

/**
 * Test de integración con Postgres REAL: prueba las garantías de
 * `registrarIntento`/`consultarIntento`/`limpiarIntentos` (tarea P.12) —
 * bloqueo a los 10 fallos, desbloqueo cuando pasa `bloqueoMs`, reinicio de
 * ventana, independencia entre cuenta e IP, y 20 llamadas VERDADERAMENTE
 * concurrentes sobre la misma clave. No hay mock que valga para nada de
 * esto: lo que se prueba es el comportamiento de Postgres bajo carreras
 * reales (bloqueo de fila, `ON CONFLICT DO UPDATE`), no la lógica de la app
 * en el vacío.
 *
 * La conexión (`DATABASE_URL_TEST`, default: el `docker-compose.yml` de la
 * raíz, servicio `db_test`, puerto 5475) la arma `poolDePrueba()`. Si
 * Postgres no está levantado, TIRA con un mensaje claro — nunca se saltea
 * en silencio.
 *
 * Además de esa conexión de chequeo/DDL, este archivo abre un `Pool` propio
 * de al menos 20 conexiones (`POOL_MAXIMO`) para las 20 llamadas
 * concurrentes: cada una toma su PROPIA conexión física del pool (como
 * pasaría con 20 requests HTTP concurrentes en producción, ej. un ataque de
 * fuerza bruta real), no las 20 comparten una sola conexión en serie — que
 * no probaría nada sobre condiciones de carrera reales.
 */
const POOL_MAXIMO = 25;

/** Nombre de tabla corto (no un `pgSchema`, ver `esquema.ts`) para no pasar los 63 caracteres de un identificador de Postgres. */
const NOMBRE_TABLA = `li_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

let poolChequeo: Pool;
let poolGrande: PgPool;
let db: NodePgDatabase;
let conectado = false;

const { limiteIntentos } = crearEsquemaDePrueba(NOMBRE_TABLA);

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
  if (!conectado) return;
  await poolGrande?.end().catch(() => {});
  await poolChequeo.query(`drop table if exists "${NOMBRE_TABLA}" cascade`).catch(() => {});
  await poolChequeo.end();
});

/** Fila cruda de la tabla, leída directo con SQL (sin pasar por consultarIntento) — para verificar el estado persistido sin depender de la propia función que se está probando. */
async function filaCruda(clave: string): Promise<{ contador: number; ventana_desde: Date; bloqueado_hasta: Date | null } | undefined> {
  const { rows } = await poolChequeo.query<{ contador: number; ventana_desde: Date; bloqueado_hasta: Date | null }>(
    `select contador, ventana_desde, bloqueado_hasta from "${NOMBRE_TABLA}" where clave = $1`,
    [clave],
  );
  return rows[0];
}

describe("registrarIntento: bloqueo a los N fallos (Postgres)", () => {
  it('10 fallos con maximo=10 bloquean en el 10mo, con desbloqueaEn = ahora + bloqueoMs (reloj inyectado)', async () => {
    const clave = claveCuenta(`bloqueo-${randomUUID()}@test.com`);
    const maximo = 10;
    const ventanaMs = 15 * 60_000;
    const bloqueoMs = 15 * 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 1; i <= maximo - 1; i++) {
      const resultado = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
      expect(resultado.permitido, `intento ${i}`).toBe(true);
      expect(resultado.restantes, `intento ${i}`).toBe(maximo - i);
      expect(resultado.desbloqueaEn, `intento ${i}`).toBeNull();
    }

    const decimo = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    expect(decimo.permitido).toBe(false);
    expect(decimo.restantes).toBe(0);
    expect(decimo.desbloqueaEn).toEqual(new Date(ahora.getTime() + bloqueoMs));
  });

  it("mientras sigue bloqueada, un intento más EXTIENDE el bloqueo (ataque sostenido)", async () => {
    const clave = claveCuenta(`sostenido-${randomUUID()}@test.com`);
    const maximo = 3;
    const ventanaMs = 60 * 60_000; // ventana larga: sigue vigente durante todo el test
    const bloqueoMs = 5 * 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 0; i < maximo; i++) {
      await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    }
    // Ya bloqueada desde ahora + bloqueoMs. Un fallo más, un rato después
    // (pero todavía dentro del bloqueo y de la ventana):
    const masTarde = new Date(ahora.getTime() + bloqueoMs / 2);
    const resultado = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora: masTarde });
    expect(resultado.permitido).toBe(false);
    // El desbloqueo se recalculó desde ESTE intento, no desde el original.
    expect(resultado.desbloqueaEn).toEqual(new Date(masTarde.getTime() + bloqueoMs));
  });
});

describe("después de que el bloqueo expira, se puede intentar de nuevo (Postgres)", () => {
  it("consultarIntento, con un ahora posterior a desbloqueaEn, informa que ya NO está bloqueada", async () => {
    const clave = claveCuenta(`expira-${randomUUID()}@test.com`);
    const maximo = 5;
    const ventanaMs = 15 * 60_000;
    const bloqueoMs = 15 * 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 0; i < maximo; i++) {
      await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    }
    const bloqueada = await consultarIntento(db, limiteIntentos, { clave, ahora });
    expect(bloqueada.bloqueado).toBe(true);

    const justoDespues = new Date(ahora.getTime() + bloqueoMs + 1);
    const libre = await consultarIntento(db, limiteIntentos, { clave, ahora: justoDespues });
    expect(libre.bloqueado).toBe(false);
    expect(libre.desbloqueaEn).toBeNull();
  });

  it("un registrarIntento nuevo, después de que bloqueo Y ventana ya expiraron, arranca de cero (permitido=true, contador=1)", async () => {
    const clave = claveCuenta(`expira-reset-${randomUUID()}@test.com`);
    const maximo = 5;
    const ventanaMs = 10 * 60_000; // <= bloqueoMs: cuando el bloqueo expira, la ventana también.
    const bloqueoMs = 10 * 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 0; i < maximo; i++) {
      await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    }

    const despuesDeTodo = new Date(ahora.getTime() + bloqueoMs + 1);
    const resultado = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora: despuesDeTodo });
    expect(resultado.permitido).toBe(true);
    expect(resultado.restantes).toBe(maximo - 1);

    const fila = await filaCruda(clave);
    expect(fila?.contador).toBe(1);
  });
});

describe("reinicio de ventana sin llegar al máximo (Postgres)", () => {
  it("un fallo que llega después de ventanaMs, sin haber llegado a maximo, reinicia el contador a 1", async () => {
    const clave = claveCuenta(`ventana-${randomUUID()}@test.com`);
    const maximo = 100; // alto a propósito: nunca se llega a bloquear en este test.
    const ventanaMs = 60_000;
    const bloqueoMs = 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    const primero = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    expect(primero.restantes).toBe(maximo - 1);
    const segundo = await registrarIntento(db, limiteIntentos, {
      clave,
      maximo,
      ventanaMs,
      bloqueoMs,
      ahora: new Date(ahora.getTime() + 1000),
    });
    expect(segundo.restantes).toBe(maximo - 2);

    const despuesDeVentana = new Date(ahora.getTime() + ventanaMs + 1000);
    const tercero = await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora: despuesDeVentana });
    // Reinició: cuenta como si fuera el primer fallo de una ventana nueva.
    expect(tercero.restantes).toBe(maximo - 1);

    const fila = await filaCruda(clave);
    expect(fila?.contador).toBe(1);
    expect(fila?.ventana_desde.getTime()).toBe(despuesDeVentana.getTime());
  });
});

describe("cuenta e IP son independientes (Postgres)", () => {
  it("la misma cadena, como clave de cuenta y de IP, cuenta en filas separadas", async () => {
    const texto = `independiente-${randomUUID()}`;
    const cuenta = claveCuenta(texto);
    const ip = claveIp(texto);
    expect(cuenta).not.toBe(ip);

    const maximo = 5;
    const ventanaMs = 60_000;
    const bloqueoMs = 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    // Tres fallos de cuenta, uno solo de IP.
    await registrarIntento(db, limiteIntentos, { clave: cuenta, maximo, ventanaMs, bloqueoMs, ahora });
    await registrarIntento(db, limiteIntentos, { clave: cuenta, maximo, ventanaMs, bloqueoMs, ahora });
    await registrarIntento(db, limiteIntentos, { clave: cuenta, maximo, ventanaMs, bloqueoMs, ahora });
    await registrarIntento(db, limiteIntentos, { clave: ip, maximo, ventanaMs, bloqueoMs, ahora });

    const filaCuenta = await filaCruda(cuenta);
    const filaIp = await filaCruda(ip);
    expect(filaCuenta?.contador).toBe(3);
    expect(filaIp?.contador).toBe(1);
  });

  it("bloquear la cuenta no bloquea la IP, y viceversa", async () => {
    const texto = `bloqueo-independiente-${randomUUID()}`;
    const cuenta = claveCuenta(texto);
    const ip = claveIp(texto);
    const maximo = 3;
    const ventanaMs = 60_000;
    const bloqueoMs = 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    for (let i = 0; i < maximo; i++) {
      await registrarIntento(db, limiteIntentos, { clave: cuenta, maximo, ventanaMs, bloqueoMs, ahora });
    }
    const estadoCuenta = await consultarIntento(db, limiteIntentos, { clave: cuenta, ahora });
    const estadoIp = await consultarIntento(db, limiteIntentos, { clave: ip, ahora });
    expect(estadoCuenta.bloqueado).toBe(true);
    expect(estadoIp.bloqueado).toBe(false);
  });
});

describe("registrarIntento bajo concurrencia real (Postgres)", () => {
  it(
    "20 llamadas concurrentes (una conexión propia cada una) sobre la MISMA clave: el contador final es exactamente 20, sin perder ninguna por una carrera",
    async () => {
      const clave = claveCuenta(`concurrencia-${randomUUID()}@test.com`);
      const maximo = 1000; // alto a propósito: no se quiere probar el bloqueo acá, solo el conteo.
      const ventanaMs = 60 * 60_000;
      const bloqueoMs = 60_000;
      const ahora = new Date("2026-01-01T00:00:00.000Z");

      await Promise.all(
        Array.from({ length: 20 }, () => registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora })),
      );

      const fila = await filaCruda(clave);
      expect(fila?.contador).toBe(20);
    },
    30_000,
  );

  it(
    "prueba de solapamiento real: con pg_sleep sosteniendo el lock de fila (una transacción por llamada, cada una con su propia conexión del pool de 20+), el tiempo total confirma contención real — no una casualidad sin lock",
    async () => {
      const clave = claveCuenta(`solapamiento-${randomUUID()}@test.com`);
      const maximo = 1000;
      const ventanaMs = 60 * 60_000;
      const bloqueoMs = 60_000;
      const ahora = new Date("2026-01-01T00:00:00.000Z");
      const CANTIDAD = 20;
      const SLEEP_SEGUNDOS = 0.05;

      const inicio = Date.now();
      await Promise.all(
        Array.from({ length: CANTIDAD }, () =>
          db.transaction(async (tx) => {
            const resultado = await registrarIntento(tx, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
            // Sostiene el lock de la fila (tomado por el UPDATE de
            // registrarIntento) durante SLEEP_SEGUNDOS antes de terminar la
            // transacción — si el lock de verdad sirve, las 20
            // transacciones concurrentes NO pueden completar todas juntas.
            await tx.execute(sql`select pg_sleep(${SLEEP_SEGUNDOS})`);
            return resultado;
          }),
        ),
      );
      const duracionMs = Date.now() - inicio;

      const minimoSerializadoMs = CANTIDAD * SLEEP_SEGUNDOS * 1000;
      // No se pide el mínimo exacto (hay jitter real de scheduling/red),
      // pero sí que el orden de magnitud sea el de una ejecución
      // SERIALIZADA por el lock de fila, no el de 20 pg_sleep corriendo
      // todos en paralelo sin esperarse.
      expect(duracionMs).toBeGreaterThanOrEqual(minimoSerializadoMs * 0.6);

      const fila = await filaCruda(clave);
      expect(fila?.contador).toBe(CANTIDAD);
    },
    30_000,
  );
});

describe("limpiarIntentos (Postgres)", () => {
  it("borra la fila: consultarIntento vuelve a informar el estado \"sin fila\"", async () => {
    const clave = claveCuenta(`limpiar-${randomUUID()}@test.com`);
    const maximo = 5;
    const ventanaMs = 60_000;
    const bloqueoMs = 60_000;
    const ahora = new Date("2026-01-01T00:00:00.000Z");

    await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    await registrarIntento(db, limiteIntentos, { clave, maximo, ventanaMs, bloqueoMs, ahora });
    expect((await filaCruda(clave))?.contador).toBe(2);

    await limpiarIntentos(db, limiteIntentos, clave);

    expect(await filaCruda(clave)).toBeUndefined();
    const estado = await consultarIntento(db, limiteIntentos, { clave, ahora });
    expect(estado).toEqual({ contador: 0, ventanaDesde: null, bloqueado: false, desbloqueaEn: null });
  });

  it("limpiar una clave que nunca tuvo fila no tira", async () => {
    const clave = claveCuenta(`nunca-existio-${randomUUID()}@test.com`);
    await expect(limpiarIntentos(db, limiteIntentos, clave)).resolves.toBeUndefined();
  });

  it('clave vacía tira ErrorLimiteIntentos("opciones_invalidas")', async () => {
    await expect(limpiarIntentos(db, limiteIntentos, "")).rejects.toMatchObject({
      name: "ErrorLimiteIntentos",
      codigo: "opciones_invalidas",
    });
  });
});

describe("validaciones de registrarIntento/consultarIntento (Postgres)", () => {
  const opcionesBase = { maximo: 5, ventanaMs: 60_000, bloqueoMs: 60_000 };

  it('clave vacía tira ErrorLimiteIntentos("opciones_invalidas")', async () => {
    await expect(registrarIntento(db, limiteIntentos, { ...opcionesBase, clave: "" })).rejects.toBeInstanceOf(ErrorLimiteIntentos);
    await expect(consultarIntento(db, limiteIntentos, { clave: "" })).rejects.toBeInstanceOf(ErrorLimiteIntentos);
  });

  it.each(["maximo", "ventanaMs", "bloqueoMs"] as const)('%s no entero o <= 0 tira ErrorLimiteIntentos("opciones_invalidas")', async (campo) => {
    const clave = claveCuenta(`invalido-${randomUUID()}@test.com`);
    await expect(registrarIntento(db, limiteIntentos, { ...opcionesBase, clave, [campo]: 0 })).rejects.toMatchObject({
      name: "ErrorLimiteIntentos",
      codigo: "opciones_invalidas",
    });
    await expect(registrarIntento(db, limiteIntentos, { ...opcionesBase, clave, [campo]: 1.5 })).rejects.toBeInstanceOf(ErrorLimiteIntentos);
  });

  it('"ahora" inválido (Invalid Date) tira ErrorLimiteIntentos("opciones_invalidas")', async () => {
    const clave = claveCuenta(`fecha-invalida-${randomUUID()}@test.com`);
    await expect(
      registrarIntento(db, limiteIntentos, { ...opcionesBase, clave, ahora: new Date("no-es-una-fecha") }),
    ).rejects.toBeInstanceOf(ErrorLimiteIntentos);
    await expect(consultarIntento(db, limiteIntentos, { clave, ahora: new Date("no-es-una-fecha") })).rejects.toBeInstanceOf(
      ErrorLimiteIntentos,
    );
  });

  it("maximo=1 bloquea DESDE el primer fallo (fila nueva)", async () => {
    const clave = claveCuenta(`maximo-uno-${randomUUID()}@test.com`);
    const ahora = new Date("2026-01-01T00:00:00.000Z");
    const resultado = await registrarIntento(db, limiteIntentos, { clave, maximo: 1, ventanaMs: 60_000, bloqueoMs: 60_000, ahora });
    expect(resultado.permitido).toBe(false);
    expect(resultado.restantes).toBe(0);
    expect(resultado.desbloqueaEn).toEqual(new Date(ahora.getTime() + 60_000));
  });

  it("consultarIntento sobre una clave sin fila: contador 0, ventanaDesde null, no bloqueado", async () => {
    const clave = claveCuenta(`jamas-registrada-${randomUUID()}@test.com`);
    await expect(consultarIntento(db, limiteIntentos, { clave })).resolves.toEqual({
      contador: 0,
      ventanaDesde: null,
      bloqueado: false,
      desbloqueaEn: null,
    });
  });
});

