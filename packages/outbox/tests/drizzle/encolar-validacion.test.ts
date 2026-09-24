import { describe, expect, it } from "vitest";
import { encolar } from "../../src/drizzle/encolar.js";

/**
 * `encolar` valida sus opciones ANTES de tocar `tx`/`tabla` (ver su JSDoc)
 * — estos tests lo prueban sin Postgres: pasan `tx`/`tabla` como
 * `undefined`, y si la función alguna vez llegara a usarlos antes de
 * validar, tiraría un error de runtime distinto (no un `ErrorOutbox`) y el
 * test fallaría igual, así que sirve como chequeo de que la validación de
 * verdad pasa primero.
 */
describe("encolar: valida las opciones antes de tocar tx/tabla", () => {
  const validas = {
    tenantId: "t1",
    canal: "correo" as const,
    destino: "a@b.com",
    plantilla: "p",
    claveIdempotencia: "k1",
  };

  it('"tenantId" vacío tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, tenantId: "" }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "opciones_invalidas" });
  });

  it('"tenantId" solo espacios tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, tenantId: "   " }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"canal" inválido tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, canal: "sms" as never }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"destino" vacío tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, destino: "" }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"plantilla" vacía tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, plantilla: "" }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"claveIdempotencia" vacía tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, claveIdempotencia: "" }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"claveIdempotencia" de más de 200 caracteres tira ErrorOutbox("opciones_invalidas") — L4 (junto con tenantId tiene que entrar en el límite de 256 de Resend)', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, claveIdempotencia: "x".repeat(201) }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"claveIdempotencia" de EXACTAMENTE 200 caracteres (el máximo válido) NO tira por validación', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, claveIdempotencia: "x".repeat(200) }),
    ).rejects.not.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"maxIntentos" no entero o < 1 tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, maxIntentos: 0 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, maxIntentos: 2.5 }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"maxIntentos" === 1 (el mínimo válido) NO tira por validación (pasa a exigirTransaccion, que sí falla por undefined)', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, maxIntentos: 1 }),
    ).rejects.not.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"programadoPara" inválido (Invalid Date) tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      encolar(undefined as never, undefined as never, { ...validas, programadoPara: new Date("no-es-una-fecha") }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it("con todas las opciones válidas, no tira por validación (pasa a exigirTransaccion, que sí falla por undefined)", async () => {
    await expect(encolar(undefined as never, undefined as never, validas)).rejects.not.toMatchObject({
      codigo: "opciones_invalidas",
    });
  });

  it("sin transacción real (tx = undefined) el error final es requiere_transaccion, no un TypeError de runtime", async () => {
    await expect(encolar(undefined as never, undefined as never, validas)).rejects.toMatchObject({
      name: "ErrorOutbox",
      codigo: "requiere_transaccion",
    });
  });
});
