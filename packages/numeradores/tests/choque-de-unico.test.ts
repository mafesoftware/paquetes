import { describe, expect, it } from "vitest";
import { esChoqueDeUnico } from "../src/choque-de-unico.js";

/**
 * Un error cuyo `code` (si `conCodigo` es `true`) vive en el error MÁS
 * INTERNO de una cadena de `.cause`, a `profundidad` niveles del error
 * devuelto (que es el más externo, profundidad 0). `esChoqueDeUnico` recibe
 * siempre el externo, como recibiría el error de más afuera que tira un
 * driver real.
 */
function cadenaConCodigoEnProfundidad(profundidad: number, conCodigo = true): Error {
  let actual: Error = conCodigo
    ? Object.assign(new Error(`profundidad ${profundidad}`), { code: "23505" })
    : new Error(`profundidad ${profundidad}`);
  for (let nivel = profundidad - 1; nivel >= 0; nivel--) {
    actual = new Error(`profundidad ${nivel}`, { cause: actual });
  }
  return actual;
}

describe("esChoqueDeUnico", () => {
  it("false para valores no-error (null, undefined, string, number)", () => {
    expect(esChoqueDeUnico(null)).toBe(false);
    expect(esChoqueDeUnico(undefined)).toBe(false);
    expect(esChoqueDeUnico("23505")).toBe(false);
    expect(esChoqueDeUnico(42)).toBe(false);
  });

  it("true si el error mismo tiene code 23505", () => {
    const error = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(esChoqueDeUnico(error)).toBe(true);
  });

  it("false si el código es otro (ej. 23503, foreign_key_violation)", () => {
    const error = Object.assign(new Error("fk violation"), { code: "23503" });
    expect(esChoqueDeUnico(error)).toBe(false);
  });

  it("encuentra el 23505 en error.cause (drizzle envuelve el error de Postgres así)", () => {
    const original = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const envuelto = new Error("Failed query: insert into ...", { cause: original });
    expect(esChoqueDeUnico(envuelto)).toBe(true);
  });

  it("encuentra el 23505 varios niveles adentro de la cadena de cause", () => {
    const cadena = cadenaConCodigoEnProfundidad(5);
    expect(esChoqueDeUnico(cadena)).toBe(true);
  });

  it("respeta el límite de profundidad 10: lo encuentra si el code está justo en el nivel 10 (borde permitido)", () => {
    const cadena = cadenaConCodigoEnProfundidad(10);
    expect(esChoqueDeUnico(cadena)).toBe(true);
  });

  it("no lo encuentra si el code está MÁS ALLÁ del nivel 10", () => {
    const cadena = cadenaConCodigoEnProfundidad(11);
    expect(esChoqueDeUnico(cadena)).toBe(false);
  });

  it("una cadena de causas sin ningún 23505 da false", () => {
    const cadena = cadenaConCodigoEnProfundidad(5, false);
    expect(esChoqueDeUnico(cadena)).toBe(false);
  });

  it("una cadena de cause circular no cuelga (el límite de profundidad la corta)", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b: { message: string; cause?: unknown } = { message: "b", cause: a };
    a.cause = b; // ciclo a -> b -> a -> b -> ...
    expect(esChoqueDeUnico(a)).toBe(false);
  });

  it("encuentra el 23505 adentro de un AggregateError.errors", () => {
    const original = Object.assign(new Error("duplicate key"), { code: "23505" });
    const otro = new Error("otro intento, sin código útil");
    const agregado = new AggregateError([otro, original], "varios intentos fallaron");
    expect(esChoqueDeUnico(agregado)).toBe(true);
  });

  it("false si ningún error interno del AggregateError tiene 23505", () => {
    const agregado = new AggregateError([new Error("a"), new Error("b")], "varios intentos fallaron");
    expect(esChoqueDeUnico(agregado)).toBe(false);
  });

  it("encuentra el 23505 en la cause de un error DENTRO de un AggregateError (combinación)", () => {
    const original = Object.assign(new Error("duplicate key"), { code: "23505" });
    const envuelto = new Error("Failed query: ...", { cause: original });
    const agregado = new AggregateError([new Error("sin nada"), envuelto], "varios intentos");
    expect(esChoqueDeUnico(agregado)).toBe(true);
  });
});
