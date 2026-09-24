import { describe, expect, it } from "vitest";
import { configurarNumerador } from "../../src/drizzle/configurar-numerador.js";

/**
 * `configurarNumerador` valida `proximo`/`relleno` ANTES de tocar la base
 * (ver su JSDoc) — estos tests lo prueban sin Postgres: pasan `tx`/`tabla`
 * como `undefined`, y si la función alguna vez llegara a usarlos antes de
 * validar, tiraría un error de runtime distinto (no un `ErrorNumeradores`)
 * y el test fallaría igual, así que sirve como chequeo de que la
 * validación de verdad pasa primero.
 */
describe("configurarNumerador: valida proximo/relleno antes de tocar la base", () => {
  it('proximo === 0n tira ErrorNumeradores("proximo_invalido")', async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", proximo: 0n }),
    ).rejects.toMatchObject({ name: "ErrorNumeradores", codigo: "proximo_invalido" });
  });

  it('proximo negativo tira ErrorNumeradores("proximo_invalido")', async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", proximo: -5n }),
    ).rejects.toMatchObject({ name: "ErrorNumeradores", codigo: "proximo_invalido" });
  });

  it("proximo === 1n (el mínimo válido) NO tira por validación (pasa a intentar usar la base, que sí falla por undefined — prueba que la validación lo dejó pasar)", async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", proximo: 1n }),
    ).rejects.not.toMatchObject({ codigo: "proximo_invalido" });
  });

  it('relleno negativo tira ErrorNumeradores("relleno_invalido")', async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", relleno: -1 }),
    ).rejects.toMatchObject({ name: "ErrorNumeradores", codigo: "relleno_invalido" });
  });

  it('relleno no entero (2.5) tira ErrorNumeradores("relleno_invalido")', async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", relleno: 2.5 }),
    ).rejects.toMatchObject({ name: "ErrorNumeradores", codigo: "relleno_invalido" });
  });

  it("relleno === 0 (el mínimo válido) NO tira por validación", async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo", relleno: 0 }),
    ).rejects.not.toMatchObject({ codigo: "relleno_invalido" });
  });

  it("sin proximo ni relleno, no valida nada (pasa directo a intentar usar la base)", async () => {
    await expect(
      configurarNumerador(undefined as never, undefined as never, { tenantId: "t", tipo: "recibo" }),
    ).rejects.not.toMatchObject({ codigo: "proximo_invalido" });
  });
});
