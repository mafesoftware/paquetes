import { describe, expect, it } from "vitest";
import { parsearImporte } from "../src/parseo.ts";

describe("parsearImporte", () => {
  it('"44.000" -> 4.400.000 centavos (cuarenta y cuatro mil pesos)', () => {
    expect(parsearImporte("44.000")).toEqual({ ok: true, centavos: 4_400_000n });
  });

  it('"44.000,50" -> 4.400.050 centavos', () => {
    expect(parsearImporte("44.000,50")).toEqual({ ok: true, centavos: 4_400_050n });
  });

  it('"1,234" -> 123 centavos (coma decimal en es-AR: 1,234 pesos)', () => {
    expect(parsearImporte("1,234")).toEqual({ ok: true, centavos: 123n });
  });

  it('"1.2.3,4" -> error (miles mal agrupados)', () => {
    const resultado = parsearImporte("1.2.3,4");
    expect(resultado.ok).toBe(false);
  });

  it("nunca tira: string vacío, basura, símbolos sueltos", () => {
    for (const texto of ["", "abc", "$", "--5", "1,2,3", "1..2", "12-34", "1,2.3", ".123", "123."]) {
      const resultado = parsearImporte(texto);
      expect(resultado.ok, `"${texto}"`).toBe(false);
    }
  });

  it("nunca tira ni con un valor que no es string (uso indebido en tiempo de ejecución)", () => {
    expect(parsearImporte(null as unknown as string).ok).toBe(false);
    expect(parsearImporte(undefined as unknown as string).ok).toBe(false);
  });

  it("acepta negativos por defecto", () => {
    expect(parsearImporte("-500")).toEqual({ ok: true, centavos: -50_000n });
  });

  it("permitirNegativo:false rechaza un negativo", () => {
    const resultado = parsearImporte("-500", { permitirNegativo: false });
    expect(resultado.ok).toBe(false);
  });

  it('"1234.56" (planilla en inglés) -> 123.456 centavos', () => {
    expect(parsearImporte("1234.56")).toEqual({ ok: true, centavos: 123_456n });
  });

  it("un símbolo de moneda no rompe el parseo", () => {
    expect(parsearImporte("$ 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
  });

  it("varios grupos de miles", () => {
    expect(parsearImporte("1.234.000")).toEqual({ ok: true, centavos: 123_400_000n });
  });

  it("montos absurdamente grandes no rompen (bigint sin límite práctico)", () => {
    const resultado = parsearImporte("99999999999999999999");
    expect(resultado).toEqual({ ok: true, centavos: 9_999_999_999_999_999_999_900n });
  });
});
