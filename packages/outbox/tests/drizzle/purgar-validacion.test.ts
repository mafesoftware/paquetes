import { describe, expect, it } from "vitest";
import { purgarOutbox } from "../../src/drizzle/purgar.js";

/**
 * `purgarOutbox` valida sus opciones ANTES de tocar `db`/`tabla` — estos
 * tests lo prueban sin Postgres, pasando `db`/`tabla` como `undefined`: si
 * la validación no corriera primero, fallaría con un error de runtime
 * distinto (no un `ErrorOutbox`).
 */
describe("purgarOutbox: valida las opciones antes de tocar db/tabla", () => {
  it('"estados" vacío ([]) tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, estados: [], antesDe: new Date() }),
    ).rejects.toMatchObject({ name: "ErrorOutbox", codigo: "opciones_invalidas" });
  });

  it('"estados" con un valor NO terminal ("pendiente"/"procesando") tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, estados: ["pendiente"], antesDe: new Date() }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, estados: ["procesando"], antesDe: new Date() }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"estados" mezclando un terminal válido y uno inválido igual tira (todo-o-nada)', async () => {
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, estados: ["enviado", "pendiente"], antesDe: new Date() }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it('"antesDe" que no es un Date, o un Date inválido, tira ErrorOutbox("opciones_invalidas")', async () => {
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, antesDe: "2026-01-01" as never }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, antesDe: new Date("no-es-una-fecha") }),
    ).rejects.toMatchObject({ codigo: "opciones_invalidas" });
  });

  it("con opciones válidas (estados por defecto), la validación deja pasar (el siguiente fallo es de tocar la base)", async () => {
    await expect(
      purgarOutbox({ db: undefined as never, tabla: undefined as never, antesDe: new Date() }),
    ).rejects.not.toMatchObject({ codigo: "opciones_invalidas" });
  });
});
