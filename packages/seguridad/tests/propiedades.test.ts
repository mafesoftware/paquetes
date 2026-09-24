import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compararEnTiempoConstante } from "../src/comparar.js";
import { cifrar, descifrar } from "../src/cifrado.js";

describe("propiedades: compararEnTiempoConstante", () => {
  it("compararEnTiempoConstante(a, b) === (a === b), para cualquier par de strings (incl. largos distintos)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(compararEnTiempoConstante(a, b)).toBe(a === b);
      }),
    );
  });

  it("compararEnTiempoConstante(a, a) siempre da true", () => {
    fc.assert(
      fc.property(fc.string(), (a) => {
        expect(compararEnTiempoConstante(a, a)).toBe(true);
      }),
    );
  });
});

describe("propiedades: cifrar / descifrar", () => {
  const clave = randomBytes(32).toString("base64");

  it("descifrar(cifrar(x)) === x, para cualquier string (incl. unicode y vacío)", () => {
    fc.assert(
      fc.property(fc.string(), (texto) => {
        expect(descifrar(cifrar(texto, clave), clave)).toBe(texto);
      }),
    );
  });

  it("descifrar(cifrar(x)) === x, con caracteres unicode explícitos (emoji, acentos, CJK, RTL)", () => {
    // fast-check v4 unificó los generadores de string: `fc.string()` ya
    // genera todo el rango unicode por defecto (no hay `unicodeString`
    // separado). Se fija acá con casos concretos para que quede documentado
    // qué exactamente prueba "unicode", más allá de lo que fc.string() al
    // azar termine generando.
    const casos = ["café", "🔐🔑", "日本語", "مرحبا", "Ñoño", "á", "𝔘𝔫𝔦𝔠𝔬𝔡𝔢"];
    for (const texto of casos) {
      expect(descifrar(cifrar(texto, clave), clave)).toBe(texto);
    }
  });
});
