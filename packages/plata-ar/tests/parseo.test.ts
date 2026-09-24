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

  describe("R2: modo estricto es-AR por defecto -- un punto SIEMPRE es separador de miles", () => {
    it('"1.50" -> error (no es un decimal: "50" no son 3 dígitos de un grupo de miles)', () => {
      expect(parsearImporte("1.50").ok).toBe(false);
    });

    it('"1234.56" -> error (un punto nunca es decimal acá; antes SÍ se aceptaba, ya no)', () => {
      expect(parsearImporte("1234.56").ok).toBe(false);
    });

    it('opciones.decimalConPunto:true habilita la convención en inglés', () => {
      expect(parsearImporte("1234.56", { decimalConPunto: true })).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("44000.5", { decimalConPunto: true })).toEqual({ ok: true, centavos: 4_400_050n });
      expect(parsearImporte("1.50", { decimalConPunto: true })).toEqual({ ok: true, centavos: 150n });
    });

    it("decimalConPunto:true no acepta coma", () => {
      expect(parsearImporte("1,234", { decimalConPunto: true }).ok).toBe(false);
    });

    it("decimalConPunto:true rechaza más de un punto", () => {
      expect(parsearImporte("1.2.3", { decimalConPunto: true }).ok).toBe(false);
    });

    it("las reglas verbatim del brief siguen valiendo en modo estricto", () => {
      expect(parsearImporte("44.000")).toEqual({ ok: true, centavos: 4_400_000n });
      expect(parsearImporte("44.000,50")).toEqual({ ok: true, centavos: 4_400_050n });
      expect(parsearImporte("1,234")).toEqual({ ok: true, centavos: 123n });
      expect(parsearImporte("1.2.3,4").ok).toBe(false);
    });
  });

  describe("I5: solo dígitos, un '-' inicial, '.', ',', espacios y símbolos/códigos de moneda", () => {
    it('"1e3" no se lee como "13" (o como 1300 centavos): notación exponencial no es un importe', () => {
      const resultado = parsearImporte("1e3");
      expect(resultado.ok).toBe(false);
    });

    it('"(500)" no se lee como 500: los paréntesis no son parte de un importe', () => {
      expect(parsearImporte("(500)").ok).toBe(false);
    });

    it("letras sueltas mezcladas con dígitos son inválidas", () => {
      for (const texto of ["12abc34", "2x3", "500ARS!", "1_000"]) {
        expect(parsearImporte(texto).ok, `"${texto}"`).toBe(false);
      }
    });

    it("símbolos/códigos de moneda tolerados: $, US$, U$S, ARS, USD, EUR, €", () => {
      expect(parsearImporte("$ 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("US$1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("U$S 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("ARS 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("USD 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("EUR 1.234,56")).toEqual({ ok: true, centavos: 123_456n });
      expect(parsearImporte("€1.234,56")).toEqual({ ok: true, centavos: 123_456n });
    });
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

  it("varios grupos de miles", () => {
    expect(parsearImporte("1.234.000")).toEqual({ ok: true, centavos: 123_400_000n });
  });

  it("montos absurdamente grandes no rompen (bigint sin límite práctico)", () => {
    const resultado = parsearImporte("99999999999999999999");
    expect(resultado).toEqual({ ok: true, centavos: 9_999_999_999_999_999_999_900n });
  });
});
