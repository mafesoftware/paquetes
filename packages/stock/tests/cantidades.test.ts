import { describe, expect, it } from "vitest";
import { multiplicar, sumarCantidades } from "../src/cantidades.js";

describe("multiplicar", () => {
  it("cantidad × precio unitario, redondeo comercial al centavo", () => {
    expect(multiplicar("2.5", 1_000n)).toBe(2_500n);
    expect(multiplicar("0.3333", 3n)).toBe(1n); // 0.9999 → redondea a 1
  });

  it("cantidad inválida (más de 4 decimales o formato raro) → tira", () => {
    expect(() => multiplicar("1.23456", 100n)).toThrow();
    expect(() => multiplicar("abc", 100n)).toThrow();
  });
});

describe("sumarCantidades", () => {
  it("suma exacta a 4 decimales", () => {
    expect(sumarCantidades(["100", "50.5", "-0.25"])).toBe("150.2500");
  });

  it("lista vacía → 0", () => {
    expect(sumarCantidades([])).toBe("0.0000");
  });
});
