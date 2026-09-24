import { describe, expect, it } from "vitest";
import { compararEnTiempoConstante } from "../src/comparar.js";

describe("compararEnTiempoConstante", () => {
  it("da true para secretos iguales", () => {
    expect(compararEnTiempoConstante("un-secreto", "un-secreto")).toBe(true);
  });

  it("da false para secretos distintos del mismo largo", () => {
    expect(compararEnTiempoConstante("un-secreto", "otro-secr3to")).toBe(false);
  });

  it("da false para secretos de largo distinto, sin tirar", () => {
    expect(compararEnTiempoConstante("corto", "mucho-mas-largo-que-corto")).toBe(false);
  });

  it("da false si CUALQUIERA de los dos lados está vacío, incluso los dos a la vez", () => {
    expect(compararEnTiempoConstante("", "")).toBe(false);
    expect(compararEnTiempoConstante("", "algo")).toBe(false);
    expect(compararEnTiempoConstante("algo", "")).toBe(false);
  });

  it("no tira con null/undefined/number (llamadas desde JS sin chequeo de tipos): false, nunca los trata como string vacío", () => {
    // Fix round 1 (C2/I3 del review): antes `String(a ?? "")` convertía
    // `undefined` en `""`, y como `("", "")` daba `true`, un secreto NO
    // CONFIGURADO (`undefined`) "coincidía" con un string vacío mandado por
    // quien ataca. Ahora cualquier no-string es `false`, sin excepción.
    expect(compararEnTiempoConstante(null as never, "a")).toBe(false);
    expect(compararEnTiempoConstante(undefined as never, undefined as never)).toBe(false);
    expect(compararEnTiempoConstante(undefined as never, "")).toBe(false);
    expect(compararEnTiempoConstante(42 as never, "42")).toBe(false);
  });

  it("compara por bytes UTF-8... no: por code units UTF-16, no por caracteres JS", () => {
    // "café" en NFC (1 solo codepoint para "é") vs. la misma palabra con la
    // "é" en dos codepoints (NFD): mismo texto visualmente, code units
    // distintos.
    const nfc = "café";
    const nfd = "café";
    expect(nfc).not.toBe(nfd);
    expect(compararEnTiempoConstante(nfc, nfd)).toBe(false);
    expect(compararEnTiempoConstante(nfc, nfc)).toBe(true);
  });

  it("surrogates sueltos NO colisionan con su reemplazo UTF-8 (fix round 1, I3)", () => {
    // Con codificación UTF-8 (la que usaba la versión anterior), Node
    // reemplaza cualquier surrogate suelto por U+FFFD (bytes EF BF BD) — así
    // que "a\uD800" (con el surrogate suelto) y "a�" (con el reemplazo
    // literal) codificaban a los MISMOS bytes y comparaban "iguales" sin
    // serlo. Con UTF-16LE cada code unit se vuelca tal cual: nunca colisionan.
    expect(compararEnTiempoConstante("\uD800", "\uDC00")).toBe(false);
    expect(compararEnTiempoConstante("a\uD800", "a�")).toBe(false);
    // Un surrogate suelto SÍ compara igual a sí mismo.
    expect(compararEnTiempoConstante("a\uD800", "a\uD800")).toBe(true);
  });
});
