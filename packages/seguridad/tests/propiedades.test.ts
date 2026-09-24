import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compararEnTiempoConstante } from "../src/comparar.js";
import { cifrar, descifrar } from "../src/cifrado.js";

/**
 * Genera strings a partir de code units UTF-16 arbitrarios (0x0000-0xFFFF),
 * INCLUYENDO surrogates sueltos (medio par) — a diferencia de `fc.string()`,
 * cuyas unidades por defecto ("grapheme"/"binary") evitan justamente los
 * surrogates sueltos. Es lo que hace falta para el fix round 1 (I3): probar
 * que `compararEnTiempoConstante` no colisiona con code units inválidos por
 * sí solos.
 */
const stringUtf16Arbitrario = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { minLength: 0, maxLength: 24 })
  .map((unidades) => String.fromCharCode(...unidades));

describe("propiedades: compararEnTiempoConstante", () => {
  it("compararEnTiempoConstante(a, b) === (a === b && a.length > 0), para cualquier par de strings (incl. largos distintos y surrogates sueltos)", () => {
    // La excepción `&& a.length > 0` es a propósito (fix round 1, I3): un
    // secreto vacío nunca "coincide", ni siquiera contra otro vacío — ver
    // el comentario en src/comparar.ts.
    fc.assert(
      fc.property(stringUtf16Arbitrario, stringUtf16Arbitrario, (a, b) => {
        expect(compararEnTiempoConstante(a, b)).toBe(a === b && a.length > 0);
      }),
    );
  });

  it("compararEnTiempoConstante(a, a) da true para cualquier string NO vacío (incl. surrogates sueltos)", () => {
    fc.assert(
      fc.property(stringUtf16Arbitrario.filter((a) => a.length > 0), (a) => {
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
