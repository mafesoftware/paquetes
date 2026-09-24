import { describe, expect, it } from "vitest";
import { parsearImporte, LONGITUD_MAXIMA_IMPORTE } from "../src/parseo.ts";
import { escanearImporte } from "../src/importe-scanner.ts";

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

    it("decimalConPunto:true sin punto es un entero simple", () => {
      expect(parsearImporte("500", { decimalConPunto: true })).toEqual({ ok: true, centavos: 50_000n });
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

  describe("N1: el token de moneda y el signo solo valen como prefijo/sufijo alrededor del número, nunca adentro", () => {
    it("token metido en el medio de los dígitos -> error", () => {
      for (const texto of ["1$2", "1usd2", "12 ARS 34"]) {
        expect(parsearImporte(texto).ok, `"${texto}"`).toBe(false);
      }
    });

    it("dos grupos de dígitos separados por espacio (sin token) -> error", () => {
      for (const texto of ["2 3", "10 50"]) {
        expect(parsearImporte(texto).ok, `"${texto}"`).toBe(false);
      }
    });

    it("token y signo como prefijo, en cualquier orden y con espacios sueltos, siguen valiendo", () => {
      expect(parsearImporte("$ -1.000")).toEqual({ ok: true, centavos: -100_000n });
      expect(parsearImporte("- 5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("-$ 5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("US$1.000,5")).toEqual({ ok: true, centavos: 100_050n });
    });

    it("token como sufijo (con espacio antes) sigue valiendo", () => {
      expect(parsearImporte("1.000,50 ARS")).toEqual({ ok: true, centavos: 100_050n });
    });
  });

  describe("B1: tope de longitud + escaneo lineal (sin backtracking cuadrático)", () => {
    it(`textos de más de ${LONGITUD_MAXIMA_IMPORTE} caracteres se rechazan, rápido, sin importar cuántos`, () => {
      for (const n of [5_000, 10_000, 20_000, 40_000, 50_000]) {
        const texto = " ".repeat(n) + "x";
        const inicio = performance.now();
        const resultado = parsearImporte(texto);
        const duracion = performance.now() - inicio;
        expect(resultado.ok, `n=${n}`).toBe(false);
        expect(duracion, `n=${n} tardó ${duracion.toFixed(1)}ms`).toBeLessThan(50);
      }
    });

    it('"$" + 50.000 espacios + "x" se rechaza rápido (el tope corta antes de escanear)', () => {
      const texto = "$" + " ".repeat(50_000) + "x";
      const inicio = performance.now();
      const resultado = parsearImporte(texto);
      const duracion = performance.now() - inicio;
      expect(resultado.ok).toBe(false);
      expect(duracion).toBeLessThan(50);
    });

    it('"5" + 50.000 espacios + "x" se rechaza rápido', () => {
      const texto = "5" + " ".repeat(50_000) + "x";
      const inicio = performance.now();
      const resultado = parsearImporte(texto);
      const duracion = performance.now() - inicio;
      expect(resultado.ok).toBe(false);
      expect(duracion).toBeLessThan(50);
    });

    it("el escáner interno (escanearImporte), sin pasar por el tope de longitud, también es lineal", () => {
      // Prueba la propiedad de fondo (B1b), no solo el tope (B1a): un texto
      // de 50.000 caracteres, escaneado directo, tiene que resolver rápido
      // porque el algoritmo es O(n) de una sola pasada -- no porque algo
      // más arriba lo haya cortado antes.
      for (const texto of [
        " ".repeat(50_000) + "x",
        "$" + " ".repeat(50_000) + "x",
        "5" + " ".repeat(50_000) + "x",
      ]) {
        const inicio = performance.now();
        const resultado = escanearImporte(texto);
        const duracion = performance.now() - inicio;
        expect(resultado).toBeNull();
        expect(duracion, `tardó ${duracion.toFixed(1)}ms`).toBeLessThan(50);
      }
    });
  });

  describe("B2: como mucho UN token de moneda en total (prefijo O sufijo, nunca los dos)", () => {
    it("dos tokens (dos prefijos, o prefijo+sufijo) -> error", () => {
      for (const texto of ["$$5", "$-$5", "$ 5 $", "ARS5USD", "US$ 1.000,00 USD"]) {
        expect(parsearImporte(texto).ok, `"${texto}"`).toBe(false);
      }
    });

    it("un solo token, en cualquier posición/orden válida, sigue pasando", () => {
      expect(parsearImporte("$ -1.000")).toEqual({ ok: true, centavos: -100_000n });
      expect(parsearImporte("- 5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("US$1.000,5")).toEqual({ ok: true, centavos: 100_050n });
      expect(parsearImporte("1.000,50 ARS")).toEqual({ ok: true, centavos: 100_050n });
      expect(parsearImporte("-$ 5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("ARS-5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("-ARS 5")).toEqual({ ok: true, centavos: -500n });
      expect(parsearImporte("usd5")).toEqual({ ok: true, centavos: 500n });
    });

    it("tabs, saltos de línea y NBSP alrededor del número siguen valiendo como espacio", () => {
      expect(parsearImporte("\t5\t")).toEqual({ ok: true, centavos: 500n });
      expect(parsearImporte("\n5\n")).toEqual({ ok: true, centavos: 500n });
      expect(parsearImporte(" 5 ")).toEqual({ ok: true, centavos: 500n });
      expect(parsearImporte("$\t5")).toEqual({ ok: true, centavos: 500n });
      expect(parsearImporte("5\tARS")).toEqual({ ok: true, centavos: 500n });
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
