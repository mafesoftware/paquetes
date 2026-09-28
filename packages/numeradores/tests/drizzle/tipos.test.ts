import { describe, expect, expectTypeOf, it } from "vitest";
import { ErrorNumeradores as ErrorNumeradoresDelNucleo } from "../../src/errores.js";
import { ErrorNumeradores as ErrorNumeradoresDeDrizzle, configurarNumerador, siguienteNumero } from "../../src/drizzle/index.js";
import type { DbCliente } from "../../src/drizzle/cliente.js";
import type { Transaccion } from "../../src/drizzle/transaccion.js";

/**
 * Tipos: `siguienteNumero` exige `Transaccion` (la `tx` de
 * `db.transaction(async (tx) => ...)`), no `DbCliente` (el `db` de nivel
 * superior) — así pasarle `db` a secas falla en TIEMPO DE COMPILACIÓN, no
 * solo en runtime contra `exigirTransaccion` (ver esa prueba en
 * `postgres.test.ts`, con `@ts-expect-error` sobre la misma llamada real).
 *
 * `configurarNumerador`, en cambio, NO exige transacción: su primer
 * parámetro (renombrado de `tx` a `db`) acepta tanto `db` como una `tx`.
 *
 * NO toca Postgres ni ejecuta ninguna de las dos de verdad: son chequeos de
 * TIPOS únicamente.
 */
describe("Transaccion (tipos)", () => {
  it("Transaccion es asignable donde se pide DbCliente (una tx ES-UN db)", () => {
    expectTypeOf<Transaccion>().toExtend<DbCliente>();
  });

  it("DbCliente NO es asignable donde se pide Transaccion (el db de nivel superior no alcanza)", () => {
    expectTypeOf<DbCliente>().not.toExtend<Transaccion>();
  });

  it("el primer parámetro de siguienteNumero es Transaccion, no DbCliente", () => {
    expectTypeOf(siguienteNumero).parameter(0).toEqualTypeOf<Transaccion>();
  });

  it("el primer parámetro de configurarNumerador es DbCliente (acepta db Y tx, no exige transacción)", () => {
    expectTypeOf(configurarNumerador).parameter(0).toEqualTypeOf<DbCliente>();
    // Una Transaccion (más estricta) también sirve donde se pide DbCliente.
    expectTypeOf<Transaccion>().toExtend<Parameters<typeof configurarNumerador>[0]>();
  });

  it("siguienteNumero(db, ...) con el db de nivel superior (no una tx) no compila", () => {
    // Nunca se llama: solo existe para que tsc typechequee su cuerpo. Si
    // `nuncaSeLlama` se invocara de verdad, `siguienteNumero` tiraría al
    // ejecutar la consulta contra una conexión falsa.
    function nuncaSeLlama(
      db: DbCliente,
      tabla: Parameters<typeof siguienteNumero>[1],
      opciones: Parameters<typeof siguienteNumero>[2],
    ) {
      // @ts-expect-error siguienteNumero exige Transaccion, no DbCliente — ver el JSDoc de arriba.
      return siguienteNumero(db, tabla, opciones);
    }
    expectTypeOf(nuncaSeLlama).toBeFunction();
  });
});

describe("ErrorNumeradores: mismo instanceof desde el núcleo y desde /drizzle", () => {
  it("es la MISMA clase, no dos independientes", () => {
    expect(ErrorNumeradoresDeDrizzle).toBe(ErrorNumeradoresDelNucleo);

    const error = new ErrorNumeradoresDelNucleo("requiere_transaccion", "x");
    expect(error).toBeInstanceOf(ErrorNumeradoresDelNucleo);
    expect(error).toBeInstanceOf(ErrorNumeradoresDeDrizzle);
  });
});
