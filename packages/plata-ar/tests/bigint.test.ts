import { describe, expect, it } from "vitest";
import { redondearComercial } from "../src/bigint.ts";
import { ErrorPlata } from "../src/errores.ts";

describe("redondearComercial", () => {
  it("medio hacia arriba para positivos", () => {
    expect(redondearComercial(5n, 2n)).toBe(3n); // 2,5 -> 3
  });

  it("medio hacia arriba (en valor absoluto) para negativos", () => {
    expect(redondearComercial(-5n, 2n)).toBe(-3n); // -2,5 -> -3
  });

  it("redondea para abajo cuando el resto es menos de la mitad", () => {
    expect(redondearComercial(23400n, 1000n)).toBe(23n); // 23,4 -> 23
  });

  it("redondea para arriba cuando el resto es la mitad o más", () => {
    expect(redondearComercial(1_062_030_570_000_000n, 100_000_000n)).toBe(10_620_306n); // 10.620.305,7 -> ...306
  });

  it("división exacta no cambia", () => {
    expect(redondearComercial(100n, 4n)).toBe(25n);
    expect(redondearComercial(-100n, 4n)).toBe(-25n);
  });

  it("tira ErrorPlata con denominador 0", () => {
    expect(() => redondearComercial(5n, 0n)).toThrow(ErrorPlata);
    try {
      redondearComercial(5n, 0n);
    } catch (e) {
      expect((e as ErrorPlata).codigo).toBe("division_por_cero");
    }
  });

  it("numerador cero da cero, con cualquier signo de denominador", () => {
    expect(redondearComercial(0n, 5n)).toBe(0n);
    expect(redondearComercial(0n, -5n)).toBe(0n);
  });

  it("denominador negativo se resuelve igual que uno positivo con el numerador de signo opuesto", () => {
    expect(redondearComercial(5n, -2n)).toBe(-3n);
    expect(redondearComercial(-5n, -2n)).toBe(3n);
  });
});
