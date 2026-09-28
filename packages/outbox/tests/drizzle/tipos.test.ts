import { describe, expect, expectTypeOf, it } from "vitest";
import { ErrorOutbox as ErrorOutboxDelNucleo } from "../../src/errores.js";
import { ErrorOutbox as ErrorOutboxDeDrizzle, encolar } from "../../src/drizzle/index.js";
import type { DbCliente } from "../../src/drizzle/cliente.js";
import type { Transaccion } from "../../src/drizzle/transaccion.js";

/**
 * Tipos: `encolar` exige `Transaccion` (la `tx` de `db.transaction(async
 * (tx) => ...)`), no `DbCliente` (el `db` de nivel superior) — así pasarle
 * `db` a secas falla en TIEMPO DE COMPILACIÓN, no solo en runtime contra
 * `exigirTransaccion` (ver esa prueba en `postgres.test.ts`, con
 * `@ts-expect-error` sobre la misma llamada real).
 *
 * NO toca Postgres ni ejecuta `encolar` de verdad: son chequeos de TIPOS
 * únicamente (`expectTypeOf`, y una función nunca invocada para el
 * `@ts-expect-error` de abajo).
 */
describe("Transaccion (tipos)", () => {
  it("Transaccion es asignable donde se pide DbCliente (una tx ES-UN db)", () => {
    expectTypeOf<Transaccion>().toExtend<DbCliente>();
  });

  it("DbCliente NO es asignable donde se pide Transaccion (el db de nivel superior no alcanza)", () => {
    expectTypeOf<DbCliente>().not.toExtend<Transaccion>();
  });

  it("el primer parámetro de encolar es Transaccion, no DbCliente", () => {
    expectTypeOf(encolar).parameter(0).toEqualTypeOf<Transaccion>();
  });

  it("encolar(db, ...) con el db de nivel superior (no una tx) no compila", () => {
    // Nunca se llama: solo existe para que tsc typechequee su cuerpo. Si
    // `nuncaSeLlama` se invocara de verdad, `encolar` tiraría al acceder a
    // `opciones.tenantId` (los parámetros de abajo son solo para el tipo).
    function nuncaSeLlama(db: DbCliente, tabla: Parameters<typeof encolar>[1], opciones: Parameters<typeof encolar>[2]) {
      // @ts-expect-error encolar exige Transaccion, no DbCliente — ver el JSDoc de arriba.
      return encolar(db, tabla, opciones);
    }
    expectTypeOf(nuncaSeLlama).toBeFunction();
  });
});

describe("ErrorOutbox: mismo instanceof desde el núcleo y desde /drizzle", () => {
  it("es la MISMA clase, no dos independientes", () => {
    expect(ErrorOutboxDeDrizzle).toBe(ErrorOutboxDelNucleo);

    const error = new ErrorOutboxDelNucleo("requiere_transaccion", "x");
    expect(error).toBeInstanceOf(ErrorOutboxDelNucleo);
    expect(error).toBeInstanceOf(ErrorOutboxDeDrizzle);
  });
});
