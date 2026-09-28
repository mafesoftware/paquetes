import { describe, expect, it } from "vitest";
import { enteroPositivo } from "../src/validaciones.js";
import { ErrorLimiteIntentos } from "../src/errores.js";

describe("enteroPositivo", () => {
  it("devuelve el valor si es un entero >= 1", () => {
    expect(enteroPositivo(1, "maximo", "registrarIntento")).toBe(1);
    expect(enteroPositivo(900_000, "ventanaMs", "registrarIntento")).toBe(900_000);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    "%s tira ErrorLimiteIntentos(\"opciones_invalidas\") con el nombre de la opción y la función en el mensaje",
    (valor) => {
      expect(() => enteroPositivo(valor, "bloqueoMs", "registrarIntento")).toThrow(ErrorLimiteIntentos);
      try {
        enteroPositivo(valor, "bloqueoMs", "registrarIntento");
      } catch (error) {
        expect(error).toMatchObject({ name: "ErrorLimiteIntentos", codigo: "opciones_invalidas" });
        expect((error as ErrorLimiteIntentos).message).toContain("bloqueoMs");
        expect((error as ErrorLimiteIntentos).message).toContain("registrarIntento");
      }
    },
  );
});
