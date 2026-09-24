import { describe, expect, it, vi } from "vitest";
import { procesarOutbox } from "../../src/drizzle/procesar.js";

/**
 * `procesarOutbox` valida sus opciones ANTES de tocar `db`/`tabla` — estos
 * tests lo prueban sin Postgres, con `db`/`tabla` como `undefined`: si la
 * validación no corriera antes de tocarlos, `db.transaction(...)` tiraría
 * un `TypeError` — que, desde la ronda de fix 1 (controller ruling: "nunca
 * tira"), `procesarOutbox` ATRAPA y convierte en `{ ...vacío, errores: 1 }`
 * en vez de propagar (ver `procesar-nunca-tira.test.ts` para esa garantía
 * en detalle). Un `ErrorOutbox("opciones_invalidas")` en cambio SIGUE
 * tirando de verdad — es un error de programación, no un fallo de la base
 * — así que estos tests distinguen los dos casos por la FORMA del
 * resultado, no solo por si la promesa rechaza.
 */
describe("procesarOutbox: valida las opciones antes de tocar db/tabla", () => {
  it('"lote" no entero o < 1 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, lote: 0 }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, lote: 2.5 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"leaseMs" <= 0 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 0 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: -1 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"leaseMs" < 5000 tira ErrorOutbox("opciones_invalidas") — I1/I2: un lease muy corto no deja margen razonable para timeoutMs + el margen de 1s', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 4999 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 1000 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"leaseMs" === 5000 (el mínimo válido) NO tira por esta validación', async () => {
    // timeoutMs explícito (el máximo permitido para este leaseMs, 2500) —
    // desde la ronda de fix 3b el default de timeoutMs es un FIJO de
    // 60_000, que con leaseMs: 5000 violaría "<= leaseMs / 2" por sí solo
    // (ver el test de abajo); este test aísla específicamente el chequeo
    // de "leaseMs" >= 5000.
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 5000, timeoutMs: 2500 });
    expect(resumen.errores).toBe(1); // sigue fallando, pero por la base (db undefined), no por opciones_invalidas
  });

  it('"timeoutMs" <= 0 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 10_000, timeoutMs: 0 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"timeoutMs" > "leaseMs / 2" tira ErrorOutbox("opciones_invalidas") — I1: antes solo se exigía < leaseMs', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 10_000, timeoutMs: 5001 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 10_000, timeoutMs: 9000 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"timeoutMs" === "leaseMs / 2" (el máximo válido) NO tira por esta validación', async () => {
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 10_000, timeoutMs: 5000 });
    expect(resumen.errores).toBe(1);
  });

  it('la configuración exacta que reprodujo el hueco de la revisión (leaseMs: 60_000, timeoutMs: 59_980) ahora se RECHAZA', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 60_000, timeoutMs: 59_980 }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "opciones_invalidas" });
  });

  it('"timeoutMs" por defecto (60_000, FIJO desde la ronda de fix 3b) es válido con "leaseMs" en su propio default (600_000)', async () => {
    // Sin pasar NADA de leaseMs/timeoutMs: los dos valores por defecto del
    // paquete tienen que ser compatibles entre sí (60_000 <= 600_000 / 2).
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {} });
    expect(resumen.errores).toBe(1); // no tiró por opciones_invalidas — llegó hasta el fallo de la base
  });

  it('"timeoutMs" por defecto (60_000, FIJO) SÍ tira si se customiza "leaseMs" por debajo de 120_000 sin pasar "timeoutMs" explícito — ronda de fix 3b: ya no escala con leaseMs como antes (Math.floor(leaseMs/2))', async () => {
    // leaseMs: 10_001 (válido en sí mismo, >= 5000) pero el default fijo de
    // timeoutMs (60_000) excede leaseMs/2 (5000.5) — tiene que rechazarse,
    // no colarse como en la ronda anterior (donde el default SIEMPRE
    // escalaba junto con leaseMs y nunca podía violar su propia cota).
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 10_001 }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "opciones_invalidas" });
  });

  it('"concurrencia" no entero o < 1 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, concurrencia: 0 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, concurrencia: 1.5 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"transportes.correo"/"transportes.whatsapp" (si se pasan) tienen que ser funciones', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { correo: "no-es-funcion" as never } }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { whatsapp: 123 as never } }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it("transportes: {} (ningún canal configurado) no tira por validación — es válido, cada mensaje se descarta en su momento", async () => {
    // Con db/tabla undefined y opciones válidas, procesarOutbox YA NO
    // rechaza (ver el JSDoc de arriba): atrapa el fallo de la base y
    // resuelve con un resumen que lo refleja en "errores".
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, lote: 1 });
    expect(resumen.reclamados).toBe(0);
    expect(resumen.errores).toBe(1);
  });

  it("con opciones válidas, la validación deja pasar (el siguiente fallo, de la base, se atrapa y no tira)", async () => {
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { correo: vi.fn() } });
    expect(resumen.reclamados).toBe(0);
    expect(resumen.errores).toBe(1);
  });

  it('el resumen (aunque sea el "vacío" de un error atrapado) siempre trae "advertencias" (arreglo, aunque esté vacío)', async () => {
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {} });
    expect(Array.isArray(resumen.advertencias)).toBe(true);
  });

  it('"leaseMs" chico frente a "timeoutMs * ceil(lote/concurrencia)" NO tira — solo agrega una advertencia al resumen, sin loguear nada', async () => {
    const espia = vi.spyOn(console, "warn").mockImplementation(() => {});
    const espiaError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // leaseMs: 10_000, timeoutMs: 5000 (el máximo permitido), lote: 10, concurrencia: 1
      // -> timeoutMs * ceil(lote/concurrencia) = 5000 * 10 = 50_000 > leaseMs (10_000).
      const resumen = await procesarOutbox({
        db: undefined as never,
        tabla: undefined as never,
        transportes: {},
        leaseMs: 10_000,
        timeoutMs: 5000,
        lote: 10,
        concurrencia: 1,
      });
      expect(resumen.advertencias.length).toBeGreaterThan(0);
      expect(resumen.advertencias[0]).toMatch(/leaseMs|lote|concurrencia/i);
      expect(espia).not.toHaveBeenCalled();
      expect(espiaError).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
      espiaError.mockRestore();
    }
  });

  it('con "leaseMs" holgado frente a "timeoutMs * ceil(lote/concurrencia)", no hay advertencias', async () => {
    const resumen = await procesarOutbox({
      db: undefined as never,
      tabla: undefined as never,
      transportes: {},
      leaseMs: 10_000,
      timeoutMs: 100,
      lote: 2,
      concurrencia: 2,
    });
    expect(resumen.advertencias).toEqual([]);
  });

  it('con TODAS las opciones por defecto (sin pasar lote/leaseMs/timeoutMs/concurrencia), "advertencias" da [] — ronda de fix 3b: el controller marcó que los defaults del paquete NO pueden dispararse su propia advertencia', async () => {
    // lote: 20, concurrencia: 5 (olas = 4), leaseMs: 600_000, timeoutMs:
    // 60_000 -> 60_000 * 4 = 240_000 <= 600_000: sin advertencia.
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {} });
    expect(resumen.advertencias).toEqual([]);
    expect(resumen.errores).toBe(1); // sigue fallando por la base (db undefined) — la validación y la advertencia van ANTES de tocarla
  });
});
