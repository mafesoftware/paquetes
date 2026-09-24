import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE_URL_TEST, poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { encolar } from "../../src/drizzle/encolar.js";
import { procesarOutbox } from "../../src/drizzle/procesar.js";
import type { Transporte } from "../../src/transporte.js";
import type { ResultadoTransporte } from "../../src/clasificar-resultado.js";
import { crearEsquemaDePrueba, ddlDeEsquemaDePrueba } from "./esquema.js";

/** El error que usan los tests de este archivo para forzar un rollback intencional (nunca debe confundirse con un fallo real). */
class RollbackIntencional extends Error {}

/**
 * Test de integración con Postgres REAL: prueba las garantías de
 * `encolar`/`procesarOutbox` que ningún mock puede probar — idempotencia
 * real del `ON CONFLICT`, rollback real de la transacción que encola,
 * `FOR UPDATE SKIP LOCKED` bajo concurrencia real (dos `procesarOutbox` a
 * la vez, con conexiones físicas distintas), y el estado que de verdad
 * queda escrito en la fila tras cada desenlace.
 *
 * **Tres tablas separadas** (`encolar`/`procesarOutbox`/concurrencia), no
 * una sola compartida por todo el archivo: a diferencia de
 * `siguienteNumero` (`@mafesoftware/numeradores/drizzle`), `procesarOutbox`
 * NO filtra por tenant al reclamar — reclama cualquier fila DEBIDA de TODA
 * la tabla, a propósito (así lo pide el brief: un cron procesa la cola
 * entera). Compartir una tabla entre tests de `procesarOutbox` haría que
 * una fila `"pendiente"` que dejó un test anterior (con un tenant
 * DISTINTO) apareciera como reclamada en el resumen de otro test, sin
 * relación con lo que ESE test arma — contaminación cruzada real, vista al
 * escribir este archivo. Separar por tabla (no solo por tenant) aísla cada
 * grupo de tests sin cambiar la forma real de `procesarOutbox`.
 *
 * La conexión (`DATABASE_URL_TEST`, default: el `docker-compose.yml` de la
 * raíz, servicio `db_test`, puerto 5475) la arma `poolDePrueba()`, el mismo
 * helper que usan `packages/tenant`/`packages/numeradores`/`packages/auditoria`.
 * Si Postgres no está levantado, TIRA con un mensaje claro — nunca se
 * salta en silencio.
 */
function nombreTabla(sufijo: string): string {
  return `ob_${sufijo}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

const NOMBRE_ENCOLAR = nombreTabla("enc");
const NOMBRE_CONCURRENCIA = nombreTabla("conc");

let poolChequeo: Pool;
let poolGrande: PgPool;
let db: NodePgDatabase;
let conectado = false;

const { outbox: tablaEncolar } = crearEsquemaDePrueba(NOMBRE_ENCOLAR);
const { outbox: tablaConcurrencia } = crearEsquemaDePrueba(NOMBRE_CONCURRENCIA);

/**
 * Cada test de `describe("procesarOutbox (Postgres)")` arma la SUYA propia
 * (`tablaFresca()`) en vez de compartir una — ver el porqué arriba. Las
 * tablas creadas así se registran acá para el DROP final.
 */
const tablasDeProcesar: string[] = [];

async function tablaFresca() {
  const nombre = nombreTabla("proc");
  for (const sentencia of await ddlDeEsquemaDePrueba(nombre)) {
    await poolChequeo.query(sentencia);
  }
  tablasDeProcesar.push(nombre);
  const { outbox } = crearEsquemaDePrueba(nombre);
  return { tabla: outbox, nombre };
}

beforeAll(async () => {
  poolChequeo = await poolDePrueba();
  conectado = true;

  for (const nombre of [NOMBRE_ENCOLAR, NOMBRE_CONCURRENCIA]) {
    for (const sentencia of await ddlDeEsquemaDePrueba(nombre)) {
      await poolChequeo.query(sentencia);
    }
  }

  poolGrande = new PgPool({ connectionString: DATABASE_URL_TEST, max: 10 });
  db = drizzle(poolGrande);
});

afterAll(async () => {
  // Si la conexión falló arriba, poolDePrueba() ya cerró su pool antes de
  // tirar: no hay nada que limpiar.
  if (!conectado) return;
  // `poolGrande` se crea DESPUÉS del DDL — si ese DDL falla a mitad de
  // camino, `conectado` ya es `true` pero `poolGrande` nunca llegó a
  // asignarse. `?.` evita que ese caso tire acá y tape el error real, y
  // que se salte el resto de la limpieza (los DROP TABLE de abajo, que
  // siguen haciendo falta: parte del DDL pudo haber creado alguna tabla
  // antes de romperse).
  await poolGrande?.end().catch(() => {});
  for (const nombre of [NOMBRE_ENCOLAR, NOMBRE_CONCURRENCIA, ...tablasDeProcesar]) {
    await poolChequeo.query(`drop table if exists "${nombre}" cascade`).catch(() => {});
  }
  await poolChequeo.end();
});

/** Trae la fila cruda (columnas reales de la tabla, no camelCase) por id — para inspeccionar exactamente lo que `procesarOutbox`/`encolar` dejaron escrito. */
async function filaPorId(nombreTablaReal: string, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await poolChequeo.query(`select * from "${nombreTablaReal}" where id = $1`, [id]);
  return rows[0];
}

/** Inserta una fila directo por SQL (sin pasar por `encolar`), para armar estados que `encolar` no puede dejar por sí solo (`"procesando"` colgado, `intentos` ya avanzados). Devuelve el `id`. */
async function insertarFilaCruda(
  nombreTablaReal: string,
  opciones: {
    tenantId: string;
    canal: "correo" | "whatsapp";
    destino?: string;
    plantilla?: string;
    claveIdempotencia: string;
    estado?: string;
    intentos?: number;
    maxIntentos?: number;
    programadoPara?: Date;
    proximoIntentoEn?: Date | null;
    bloqueadoHasta?: Date | null;
  },
): Promise<string> {
  const { rows } = await poolChequeo.query<{ id: string }>(
    `insert into "${nombreTablaReal}"
       (organizacion_id, canal, destino, plantilla, datos, clave_idempotencia, estado, intentos, max_intentos, programado_para, proximo_intento_en, bloqueado_hasta)
     values ($1, $2, $3, $4, '{}', $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      opciones.tenantId,
      opciones.canal,
      opciones.destino ?? "destino@ejemplo.com",
      opciones.plantilla ?? "plantilla",
      opciones.claveIdempotencia,
      opciones.estado ?? "pendiente",
      opciones.intentos ?? 0,
      opciones.maxIntentos ?? 5,
      opciones.programadoPara ?? new Date(),
      opciones.proximoIntentoEn ?? null,
      opciones.bloqueadoHasta ?? null,
    ],
  );
  return rows[0]!.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

/** Un `Transporte` fijo: siempre ok, siempre falla igual, o tira. */
function transporteFijo(resultado: ResultadoTransporte | "tira"): Transporte {
  return async () => {
    if (resultado === "tira") throw new Error("fallo simulado del transporte (nunca debería verse este mensaje en un log)");
    return resultado;
  };
}

describe("encolar (Postgres)", () => {
  it("misma claveIdempotencia dos veces -> una sola fila, la segunda da nuevo: false con el MISMO id", async () => {
    const tenantId = randomUUID();
    const clave = `bienvenida-${randomUUID()}`;

    const primero = await db.transaction((tx) => encolar(tx, tablaEncolar, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "bienvenida", claveIdempotencia: clave }));
    const segundo = await db.transaction((tx) => encolar(tx, tablaEncolar, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "bienvenida", claveIdempotencia: clave }));

    expect(primero.nuevo).toBe(true);
    expect(segundo.nuevo).toBe(false);
    expect(segundo.id).toBe(primero.id);

    const { rows } = await poolChequeo.query(`select count(*)::int as n from "${NOMBRE_ENCOLAR}" where clave_idempotencia = $1`, [clave]);
    expect(rows[0].n).toBe(1);
  });

  it("la segunda llamada con la misma clave NO toca la fila existente (mismo estado/intentos de antes)", async () => {
    const tenantId = randomUUID();
    const clave = `no-pisa-${randomUUID()}`;
    const { id } = await db.transaction((tx) => encolar(tx, tablaEncolar, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: clave }));

    // Simula que ya se procesó (sin pasar por procesarOutbox, para no mezclar variables).
    await poolChequeo.query(`update "${NOMBRE_ENCOLAR}" set estado = 'enviado', intentos = 3 where id = $1`, [id]);

    await db.transaction((tx) => encolar(tx, tablaEncolar, { tenantId, canal: "correo", destino: "otro@b.com", plantilla: "otra", claveIdempotencia: clave }));

    const fila = await filaPorId(NOMBRE_ENCOLAR, id);
    expect(fila?.estado).toBe("enviado");
    expect(fila?.intentos).toBe(3);
    expect(fila?.destino).toBe("a@b.com"); // no se pisó con "otro@b.com"
  });

  it('sin transacción (db plano, no una "tx" de db.transaction) tira ErrorOutbox("requiere_transaccion")', async () => {
    const clave = `sin-tx-${randomUUID()}`;
    await expect(
      encolar(db, tablaEncolar, { tenantId: randomUUID(), canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: clave }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "requiere_transaccion" });

    // Y no quedó nada encolado con esa clave.
    const { rows } = await poolChequeo.query(`select count(*)::int as n from "${NOMBRE_ENCOLAR}" where clave_idempotencia = $1`, [clave]);
    expect(rows[0].n).toBe(0);
  });

  it("un rollback de la transacción que encola no deja nada en la cola", async () => {
    const clave = `rollback-${randomUUID()}`;
    const tenantId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await encolar(tx, tablaEncolar, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: clave });
        throw new RollbackIntencional("el hecho de negocio que disparaba este aviso falló después de encolar");
      }),
    ).rejects.toThrow(RollbackIntencional);

    const { rows } = await poolChequeo.query(`select count(*)::int as n from "${NOMBRE_ENCOLAR}" where clave_idempotencia = $1`, [clave]);
    expect(rows[0].n).toBe(0);
  });

  it("programadoPara futuro queda guardado tal cual, y datos default a {} si no se pasa", async () => {
    const tenantId = randomUUID();
    const enUnaHora = new Date(Date.now() + 3_600_000);
    const { id } = await db.transaction((tx) =>
      encolar(tx, tablaEncolar, { tenantId, canal: "whatsapp", destino: "5491100000000", plantilla: "recordatorio", claveIdempotencia: randomUUID(), programadoPara: enUnaHora }),
    );

    const fila = await filaPorId(NOMBRE_ENCOLAR, id);
    expect(new Date(fila!.programado_para as string).getTime()).toBe(enUnaHora.getTime());
    expect(fila!.datos).toEqual({});
    expect(fila!.estado).toBe("pendiente");
    expect(fila!.intentos).toBe(0);
    expect(fila!.max_intentos).toBe(5);
  });
});

describe("procesarOutbox (Postgres)", () => {
  it("un mensaje pendiente debido se envía: estado enviado, id_externo guardado, bloqueado_hasta vuelve a null", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID() }));

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "resend_abc" }) } });

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("enviado");
    expect(fila?.id_externo).toBe("resend_abc");
    expect(fila?.bloqueado_hasta).toBeNull();
    expect(fila?.intentos).toBe(1);
    expect(fila?.enviado_en).not.toBeNull();
  });

  it("un envío ok SIN idExterno (opcional en ResultadoTransporte) deja id_externo en null, no la cadena \"undefined\"", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID() }));

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true }) } });

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("enviado");
    expect(fila?.id_externo).toBeNull();
  });

  it("programado_para en el futuro: no se reclama ni se envía", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const enUnaHora = new Date(Date.now() + 3_600_000);
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), programadoPara: enUnaHora }),
    );

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) } });

    expect(resumen.reclamados).toBe(0);
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("pendiente");
    expect(fila?.intentos).toBe(0);
  });

  it('fallo transitorio ("red"): vuelve a "pendiente" con proximo_intento_en agendado con backoff, intentos + 1', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5 }),
    );
    // Capturado DESPUÉS de encolar: el "ahora" que procesarOutbox compara
    // contra programado_para tiene que ser >= el momento en que la fila se
    // encoló (ver el comentario en encolar.ts sobre por qué programado_para
    // se calcula con el reloj de JS, no `now()` de Postgres).
    const antes = new Date();

    const resumen = await procesarOutbox({
      db,
      tabla,
      transportes: { correo: transporteFijo({ ok: false, categoria: "red", codigo: "ECONNRESET" }) },
      ahora: () => antes,
    });

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("pendiente");
    expect(fila?.intentos).toBe(1);
    expect(fila?.ultimo_error_categoria).toBe("red");
    expect(fila?.ultimo_error_codigo).toBe("ECONNRESET");
    expect(fila?.bloqueado_hasta).toBeNull();
    // proximo_intento_en > antes (backoff(0) con jitter, base 30s +-20%: entre 24s y 36s por defecto)
    const proximoIntentoEnMs = new Date(fila!.proximo_intento_en as string).getTime();
    expect(proximoIntentoEnMs).toBeGreaterThan(antes.getTime());
    expect(proximoIntentoEnMs - antes.getTime()).toBeGreaterThanOrEqual(20_000);
    expect(proximoIntentoEnMs - antes.getTime()).toBeLessThanOrEqual(40_000);
  });

  it("tras agotar maxIntentos con fallos transitorios sucesivos -> fallido, sin más reintentos", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 2 }),
    );
    // Arranca en el momento real de encolar (no una fecha fija arbitraria:
    // tiene que ser >= programado_para, que se fija con el reloj real de JS
    // al encolar) y de ahí en más avanza en el tiempo a mano. La tabla es
    // EXCLUSIVA de este test (tablaFresca()), así que adelantar "ahora" acá
    // no puede arrastrar filas de ningún otro test.
    let momento = new Date();

    // Intento 1 de 2: falla transitorio -> "pendiente", agenda proximo_intento_en.
    const r1 = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: false, categoria: "limite" }) }, ahora: () => momento });
    expect(r1).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0 });
    expect((await filaPorId(nombre, id))?.estado).toBe("pendiente");

    // Avanza el reloj bien después de proximo_intento_en (backoff nunca pasa 1h+20%).
    momento = new Date(momento.getTime() + 2 * 3_600_000);

    // Intento 2 de 2: vuelve a fallar transitorio, ya sin intentos -> "fallido".
    const r2 = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: false, categoria: "limite" }) }, ahora: () => momento });
    expect(r2).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 1, descartados: 0 });

    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("fallido");
    expect(fila?.intentos).toBe(2);

    // Una corrida más (reloj bien adelantado) no vuelve a tocar la fila: "fallido" es terminal.
    momento = new Date(momento.getTime() + 2 * 3_600_000);
    const r3 = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "no-deberia-usarse" }) }, ahora: () => momento });
    expect(r3.reclamados).toBe(0);
    expect((await filaPorId(nombre, id))?.estado).toBe("fallido");
  });

  it.each([
    ["credenciales", "credenciales"],
    ["rechazado", "rechazado"],
    ["facturacion", "facturacion"],
    ["ventana", "ventana"],
  ])('fallo permanente (categoria "%s") -> descartado en el PRIMER intento, sin gastar reintentos disponibles', async (categoria) => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "whatsapp", destino: "5491100000000", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5 }),
    );

    const resumen = await procesarOutbox({ db, tabla, transportes: { whatsapp: transporteFijo({ ok: false, categoria, codigo: "detalle" }) } });

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 1 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("descartado");
    expect(fila?.ultimo_error_categoria).toBe(categoria);
    expect(fila?.ultimo_error_codigo).toBe("detalle");
    expect(fila?.intentos).toBe(1); // solo el intento que descartó, no se "gastaron" los otros 4 disponibles
    expect(fila?.proximo_intento_en).toBeNull();
  });

  it('un "procesando" colgado con el lease vencido se reclama de nuevo (destrabar) y, si el envío sale bien, queda "enviado"', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const id = await insertarFilaCruda(nombre, {
      tenantId,
      canal: "correo",
      claveIdempotencia: randomUUID(),
      estado: "procesando",
      intentos: 1,
      maxIntentos: 5,
      bloqueadoHasta: new Date(Date.now() - 60_000), // venció hace 1 minuto
    });

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "recuperado" }) } });

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("enviado");
    expect(fila?.intentos).toBe(2); // el intento original + este reclamo
    expect(fila?.id_externo).toBe("recuperado");
  });

  it('un "procesando" con el lease TODAVÍA vigente NO se reclama (otro worker lo tiene)', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const id = await insertarFilaCruda(nombre, {
      tenantId,
      canal: "correo",
      claveIdempotencia: randomUUID(),
      estado: "procesando",
      intentos: 1,
      bloqueadoHasta: new Date(Date.now() + 5 * 60_000), // vence en 5 minutos
    });

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) } });

    expect(resumen.reclamados).toBe(0);
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("procesando");
    expect(fila?.intentos).toBe(1);
  });

  it("un Transporte que TIRA se trata como transitorio (reintenta, no descarta)", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5 }),
    );

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo("tira") } });

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("pendiente");
    expect(fila?.ultimo_error_categoria).toBe("red");
    expect(fila?.proximo_intento_en).not.toBeNull();
    // Nunca se filtró el mensaje del error crudo.
    expect(JSON.stringify(fila)).not.toContain("fallo simulado del transporte");
  });

  it("un canal sin Transporte configurado descarta el mensaje como credenciales (transporte_no_configurado)", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "whatsapp", destino: "5491100000000", plantilla: "p", claveIdempotencia: randomUUID() }),
    );

    const resumen = await procesarOutbox({ db, tabla, transportes: {} }); // sin "whatsapp"

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 1 });
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("descartado");
    expect(fila?.ultimo_error_categoria).toBe("credenciales");
    expect(fila?.ultimo_error_codigo).toBe("transporte_no_configurado");
  });

  it("respeta lote: con más mensajes debidos que lote, reclama solo hasta lote por corrida", async () => {
    const { tabla } = await tablaFresca();
    const tenantId = randomUUID();
    for (let i = 0; i < 5; i++) {
      await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: `d${i}@b.com`, plantilla: "p", claveIdempotencia: randomUUID() }));
    }

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) }, lote: 2 });
    expect(resumen.reclamados).toBe(2);
    expect(resumen.enviados).toBe(2);
  });
});

describe("procesarOutbox: concurrencia real, dos corridas a la vez (Postgres)", () => {
  it(
    "dos procesarOutbox concurrentes sobre la MISMA cola nunca mandan el mismo mensaje dos veces, y de verdad se solapan en el tiempo (no una corre atrás de la otra)",
    async () => {
      const tenantId = randomUUID();
      const CANTIDAD = 12;
      const DEMORA_MS = 120;

      const ids: string[] = [];
      for (let i = 0; i < CANTIDAD; i++) {
        const { id } = await db.transaction((tx) =>
          encolar(tx, tablaConcurrencia, { tenantId, canal: "correo", destino: `c${i}@b.com`, plantilla: "p", claveIdempotencia: randomUUID() }),
        );
        ids.push(id);
      }

      // Cada worker (A/B) registra, para cada mensaje que procesa, su ventana
      // [inicio, fin] real (con una demora artificial adentro) — la prueba de
      // solapamiento mira estas ventanas, no solo el resultado final.
      const eventos: { worker: "A" | "B"; id: string; inicio: number; fin: number }[] = [];
      const procesadosPor = new Map<string, ("A" | "B")[]>();

      function transporteLento(worker: "A" | "B"): Transporte {
        return async (mensaje) => {
          const inicio = Date.now();
          await sleep(DEMORA_MS);
          const fin = Date.now();
          eventos.push({ worker, id: mensaje.id, inicio, fin });
          procesadosPor.set(mensaje.id, [...(procesadosPor.get(mensaje.id) ?? []), worker]);
          return { ok: true, idExterno: `${worker}-${mensaje.id}` };
        };
      }

      // `lote: CANTIDAD / 2` para las DOS, no `lote: CANTIDAD`: con 12 filas
      // debidas y un tope de 6 por corrida, es IMPOSIBLE que una sola
      // corrida se lleve las 12 (como sí podría pasar con `lote: CANTIDAD`,
      // si por timing una terminaba de reclamar y confirmar ANTES de que la
      // otra llegara a intentarlo) — cada una se queda como máximo con la
      // mitad, así que las DOS necesariamente reclaman filas, sea cual sea
      // el orden real de ejecución. Esto no cambia lo que se prueba (que
      // ninguna fila se manda dos veces) pero hace que la prueba de
      // SOLAPAMIENTO de más abajo tenga, de las dos corridas, eventos reales
      // para comparar entre sí.
      const inicioTotal = Date.now();
      const [resumenA, resumenB] = await Promise.all([
        procesarOutbox({ db, tabla: tablaConcurrencia, transportes: { correo: transporteLento("A") }, lote: CANTIDAD / 2 }),
        procesarOutbox({ db, tabla: tablaConcurrencia, transportes: { correo: transporteLento("B") }, lote: CANTIDAD / 2 }),
      ]);
      const duracionTotalMs = Date.now() - inicioTotal;

      // Invariante DURO, siempre cierto gracias a FOR UPDATE SKIP LOCKED:
      // cada mensaje se procesó exactamente una vez, entre los dos workers,
      // sin faltar ninguno y sin que ninguno se repita.
      expect(resumenA.reclamados + resumenB.reclamados).toBe(CANTIDAD);
      expect(procesadosPor.size).toBe(CANTIDAD);
      for (const workers of procesadosPor.values()) {
        expect(workers).toHaveLength(1); // nunca los dos
      }
      for (const id of ids) {
        const fila = await filaPorId(NOMBRE_CONCURRENCIA, id);
        expect(fila?.estado).toBe("enviado");
      }

      // Prueba de SOLAPAMIENTO real (no solo "los dos terminaron rápido"):
      // si las dos corridas hubieran procesado en serie (una atrás de la
      // otra, en vez de concurrentes), CANTIDAD mensajes con DEMORA_MS cada
      // uno tardarían ~CANTIDAD * DEMORA_MS en total (sin paralelismo
      // adentro de cada corrida tampoco) — muy por encima del umbral de
      // abajo. Que el total dé cerca de UN solo DEMORA_MS confirma que hubo
      // procesamiento en paralelo de verdad.
      expect(duracionTotalMs).toBeLessThan(DEMORA_MS * (CANTIDAD / 2));

      // Y, más directo: al menos dos eventos de WORKERS DISTINTOS con
      // ventanas de tiempo que se solapan — la prueba explícita de que las
      // dos corridas estuvieron "adentro" del transporte lento AL MISMO
      // TIEMPO, no una detrás de la otra.
      const hayEventosSolapados = eventos.some((e1) =>
        eventos.some((e2) => e2.worker !== e1.worker && e2.inicio < e1.fin && e1.inicio < e2.fin),
      );
      expect(hayEventosSolapados).toBe(true);
    },
    30_000,
  );
});
