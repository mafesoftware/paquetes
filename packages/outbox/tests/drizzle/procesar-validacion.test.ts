import { describe, expect, it, vi } from "vitest";
import { procesarOutbox } from "../../src/drizzle/procesar.js";

/**
 * `procesarOutbox` valida sus opciones ANTES de tocar `db`/`tabla` — estos
 * tests lo prueban sin Postgres, con `db`/`tabla` como `undefined`: si
 * `procesarOutbox` alguna vez intentara usarlos antes de validar, tiraría
 * un error de runtime distinto (no un `ErrorOutbox`) y el test fallaría
 * igual.
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

  it('"transportes.correo"/"transportes.whatsapp" (si se pasan) tienen que ser funciones', async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { correo: "no-es-funcion" as never } }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { whatsapp: 123 as never } }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it("transportes: {} (ningún canal configurado) no tira por validación — es válido, cada mensaje se descarta en su momento", async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: {}, lote: 1 }),
    ).rejects.not.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it("con opciones válidas, la validación deja pasar (el siguiente fallo es de db.transaction sobre undefined, no de validación)", async () => {
    await expect(
      procesarOutbox({ db: undefined as never, tabla: undefined as never, transportes: { correo: vi.fn() } }),
    ).rejects.not.toMatchObject({ codigo: "opciones_invalidas" });
  });
});
