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

  it('"timeoutMs" <= 0 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 1000, timeoutMs: 0 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"timeoutMs" >= "leaseMs" tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 1000, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 1000, timeoutMs: 1500 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"timeoutMs" por defecto (Math.floor(leaseMs/2)) no tira por validación', async () => {
    // leaseMs impar: Math.floor(1001/2) = 500, que es < 1001 — la
    // validación de "timeoutMs" lo deja pasar (el resumen igual refleja el
    // fallo de la base en "errores", ya que db es undefined — lo que
    // importa acá es que la promesa NO haya rechazado con
    // "opciones_invalidas").
    const resumen = await procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, leaseMs: 1001 });
    expect(resumen.errores).toBe(1);
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
});
