import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE_URL_TEST, poolDePrueba } from "../../../../tests/lib/postgres-de-prueba.js";
import { encolar } from "../../src/drizzle/encolar.js";
import { procesarOutbox } from "../../src/drizzle/procesar.js";
import { purgarOutbox } from "../../src/drizzle/purgar.js";
import { decidir, type Decision } from "../../src/decidir.js";
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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
    expect(r1).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
    expect((await filaPorId(nombre, id))?.estado).toBe("pendiente");

    // Avanza el reloj bien después de proximo_intento_en (backoff nunca pasa 1h+20%).
    momento = new Date(momento.getTime() + 2 * 3_600_000);

    // Intento 2 de 2: vuelve a fallar transitorio, ya sin intentos -> "fallido".
    const r2 = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: false, categoria: "limite" }) }, ahora: () => momento });
    expect(r2).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 1, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });

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

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 1, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 1, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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

    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 1, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
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


describe("procesarOutbox: fencing por lease — C1, reproducción del bug real (Postgres)", () => {
  it(
    'un worker "zombi" (lease vencido, transporte lento) nunca pisa lo que otro worker ya escribió: su intento tardío se cuenta en "perdidos", nunca vuelve la fila a "pendiente"',
    async () => {
      const { tabla, nombre } = await tablaFresca();
      const tenantId = randomUUID();
      const { id } = await db.transaction((tx) =>
        encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID() }),
      );

      let soltarA!: () => void;
      const esperaDeA = new Promise<void>((resolve) => (soltarA = resolve));
      const envios: string[] = [];

      // A reclama la fila y queda "colgado" adentro del Transporte hasta que el test lo suelte.
      const promesaA = procesarOutbox({
        db,
        tabla,
        leaseMs: 5000,
        // Ronda de fix 3c: "timeoutMs" ya NO hace falta explícito acá — el
        // default (Math.min(60_000, Math.floor(leaseMs / 2))) da 2500 para
        // este "leaseMs", válido por construcción. Pero con "lote"/
        // "concurrencia" por defecto (20/5, "olas" = 4), 2500 * 4 = 10_000
        // > 5000 SÍ dispara la advertencia de "Cola del pool y lease" — de
        // ahí el "lote: 1" (solo hay 1 fila en este test de todos modos).
        lote: 1,
        transportes: {
          correo: async () => {
            envios.push("A");
            await esperaDeA;
            // Cuando por fin "termina", A cree que el envío falló transitorio — si esto
            // pisara la fila, la dejaría "pendiente" de nuevo con un backoff agendado
            // (un tercer envío esperando a la vuelta de la esquina).
            return { ok: false, categoria: "red" };
          },
        },
      });

      await sleep(150); // A ya reclamó y está "en vuelo" adentro del Transporte.

      // B reclama la MISMA fila con "ahora" adelantado más allá del lease de A -> "destrabar".
      const resumenB = await procesarOutbox({
        db,
        tabla,
        ahora: () => new Date(Date.now() + 60_000),
        transportes: {
          correo: async () => {
            envios.push("B");
            return { ok: true, idExterno: "x" };
          },
        },
      });

      const trasB = await filaPorId(nombre, id);
      expect(resumenB.enviados).toBe(1);
      expect(trasB?.estado).toBe("enviado");
      expect(trasB?.id_externo).toBe("x");

      // Recién ACÁ "termina" A — después de que B ya cerró la fila.
      soltarA();
      const resumenA = await promesaA;

      expect(envios).toEqual(["A", "B"]);
      // El resultado tardío de A no encontró la fila con SU lease (B ya la reclamó de
      // nuevo con uno propio): se cuenta en "perdidos", NUNCA en "reintentar".
      expect(resumenA).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 1, liberados: 0, errores: 0, advertencias: [] });

      const final = await filaPorId(nombre, id);
      expect(final?.estado).toBe("enviado"); // sigue "enviado": A nunca la volvió a "pendiente"
      expect(final?.id_externo).toBe("x");
      expect(final?.proximo_intento_en).toBeNull();
    },
    15_000,
  );
});

describe("procesarOutbox: la cola del pool respeta el lease — L1 (Postgres)", () => {
  it(
    'escenario de la revisión, reescrito para la ronda de fix 3 (I1/I2: leaseMs >= 5000, timeoutMs <= leaseMs / 2) con reloj inyectado — DETERMINÍSTICO, no depende de timing real de pared: worker A (lote 4, concurrencia 1, lease 6000, timeout 2000) intenta las primeras 2 filas de su cola y LIBERA las otras 2 (no les queda margen de lease); worker B, arrancando justo en ese instante, reclama EXACTAMENTE esas 2 liberadas — nunca las que A todavía tiene en curso ni las que A ya cerró',
    async () => {
      const { tabla, nombre } = await tablaFresca();
      const tenantId = randomUUID();
      const T0 = new Date("2026-01-01T00:00:00.000Z");
      const LEASE_MS = 6000;
      const TIMEOUT_MS = 2000; // <= leaseMs / 2 (3000) — I1
      const MINIMO_RESTANTE_MS = TIMEOUT_MS + 1000; // 3000 — igual a la fórmula de procesarOutbox

      // programadoPara escalonado (1 ms de diferencia) para que el ORDER BY
      // de la consulta de reclamo (coalesce(proximoIntentoEn, programadoPara)
      // asc) devuelva las 4 filas SIEMPRE en este orden — necesario para que
      // la secuencia de `ahora()` de abajo, armada a mano, se corresponda
      // con la fila correcta en cada llamada. Las 4 tienen que quedar
      // DEBIDO ya al momento del reclamo (T0): si alguna quedara con
      // programadoPara > T0, el reclamo de A no la vería (la consulta pide
      // `programadoPara <= momento`) y "reclamados" daría menos de 4.
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { id } = await db.transaction((tx) =>
          encolar(tx, tabla, {
            tenantId,
            canal: "correo",
            destino: `d${i}@b.com`,
            plantilla: "p",
            claveIdempotencia: randomUUID(),
            maxIntentos: 5,
            programadoPara: new Date(T0.getTime() - 10 + i),
          }),
        );
        ids.push(id);
      }
      const [id0, id1, id2, id3] = ids as [string, string, string, string];

      const invocaciones: { worker: "A" | "B"; id: string }[] = [];

      // Reloj de A: arma a mano la secuencia de `ahora()` que hace que las
      // primeras 2 filas (id0, id1) todavía tengan margen (>= 3000 ms
      // restantes de lease) cuando les toca su turno, y que las últimas 2
      // (id2, id3) YA NO lo tengan — reproduce de verdad "la cola del pool
      // se comió el lease" sin esperar tiempo real de pared:
      //   call 0: momento del reclamo (T0) -> bloqueado_hasta de las 4 = T0+6000
      //   call 1: turno de id0 (T0)          -> restante 6000 >= 3000 -> intenta
      //   call 2: cierre de id0 (T0+2000)
      //   call 3: turno de id1 (T0+2000)     -> restante 4000 >= 3000 -> intenta
      //   call 4: cierre de id1 (T0+4000)
      //   call 5: turno de id2 (T0+4000)     -> restante 2000 <  3000 -> LIBERA
      //   call 6: turno de id3 (T0+4000)     -> restante 2000 <  3000 -> LIBERA
      const secuenciaA = [
        T0,
        T0,
        new Date(T0.getTime() + 2000),
        new Date(T0.getTime() + 2000),
        new Date(T0.getTime() + 4000),
        new Date(T0.getTime() + 4000),
        new Date(T0.getTime() + 4000),
      ];
      let llamadaA = 0;
      const ahoraA = (): Date => {
        if (llamadaA >= secuenciaA.length) {
          throw new Error(`ahoraA: más llamadas (${llamadaA + 1}) de las esperadas (${secuenciaA.length}) — revisar la secuencia armada a mano.`);
        }
        return secuenciaA[llamadaA++]!;
      };

      const transporteA: Transporte = async (mensaje) => {
        invocaciones.push({ worker: "A", id: mensaje.id });
        // Transitorio: vuelve a "pendiente" con backoff (varios segundos,
        // ver L4/backoff) — bien lejos de T0+4000, así que el worker B de
        // abajo (que corre "en" T0+4000) nunca lo va a ver como debido.
        return { ok: false, categoria: "red", codigo: "conexion_rechazada" };
      };

      const resumenA = await procesarOutbox({
        db,
        tabla,
        lote: 4,
        concurrencia: 1,
        leaseMs: LEASE_MS,
        timeoutMs: TIMEOUT_MS,
        ahora: ahoraA,
        transportes: { correo: transporteA },
      });

      // Este escenario (concurrencia: 1, lote: 4) es EXACTAMENTE el caso que
      // motiva la advertencia de I1/I2: leaseMs (6000) < timeoutMs * ceil(lote
      // / concurrencia) (2000 * 4 = 8000) — de ahí que la mitad de las filas
      // terminen "liberados" en vez de intentadas. La advertencia tiene que
      // aparecer acá, coherente con lo que de verdad pasó.
      expect(resumenA).toEqual({
        reclamados: 4,
        enviados: 0,
        reintentar: 2, // id0, id1: se intentaron (transitorio)
        fallidos: 0,
        descartados: 0,
        perdidos: 0,
        liberados: 2, // id2, id3: nunca se llamó al Transporte
        errores: 0,
        advertencias: [expect.stringMatching(/leaseMs/i)],
      });

      // Worker B arranca "en" T0+4000 — el mismo instante en que A liberó
      // id2/id3 (proximo_intento_en queda en exactamente ese momento). Con
      // un lease propio fresco (leaseMs: 6000 de nuevo) no hay riesgo de
      // que ESTE reclamo se libere de vuelta.
      const T_B = new Date(T0.getTime() + 4000);
      const transporteB: Transporte = async (mensaje) => {
        invocaciones.push({ worker: "B", id: mensaje.id });
        return { ok: true, idExterno: `b-${mensaje.id}` };
      };

      const resumenB = await procesarOutbox({
        db,
        tabla,
        lote: 4,
        concurrencia: 2,
        leaseMs: LEASE_MS,
        timeoutMs: TIMEOUT_MS,
        ahora: () => T_B,
        transportes: { correo: transporteB },
      });

      // Invariante central de L1: B reclama EXACTAMENTE las filas que A
      // liberó — ni más (no toca id0/id1, todavía en backoff bien lejos de
      // T_B) ni menos.
      expect(resumenB).toEqual({
        reclamados: 2,
        enviados: 2,
        reintentar: 0,
        fallidos: 0,
        descartados: 0,
        perdidos: 0,
        liberados: 0,
        errores: 0,
        advertencias: [],
      });

      // Ninguna fila fue invocada por los dos workers — ni siquiera una vez
      // cada uno (que ya sería un envío duplicado sobre la misma fila).
      const porFila = new Map<string, Set<"A" | "B">>();
      for (const inv of invocaciones) {
        const workers = porFila.get(inv.id) ?? new Set<"A" | "B">();
        workers.add(inv.worker);
        porFila.set(inv.id, workers);
      }
      for (const [filaId, workers] of porFila) {
        expect(workers.size, `fila ${filaId}: el Transporte fue invocado por más de un worker (${[...workers].join(", ")})`).toBe(1);
      }

      // Y, más específico todavía: A invocó el Transporte SOLO para id0/id1
      // (las que sí tenían margen), B SOLO para id2/id3 (las liberadas) —
      // nunca al revés.
      const idsInvocadosPorA = new Set(invocaciones.filter((i) => i.worker === "A").map((i) => i.id));
      const idsInvocadosPorB = new Set(invocaciones.filter((i) => i.worker === "B").map((i) => i.id));
      expect(idsInvocadosPorA).toEqual(new Set([id0, id1]));
      expect(idsInvocadosPorB).toEqual(new Set([id2, id3]));

      const [fila0, fila1, fila2, fila3] = await Promise.all([id0, id1, id2, id3].map((id) => filaPorId(nombre, id)));
      expect(fila0?.estado).toBe("pendiente"); // id0: falló transitorio, esperando backoff
      expect(fila1?.estado).toBe("pendiente"); // id1: ídem
      expect(fila2?.estado).toBe("enviado"); // id2: liberada por A, mandada por B
      expect(fila3?.estado).toBe("enviado"); // id3: ídem
    },
    15_000,
  );

  it('libera la fila (sin llamar al Transporte) cuando, a la hora de su turno, ya no queda margen de lease — "liberados", con "ahora" inyectado (determinístico, sin depender de timing real)', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const inicio = new Date("2026-01-01T00:00:00.000Z");
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5, programadoPara: inicio }),
    );

    // leaseMs: 5000 (el mínimo válido, I2), timeoutMs: 2000 (<= leaseMs/2,
    // I1) -> minimoRestante = timeoutMs + 1000 = 3000. A los 4200 ms
    // quedan 800 ms de lease, < 3000 -> se libera.
    const momentoDelTurno = new Date(inicio.getTime() + 4200);
    const llamadas: Date[] = [];
    const ahoraFalso = (): Date => {
      const valor = llamadas.length === 0 ? inicio : momentoDelTurno;
      llamadas.push(valor);
      return valor;
    };

    const transporte = vi.fn();
    const resumen = await procesarOutbox({
      db,
      tabla,
      leaseMs: 5000,
      timeoutMs: 2000,
      lote: 1, // solo hay 1 fila — con "leaseMs"/"timeoutMs" chicos explícitos, "lote"/"concurrencia" por defecto (20/5) dispararía la advertencia de "Cola del pool y lease" igual
      ahora: ahoraFalso,
      transportes: { correo: transporte },
    });

    expect(transporte).not.toHaveBeenCalled();
    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 0, liberados: 1, errores: 0, advertencias: [] });

    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("pendiente");
    expect(fila?.intentos).toBe(0); // se reclamó (0->1) y se liberó sin gastarlo (1->0)
    expect(fila?.bloqueado_hasta).toBeNull();
    expect(new Date(fila!.proximo_intento_en as string).getTime()).toBe(momentoDelTurno.getTime());
  });

  it('con un config válido, el timeout efectivo nunca es "un segundo espurio": cuando se intenta (no se libera), min(timeoutMs, restante - 1000) siempre da >= timeoutMs / 2, y en la práctica el Transporte recibe el timeoutMs configurado entero — I1/I2', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const inicio = new Date("2026-01-01T00:00:00.000Z");
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5, programadoPara: inicio }),
    );

    // leaseMs: 5000, timeoutMs: 1000 (bien por debajo de leaseMs/2 = 2500).
    // El turno llega "de inmediato" (mismo `ahora` para el reclamo y el
    // turno) -> restante = 5000, muy por encima de minimoRestante (2000):
    // se intenta, y timeoutEfectivoMs = min(1000, 5000-1000=4000) = 1000,
    // exactamente el configurado (nunca un resto "raro" y corto).
    let tiempoDeEsperaRecibido: number | undefined;
    const inicioLlamada = Date.now();
    const transporte: Transporte = (_mensaje, { señal }) =>
      new Promise((resolve) => {
        señal?.addEventListener("abort", () => {
          tiempoDeEsperaRecibido = Date.now() - inicioLlamada;
          resolve({ ok: false, categoria: "red", codigo: "timeout" });
        });
      });

    const resumen = await procesarOutbox({
      db,
      tabla,
      leaseMs: 5000,
      timeoutMs: 1000,
      ahora: () => inicio,
      transportes: { correo: transporte },
    });

    expect(resumen.liberados).toBe(0); // se intentó, no se liberó
    expect(resumen.reintentar).toBe(1);
    // El timeout real (medido por cuándo se abortó la señal) tiene que
    // rondar timeoutMs (1000 ms) — nunca algo del orden de milisegundos
    // (lo que pasaba con el hueco de configuración que este fix cierra).
    expect(tiempoDeEsperaRecibido).toBeGreaterThanOrEqual(900);
    expect(tiempoDeEsperaRecibido).toBeLessThan(1900); // >= timeoutMs/2 (500) con margen amplio, nunca "sub-segundo espurio"

    const fila = await filaPorId(nombre, id);
    expect(fila?.ultimo_error_codigo).toBe("timeout");
  });
});

describe('procesarOutbox: "bloqueadoHasta" inválido se trata como perdida, sin tocar el Transporte — M1 (Postgres)', () => {
  it('si la normalización de reclamarLote diera un "bloqueadoHasta" inválido (Invalid Date), la fila se cuenta "perdidos" sin invocar ningún Transporte', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID() }),
    );

    // Envuelve `db.transaction` para corromper, a propósito, el
    // "bloqueadoHasta" que devuelve la consulta de reclamo real — simula lo
    // que pasaría si la normalización string->Date de `reclamarLote` (ver
    // su JSDoc, ronda de fix 2) alguna vez recibiera un valor que no puede
    // parsear: en vez de tirar, `new Date(...)` da un "Invalid Date"
    // (`.getTime()` es `NaN`, no un error). M1 tiene que atajar esto ANTES
    // de calcular nada con esa fecha, no dejar que un `NaN` se cuele en la
    // cuenta de "cuánto lease queda" (`NaN < minimoRestante` es siempre
    // `false`, así que sin la guarda se intentaría igual el Transporte).
    const dbConBloqueadoHastaInvalido = {
      transaction: (fn: Parameters<NodePgDatabase["transaction"]>[0]) =>
        db.transaction(async (tx) => {
          const txEnvuelto = {
            ...tx,
            execute: async (query: Parameters<NodePgDatabase["execute"]>[0]) => {
              const resultado = (await tx.execute(query)) as unknown as { rows: Record<string, unknown>[] };
              for (const fila of resultado.rows) {
                if ("bloqueadoHasta" in fila) fila.bloqueadoHasta = new Date("no-es-una-fecha-valida");
              }
              return resultado;
            },
          };
          return fn(txEnvuelto as unknown as Parameters<typeof fn>[0]);
        }),
    } as unknown as NodePgDatabase;

    const transporte = vi.fn();
    const resumen = await procesarOutbox({ db: dbConBloqueadoHastaInvalido, tabla, transportes: { correo: transporte } });

    expect(transporte).not.toHaveBeenCalled();
    expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 0, fallidos: 0, descartados: 0, perdidos: 1, liberados: 0, errores: 0, advertencias: [] });

    // M1 no escribe nada — la fila queda tal cual la dejó el reclamo REAL
    // (estado "procesando", con su lease de verdad, íntegro en la base; la
    // corrupción solo existía en el objeto JS que vio `procesarOutbox`).
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("procesando");
  });
});

describe("procesarOutbox: bucle de caídas respeta maxIntentos — I5 (Postgres)", () => {
  it(
    'un lease vencido repetidamente, con intentos ya agotados, cierra la fila a "fallido" (codigo lease_agotado) SIN llamar al Transporte de nuevo',
    async () => {
      const { tabla, nombre } = await tablaFresca();
      const tenantId = randomUUID();
      const { id } = await db.transaction((tx) =>
        encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 2 }),
      );

      const llamadoAlTransporte: boolean[] = [];
      const reclamadosPorCorrida: number[] = [];
      const fallidosPorCorrida: number[] = [];

      for (let i = 0; i < 4; i++) {
        // Simula un worker que se cae SIEMPRE a mitad de camino: la fila queda
        // "procesando" con el lease ya vencido, pase lo que pase en la corrida anterior.
        await poolChequeo.query(`update "${nombre}" set estado = 'procesando', bloqueado_hasta = now() - interval '1 hour'`);

        let entro = false;
        const r = await procesarOutbox({
          db,
          tabla,
          transportes: { correo: async () => { entro = true; return { ok: true }; } },
        });
        llamadoAlTransporte.push(entro);
        reclamadosPorCorrida.push(r.reclamados);
        fallidosPorCorrida.push(r.fallidos);
      }

      // Los primeros dos reclamos todavía tienen intentos disponibles (0->1, 1->2) y
      // SÍ llaman al Transporte; el tercero y el cuarto ya están agotados (intentos=2
      // >= maxIntentos=2) y se cierran solos, sin llamar a nada.
      expect(llamadoAlTransporte).toEqual([true, true, false, false]);
      expect(reclamadosPorCorrida).toEqual([1, 1, 1, 1]); // las 4 corridas SÍ reclaman la fila
      expect(fallidosPorCorrida).toEqual([0, 0, 1, 1]); // pero solo las últimas 2 la cuentan como "fallido"

      const fila = await filaPorId(nombre, id);
      expect(fila?.estado).toBe("fallido");
      expect(fila?.intentos).toBe(2); // nunca pasó de 2 (maxIntentos) aunque se reclamó 4 veces
      expect(fila?.ultimo_error_categoria).toBe("red");
      expect(fila?.ultimo_error_codigo).toBe("lease_agotado");
      expect(fila?.bloqueado_hasta).toBeNull();
    },
    15_000,
  );

  it("bloqueado_hasta EXACTAMENTE igual a ahora se considera vencido (<=, alineado con decidir del núcleo)", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const momento = new Date();
    const id = await insertarFilaCruda(nombre, {
      tenantId,
      canal: "correo",
      claveIdempotencia: randomUUID(),
      estado: "procesando",
      intentos: 1,
      maxIntentos: 5,
      bloqueadoHasta: momento,
    });

    const resumen = await procesarOutbox({ db, tabla, ahora: () => momento, transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) } });

    expect(resumen.reclamados).toBe(1);
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("enviado");
  });

  it('L3: la SQL de reclamo distingue "lease_agotado" (venía "procesando") de "intentos_agotados" (venía "pendiente", salvaguarda)', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();

    const idProcesandoAgotado = await insertarFilaCruda(nombre, {
      tenantId,
      canal: "correo",
      claveIdempotencia: randomUUID(),
      estado: "procesando",
      intentos: 5,
      maxIntentos: 5,
      bloqueadoHasta: new Date(Date.now() - 60_000),
    });
    // Salvaguarda: una fila "pendiente" que de algún modo llegó con los
    // intentos ya agotados (no debería pasar en el flujo normal — ver el
    // JSDoc de `decidir`/`reclamarLote`).
    const idPendienteAgotada = await insertarFilaCruda(nombre, {
      tenantId,
      canal: "correo",
      claveIdempotencia: randomUUID(),
      estado: "pendiente",
      intentos: 5,
      maxIntentos: 5,
      programadoPara: new Date(Date.now() - 60_000),
    });

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) } });

    expect(resumen.reclamados).toBe(2);
    expect(resumen.fallidos).toBe(2);

    const filaProcesando = await filaPorId(nombre, idProcesandoAgotado);
    expect(filaProcesando?.estado).toBe("fallido");
    expect(filaProcesando?.ultimo_error_codigo).toBe("lease_agotado");

    const filaPendiente = await filaPorId(nombre, idPendienteAgotada);
    expect(filaPendiente?.estado).toBe("fallido");
    expect(filaPendiente?.ultimo_error_codigo).toBe("intentos_agotados");
  });
});

/**
 * M2 (fix round 3): el `observableEsperado` de cada fixture ya NO se
 * escribe a mano — se DERIVA de `decisionEsperada` (lo que se comprueba
 * contra `decidir()` real, ver el test de abajo), para que las dos
 * expectativas no puedan divergir por un error de tipeo entre columnas.
 *
 * La única rama que no es 1:1 con `Decision` es `"descartar"`: `decidir()`
 * la usa tanto para una fila YA terminal (`"enviado"`/`"fallido"`/
 * `"descartado"` — `procesarOutbox` ni la mira, la consulta de reclamo
 * filtra por `estado in ('pendiente','procesando')`) como para una fila
 * ACTIVA con los intentos agotados (la propia consulta de reclamo la
 * cierra a `"fallido"` ahí mismo, sin invocar el Transporte) — por eso
 * esta función también recibe el `estado` ORIGINAL de la fixture.
 */
function observableEsperadoDe(decision: Decision, estadoOriginal: string): "invocada" | "no_tocada" | "fallido_directo" {
  switch (decision) {
    case "enviar":
    case "destrabar":
      return "invocada";
    case "esperar":
    case "reintentar_luego":
      return "no_tocada";
    case "descartar":
      return estadoOriginal === "pendiente" || estadoOriginal === "procesando" ? "fallido_directo" : "no_tocada";
    default: {
      const _exhaustivo: never = decision;
      throw new Error(`observableEsperadoDe: decisión no contemplada: ${_exhaustivo as string}`);
    }
  }
}

describe("procesarOutbox: paridad decidir() (núcleo) vs. la consulta de reclamo real — L3 (Postgres)", () => {
  it("decidir() predice EXACTAMENTE lo que hace la consulta de reclamo, para el mismo conjunto de fixtures", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const AHORA = new Date("2026-06-01T12:00:00.000Z");
    const PASADO = new Date("2026-06-01T11:00:00.000Z");
    const FUTURO = new Date("2026-06-01T13:00:00.000Z");

    // Cada fixture: cómo se arma la fila cruda, y qué decisión debería dar
    // `decidir()` para esos mismos datos — el observable (qué tiene que
    // haber pasado de verdad tras UNA corrida de `procesarOutbox` con
    // `ahora: () => AHORA`) sale de `observableEsperadoDe()` arriba, nunca
    // a mano (M2).
    const fixtures = [
      {
        nombre: "pendiente debido, sin proximoIntentoEn",
        fila: { estado: "pendiente" as const, intentos: 0, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: null },
        decisionEsperada: "enviar" as const,
      },
      {
        nombre: "pendiente, programadoPara futuro",
        fila: { estado: "pendiente" as const, intentos: 0, maxIntentos: 5, programadoPara: FUTURO, proximoIntentoEn: null, bloqueadoHasta: null },
        decisionEsperada: "esperar" as const,
      },
      {
        nombre: "pendiente, debido pero proximoIntentoEn futuro (esperando backoff)",
        fila: { estado: "pendiente" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: FUTURO, bloqueadoHasta: null },
        decisionEsperada: "reintentar_luego" as const,
      },
      {
        nombre: "procesando, lease vigente",
        fila: { estado: "procesando" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: FUTURO },
        decisionEsperada: "esperar" as const,
      },
      {
        nombre: "procesando, lease vencido, con intentos disponibles",
        fila: { estado: "procesando" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: PASADO },
        decisionEsperada: "destrabar" as const,
      },
      {
        nombre: "procesando, lease vencido, intentos agotados",
        fila: { estado: "procesando" as const, intentos: 5, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: PASADO },
        decisionEsperada: "descartar" as const,
      },
      {
        nombre: "pendiente, intentos agotados (salvaguarda)",
        fila: { estado: "pendiente" as const, intentos: 5, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: null },
        decisionEsperada: "descartar" as const,
      },
      {
        nombre: "terminal (enviado)",
        fila: { estado: "enviado" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: null },
        decisionEsperada: "descartar" as const,
      },
      // M2: fixtures de borde inclusivo — los tres puntos donde `decidir()`
      // y la consulta SQL usan `<=` (no `<`), así que "exactamente ahora"
      // tiene que contar como "ya pasó", en los tres campos de fecha que
      // importan.
      {
        nombre: "procesando, lease vencido EXACTAMENTE en el borde (bloqueadoHasta == AHORA)",
        fila: { estado: "procesando" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: null, bloqueadoHasta: AHORA },
        decisionEsperada: "destrabar" as const,
      },
      {
        nombre: "pendiente, debido EXACTAMENTE en el borde (programadoPara == AHORA)",
        fila: { estado: "pendiente" as const, intentos: 0, maxIntentos: 5, programadoPara: AHORA, proximoIntentoEn: null, bloqueadoHasta: null },
        decisionEsperada: "enviar" as const,
      },
      {
        nombre: "pendiente, backoff vencido EXACTAMENTE en el borde (proximoIntentoEn == AHORA)",
        fila: { estado: "pendiente" as const, intentos: 1, maxIntentos: 5, programadoPara: PASADO, proximoIntentoEn: AHORA, bloqueadoHasta: null },
        decisionEsperada: "enviar" as const,
      },
    ];

    const idsPorFixture = new Map<string, string>();
    for (const f of fixtures) {
      const id = await insertarFilaCruda(nombre, {
        tenantId,
        canal: "correo",
        claveIdempotencia: randomUUID(),
        estado: f.fila.estado,
        intentos: f.fila.intentos,
        maxIntentos: f.fila.maxIntentos,
        programadoPara: f.fila.programadoPara,
        proximoIntentoEn: f.fila.proximoIntentoEn,
        bloqueadoHasta: f.fila.bloqueadoHasta,
      });
      idsPorFixture.set(f.nombre, id);
    }

    const invocadas = new Set<string>();
    await procesarOutbox({
      db,
      tabla,
      lote: fixtures.length,
      ahora: () => AHORA,
      transportes: {
        correo: async (mensaje) => {
          invocadas.add(mensaje.id);
          return { ok: true, idExterno: "x" };
        },
      },
    });

    for (const f of fixtures) {
      const decisionReal = decidir(
        {
          estado: f.fila.estado,
          intentos: f.fila.intentos,
          maxIntentos: f.fila.maxIntentos,
          programadoPara: f.fila.programadoPara,
          proximoIntentoEn: f.fila.proximoIntentoEn,
          bloqueadoHasta: f.fila.bloqueadoHasta,
        },
        AHORA,
      );
      expect(decisionReal, f.nombre).toBe(f.decisionEsperada);

      const id = idsPorFixture.get(f.nombre)!;
      const filaFinal = await filaPorId(nombre, id);
      const estadoOriginal = f.fila.estado;
      const observableEsperado = observableEsperadoDe(decisionReal, estadoOriginal);

      if (observableEsperado === "invocada") {
        expect(invocadas.has(id), `${f.nombre}: tenía que invocarse el Transporte`).toBe(true);
        expect(filaFinal?.estado, f.nombre).toBe("enviado");
      } else if (observableEsperado === "fallido_directo") {
        expect(invocadas.has(id), `${f.nombre}: NO tenía que invocarse el Transporte`).toBe(false);
        expect(filaFinal?.estado, f.nombre).toBe("fallido");
      } else {
        expect(invocadas.has(id), `${f.nombre}: NO tenía que invocarse el Transporte`).toBe(false);
        expect(filaFinal?.estado, f.nombre).toBe(estadoOriginal); // sin tocar
      }
    }
  });
});

describe("procesarOutbox: timeout por intento — I4 (Postgres)", () => {
  it(
    "un Transporte que nunca resuelve se trata como timeout (transitorio, categoria red, codigo timeout) pasado timeoutMs",
    async () => {
      const { tabla, nombre } = await tablaFresca();
      const tenantId = randomUUID();
      const { id } = await db.transaction((tx) =>
        encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5 }),
      );

      const resumen = await procesarOutbox({
        db,
        tabla,
        // I1/I2 (fix round 3): leaseMs >= 5000 y timeoutMs <= leaseMs / 2 son
        // ahora obligatorios — con leaseMs: 5000, restanteMs al arrancar es
        // el lease entero (5000) >= minimoRestante (timeoutMs + 1000 =
        // 3000), así que SÍ se intenta (no se libera), y el timeout real
        // que corre es el configurado (2000 ms), no un resto arbitrario.
        leaseMs: 5000,
        timeoutMs: 2000,
        lote: 1, // solo hay 1 fila — con "leaseMs"/"timeoutMs" chicos explícitos, "lote"/"concurrencia" por defecto (20/5) dispararía la advertencia de "Cola del pool y lease" igual
        transportes: { correo: () => new Promise(() => {}) }, // cuelga para siempre
      });

      expect(resumen).toEqual({ reclamados: 1, enviados: 0, reintentar: 1, fallidos: 0, descartados: 0, perdidos: 0, liberados: 0, errores: 0, advertencias: [] });
      const fila = await filaPorId(nombre, id);
      expect(fila?.estado).toBe("pendiente");
      expect(fila?.ultimo_error_categoria).toBe("red");
      expect(fila?.ultimo_error_codigo).toBe("timeout");
    },
    10_000,
  );

  it('"timeoutMs" > "leaseMs / 2" tira ErrorOutbox("opciones_invalidas") (con db/tabla reales) — I1', async () => {
    const { tabla } = await tablaFresca();
    await expect(procesarOutbox({ db, tabla, leaseMs: 5000, timeoutMs: 2600, transportes: {} })).rejects.toMatchObject({
      name: "ErrorOutbox",
      codigo: "opciones_invalidas",
    });
  });
});

describe("procesarOutbox: concurrencia acotada — I6 (Postgres)", () => {
  it("concurrencia limita cuántas filas se procesan (llaman al Transporte) al mismo tiempo", async () => {
    const { tabla } = await tablaFresca();
    const tenantId = randomUUID();
    const CANTIDAD = 9;
    for (let i = 0; i < CANTIDAD; i++) {
      await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: `d${i}@b.com`, plantilla: "p", claveIdempotencia: randomUUID() }));
    }

    let enVuelo = 0;
    let maxEnVuelo = 0;
    const transporte: Transporte = async () => {
      enVuelo++;
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await sleep(60);
      enVuelo--;
      return { ok: true, idExterno: "x" };
    };

    const resumen = await procesarOutbox({ db, tabla, transportes: { correo: transporte }, lote: CANTIDAD, concurrencia: 3 });

    expect(resumen.reclamados).toBe(CANTIDAD);
    expect(resumen.enviados).toBe(CANTIDAD);
    expect(maxEnVuelo).toBeLessThanOrEqual(3); // nunca más de "concurrencia" a la vez
    expect(maxEnVuelo).toBeGreaterThan(1); // pero sí corrió en paralelo, no una por una
  });

  it("un fallo en el registro de UNA fila (allSettled) no pierde el resultado de las demás", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: `d${i}@b.com`, plantilla: "p", claveIdempotencia: randomUUID() }));
      ids.push(id);
    }

    // Envuelve `db` para que el registro (db.execute fuera de una transacción,
    // que es como escribe registrarResultado) falle en la llamada número 2
    // exacta — la del reclamo (db.transaction) nunca pasa por este `execute`
    // envuelto, así que el reclamo de las 3 filas sale bien.
    let llamadasAExecute = 0;
    const dbConFalloEnUnaFila = {
      transaction: (fn: Parameters<NodePgDatabase["transaction"]>[0]) => db.transaction(fn),
      execute: async (query: Parameters<NodePgDatabase["execute"]>[0]) => {
        llamadasAExecute++;
        if (llamadasAExecute === 2) {
          const error = new Error("boom (nunca debería verse este mensaje)") as Error & { cause?: unknown };
          error.cause = { code: "40001" };
          throw error;
        }
        return db.execute(query);
      },
    } as unknown as NodePgDatabase;

    const resumen = await procesarOutbox({
      db: dbConFalloEnUnaFila,
      tabla,
      concurrencia: 1, // procesa una fila a la vez -> orden determinístico de las llamadas a execute
      transportes: { correo: transporteFijo({ ok: true, idExterno: "x" }) },
    });

    expect(resumen.reclamados).toBe(3);
    expect(resumen.enviados).toBe(2); // las otras dos SÍ se registraron
    expect(resumen.errores).toBe(1);
    expect(resumen.ultimoError).toEqual({ codigo: "40001" });
    expect(JSON.stringify(resumen)).not.toContain("nunca debería verse este mensaje");

    const filas = await Promise.all(ids.map((id) => filaPorId(nombre, id)));
    const estados = filas.map((f) => f?.estado).sort();
    // Una de las tres quedó "procesando" (colgada: el Transporte SÍ se llamó y
    // devolvió ok, pero el registro tiró) — las otras dos, "enviado".
    expect(estados).toEqual(["enviado", "enviado", "procesando"]);
  });
});

describe("procesarOutbox: nunca tira por un fallo de la base — I6/controller ruling (Postgres)", () => {
  it("un fallo de la base durante el RECLAMO no propaga: resumen.errores lo refleja, con el código de Postgres (nunca el mensaje)", async () => {
    const { tabla } = await tablaFresca();
    const dbRoto = {
      transaction: async () => {
        const error = new Error("conexión perdida (nunca debería verse este mensaje)") as Error & { cause?: unknown };
        error.cause = { code: "57P01" };
        throw error;
      },
    } as unknown as NodePgDatabase;

    const resumen = await procesarOutbox({ db: dbRoto, tabla, transportes: {} });

    expect(resumen.reclamados).toBe(0);
    expect(resumen.errores).toBe(1);
    expect(resumen.ultimoError).toEqual({ codigo: "57P01" });
    expect(JSON.stringify(resumen)).not.toContain("nunca debería verse este mensaje");
  });
});

describe("procesarOutbox: MensajeParaEnviar.claveIdempotencia — I3 (Postgres)", () => {
  it('el Transporte recibe claveIdempotencia como "${tenantId}:${claveIdempotencia}"', async () => {
    const { tabla } = await tablaFresca();
    const tenantId = randomUUID();
    const clave = randomUUID();
    await db.transaction((tx) => encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: clave }));

    let recibido: string | undefined;
    await procesarOutbox({
      db,
      tabla,
      transportes: {
        correo: async (mensaje) => {
          recibido = mensaje.claveIdempotencia;
          return { ok: true, idExterno: "x" };
        },
      },
    });

    expect(recibido).toBe(`${tenantId}:${clave}`);
  });
});

describe("procesarOutbox: ultimo_error_codigo se recorta a 64 caracteres — M9 (Postgres)", () => {
  it("un codigo de más de 64 caracteres se guarda recortado", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID() }),
    );
    const codigoLargo = "x".repeat(200);

    await procesarOutbox({ db, tabla, transportes: { correo: transporteFijo({ ok: false, categoria: "credenciales", codigo: codigoLargo }) } });

    const fila = await filaPorId(nombre, id);
    expect((fila!.ultimo_error_codigo as string).length).toBe(64);
    expect(fila!.ultimo_error_codigo).toBe("x".repeat(64));
  });
});

describe('procesarOutbox: "conflicto_idempotencia" tiene un backoff más largo (al menos 60 s) — L4 (Postgres)', () => {
  it("un fallo conflicto_idempotencia agenda proximo_intento_en al menos 60 s después, incluso en el PRIMER intento (donde el backoff normal daría ~30 s)", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const { id } = await db.transaction((tx) =>
      encolar(tx, tabla, { tenantId, canal: "correo", destino: "a@b.com", plantilla: "p", claveIdempotencia: randomUUID(), maxIntentos: 5 }),
    );
    const antes = new Date();

    const resumen = await procesarOutbox({
      db,
      tabla,
      ahora: () => antes,
      transportes: { correo: transporteFijo({ ok: false, categoria: "conflicto_idempotencia", codigo: "409" }) },
    });

    expect(resumen.reintentar).toBe(1);
    const fila = await filaPorId(nombre, id);
    expect(fila?.estado).toBe("pendiente");
    expect(fila?.ultimo_error_categoria).toBe("conflicto_idempotencia");
    const proximoIntentoEnMs = new Date(fila!.proximo_intento_en as string).getTime();
    expect(proximoIntentoEnMs - antes.getTime()).toBeGreaterThanOrEqual(60_000);
  });
});

describe("purgarOutbox (Postgres)", () => {
  it('borra filas TERMINALES (enviado/descartado/fallido) con actualizado_en anterior a "antesDe", y ninguna otra', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();

    const idViejoEnviado = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "enviado" });
    await poolChequeo.query(`update "${nombre}" set actualizado_en = now() - interval '40 days' where id = $1`, [idViejoEnviado]);

    const idNuevoEnviado = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "enviado" });

    const idPendiente = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "pendiente" });
    await poolChequeo.query(`update "${nombre}" set actualizado_en = now() - interval '40 days' where id = $1`, [idPendiente]);

    const idViejoDescartado = await insertarFilaCruda(nombre, { tenantId, canal: "whatsapp", claveIdempotencia: randomUUID(), estado: "descartado" });
    await poolChequeo.query(`update "${nombre}" set actualizado_en = now() - interval '40 days' where id = $1`, [idViejoDescartado]);

    const { eliminadas } = await purgarOutbox({ db, tabla, antesDe: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });

    expect(eliminadas).toBe(2);
    expect(await filaPorId(nombre, idViejoEnviado)).toBeUndefined();
    expect(await filaPorId(nombre, idViejoDescartado)).toBeUndefined();
    expect(await filaPorId(nombre, idNuevoEnviado)).toBeDefined(); // terminal pero reciente: se queda
    expect(await filaPorId(nombre, idPendiente)).toBeDefined(); // vieja pero NO terminal: se queda
  });

  it("estados custom: solo purga lo que se le pide", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const idEnviado = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "enviado" });
    const idFallido = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "fallido" });
    await poolChequeo.query(`update "${nombre}" set actualizado_en = now() - interval '1 day'`);

    const { eliminadas } = await purgarOutbox({ db, tabla, estados: ["enviado"], antesDe: new Date() });

    expect(eliminadas).toBe(1);
    expect(await filaPorId(nombre, idEnviado)).toBeUndefined();
    expect(await filaPorId(nombre, idFallido)).toBeDefined(); // no se pidió purgar "fallido"
  });

  it("cuenta las eliminadas por rows.length cuando el driver no trae rowCount (ej. neon-serverless) — OUT OF SCOPE", async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const idViejo = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "enviado" });
    await poolChequeo.query(`update "${nombre}" set actualizado_en = now() - interval '1 day' where id = $1`, [idViejo]);

    // Envuelve `db` para que su `execute` devuelva SOLO `rows` (como si el
    // driver no expusiera `rowCount`) — si `purgarOutbox` dependiera
    // ÚNICAMENTE de `rowCount`, esto reportaría `eliminadas: 0` en
    // silencio aunque el DELETE sí haya borrado la fila.
    const dbSinRowCount = {
      execute: async (query: Parameters<NodePgDatabase["execute"]>[0]) => {
        const real = (await db.execute(query)) as unknown as { rows: unknown[] };
        return { rows: real.rows }; // sin "rowCount"
      },
    } as unknown as NodePgDatabase;

    const { eliminadas } = await purgarOutbox({ db: dbSinRowCount, tabla, antesDe: new Date() });

    expect(eliminadas).toBe(1);
    expect(await filaPorId(nombre, idViejo)).toBeUndefined(); // de verdad se borró
  });

  it('rechaza estados NO terminales ("pendiente"/"procesando") ANTES de tocar la base', async () => {
    const { tabla, nombre } = await tablaFresca();
    const tenantId = randomUUID();
    const idPendiente = await insertarFilaCruda(nombre, { tenantId, canal: "correo", claveIdempotencia: randomUUID(), estado: "pendiente" });

    await expect(purgarOutbox({ db, tabla, estados: ["pendiente"], antesDe: new Date() })).rejects.toMatchObject({
      name: "ErrorOutbox",
      codigo: "opciones_invalidas",
    });
    // Y no tocó nada.
    expect(await filaPorId(nombre, idPendiente)).toBeDefined();
  });
});

describe("procesarOutbox: la consulta de reclamo usa el índice parcial — I7 (Postgres)", () => {
  it("EXPLAIN (con seqscan apagado) usa outbox_activos_idx para el WHERE/ORDER de la consulta de reclamo", async () => {
    const { nombre } = await tablaFresca();
    const tenantId = randomUUID();
    for (let i = 0; i < 5; i++) {
      await poolChequeo.query(
        `insert into "${nombre}" (organizacion_id, canal, destino, plantilla, datos, clave_idempotencia) values ($1, 'correo', 'd@b.com', 'p', '{}', $2)`,
        [tenantId, randomUUID()],
      );
    }

    const cliente = await poolChequeo.connect();
    try {
      await cliente.query("begin");
      // Apaga seq scan para esta transacción: en una tabla tan chica Postgres
      // preferiría un seq scan de cualquier forma (más barato que un índice
      // para pocas filas) — esto confirma que el índice PODRÍA usarse
      // (está bien formado, cubre las columnas correctas), no que el
      // planner lo elija siempre en producción con una tabla chica.
      await cliente.query("set local enable_seqscan = off");
      const explicacion = await cliente.query(
        `explain select id from "${nombre}"
         where (estado = 'pendiente' and programado_para <= now() and (proximo_intento_en is null or proximo_intento_en <= now()))
            or (estado = 'procesando' and bloqueado_hasta is not null and bloqueado_hasta <= now())
         order by coalesce(proximo_intento_en, programado_para) asc
         limit 20
         for update skip locked`,
      );
      const plan = explicacion.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
      // El nombre real lleva el prefijo de la tabla de test (`${nombre}_activos_idx`,
      // no literalmente "outbox_activos_idx" — la tabla de este test no se llama "outbox").
      expect(plan).toContain(`${nombre}_activos_idx`);
      expect(plan).toContain("Index Scan"); // confirma que el plan usa un índice, no un seq scan
      await cliente.query("rollback");
    } finally {
      cliente.release();
    }
  });
});
