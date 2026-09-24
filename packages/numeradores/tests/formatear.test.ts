import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatearNumero } from "../src/formatear.js";

describe("formatearNumero", () => {
  it("sin opciones: el número tal cual, sin relleno ni prefijo/sufijo", () => {
    expect(formatearNumero(42n)).toBe("42");
    expect(formatearNumero(0n)).toBe("0");
  });

  it("rellena con ceros a la izquierda hasta `relleno` dígitos", () => {
    expect(formatearNumero(7n, { relleno: 4 })).toBe("0007");
    expect(formatearNumero(0n, { relleno: 3 })).toBe("000");
  });

  it("prefijo y sufijo van tal cual, alrededor del número ya rellenado", () => {
    expect(formatearNumero(3n, { prefijo: "OP-", relleno: 6, sufijo: "-A" })).toBe("OP-000003-A");
    expect(formatearNumero(1n, { prefijo: "F" })).toBe("F1");
  });

  it('el caso del brief: (699401n, {prefijo:"R-", relleno:4}) -> "R-699401"', () => {
    expect(formatearNumero(699401n, { prefijo: "R-", relleno: 4 })).toBe("R-699401");
  });

  it("NUNCA trunca: un número más largo que `relleno` sale entero (a diferencia del lpad de Postgres)", () => {
    // El bug real que motivó esto: numeracion.ts de store360 documentaba
    // (mal) que su lpad "dejaba pasar los números más largos enteros", y en
    // realidad lpad('10000', 4, '0') trunca a '1000'. formatearNumero no usa
    // lpad de SQL — usa String.prototype.padStart, que solo agrega, nunca
    // corta.
    expect(formatearNumero(10000n, { relleno: 4 })).toBe("10000");
    expect(formatearNumero(123456789n, { relleno: 2 })).toBe("123456789");
  });

  it("relleno 0 (o sin pasar la opción) no agrega ceros de más a un número corto", () => {
    expect(formatearNumero(5n, { relleno: 0 })).toBe("5");
  });

  it("property: el resultado siempre contiene los dígitos exactos de n, y nunca es más corto que `relleno` + prefijo + sufijo", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 12 }),
        fc.string({ maxLength: 5 }),
        fc.string({ maxLength: 5 }),
        (n, relleno, prefijo, sufijo) => {
          const resultado = formatearNumero(n, { prefijo, relleno, sufijo });
          expect(resultado.startsWith(prefijo)).toBe(true);
          expect(resultado.endsWith(sufijo)).toBe(true);
          const nucleo = resultado.slice(prefijo.length, resultado.length - sufijo.length);
          expect(nucleo).toContain(n.toString());
          expect(nucleo.length).toBeGreaterThanOrEqual(Math.max(relleno, n.toString().length));
        },
      ),
    );
  });
});
