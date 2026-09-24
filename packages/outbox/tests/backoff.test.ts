import { describe, expect, it } from "vitest";
import { backoff } from "../src/backoff.js";
import { ErrorOutbox } from "../src/errores.js";

const SIN_JITTER = { aleatorio: () => 0.5 }; // (aleatorio*2-1)*jitter = 0

describe("backoff", () => {
  it("intento 0, sin jitter, defaults: exactamente la base (30_000)", () => {
    expect(backoff(0, SIN_JITTER)).toBe(30_000);
  });

  it("crece exponencialmente con el factor (default 2)", () => {
    expect(backoff(1, SIN_JITTER)).toBe(60_000);
    expect(backoff(2, SIN_JITTER)).toBe(120_000);
    expect(backoff(3, SIN_JITTER)).toBe(240_000);
  });

  it("se recorta al tope, aunque el exponencial siga creciendo", () => {
    expect(backoff(10, SIN_JITTER)).toBe(3_600_000); // tope default (1h)
    expect(backoff(30, SIN_JITTER)).toBe(3_600_000);
  });

  it("base/factor/tope configurables", () => {
    expect(backoff(2, { base: 1000, factor: 3, tope: 10_000, jitter: 0, aleatorio: () => 0.5 })).toBe(9_000); // 1000*3^2
    expect(backoff(5, { base: 1000, factor: 3, tope: 10_000, jitter: 0, aleatorio: () => 0.5 })).toBe(10_000); // recortado al tope
  });

  it("factor 1: la espera no crece con el intento (solo varía por jitter)", () => {
    expect(backoff(0, { factor: 1, jitter: 0, aleatorio: () => 0.5 })).toBe(30_000);
    expect(backoff(5, { factor: 1, jitter: 0, aleatorio: () => 0.5 })).toBe(30_000);
  });

  it("jitter: aleatorio() = 0 da el mínimo del rango (base * (1 - jitter))", () => {
    expect(backoff(0, { jitter: 0.2, aleatorio: () => 0 })).toBe(24_000); // 30_000 * 0.8
  });

  it("jitter: aleatorio() cercano a 1 da cerca del máximo del rango (base * (1 + jitter))", () => {
    expect(backoff(0, { jitter: 0.2, aleatorio: () => 0.999999 })).toBeCloseTo(36_000, -1);
  });

  it("jitter 0: siempre el mismo valor, sin importar aleatorio()", () => {
    expect(backoff(1, { jitter: 0, aleatorio: () => 0 })).toBe(60_000);
    expect(backoff(1, { jitter: 0, aleatorio: () => 1 })).toBe(60_000);
  });

  it("nunca da negativo: jitter 1 con aleatorio() = 0 se recorta a 0", () => {
    expect(backoff(0, { jitter: 1, aleatorio: () => 0 })).toBe(0);
  });

  it("redondea a entero", () => {
    const ms = backoff(0, { base: 333, jitter: 0.13, aleatorio: () => 0.37 });
    expect(Number.isInteger(ms)).toBe(true);
  });

  it('"intento" negativo o no entero -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => backoff(-1)).toThrow(ErrorOutbox);
    expect(() => backoff(-1)).toThrow(/opciones_invalidas|intento/);
    expect(() => backoff(1.5)).toThrow(ErrorOutbox);
  });

  it('"base" <= 0 -> ErrorOutbox', () => {
    expect(() => backoff(0, { base: 0 })).toThrow(ErrorOutbox);
    expect(() => backoff(0, { base: -100 })).toThrow(ErrorOutbox);
  });

  it('"factor" < 1 -> ErrorOutbox', () => {
    expect(() => backoff(0, { factor: 0.5 })).toThrow(ErrorOutbox);
  });

  it('"tope" < "base" -> ErrorOutbox', () => {
    expect(() => backoff(0, { base: 1000, tope: 500 })).toThrow(ErrorOutbox);
  });

  it('"jitter" fuera de [0, 1] -> ErrorOutbox', () => {
    expect(() => backoff(0, { jitter: -0.1 })).toThrow(ErrorOutbox);
    expect(() => backoff(0, { jitter: 1.1 })).toThrow(ErrorOutbox);
  });

  it('cada error tiene codigo "opciones_invalidas"', () => {
    expect.assertions(2);
    try {
      backoff(-1);
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorOutbox);
      expect((error as ErrorOutbox).codigo).toBe("opciones_invalidas");
    }
  });
});
