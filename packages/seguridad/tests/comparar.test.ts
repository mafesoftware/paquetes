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

  it("da true para dos strings vacíos", () => {
    expect(compararEnTiempoConstante("", "")).toBe(true);
  });

  it("no tira con null/undefined (llamadas desde JS sin chequeo de tipos): los trata como string vacío", () => {
    expect(compararEnTiempoConstante(null as never, "a")).toBe(false);
    expect(compararEnTiempoConstante(undefined as never, undefined as never)).toBe(true);
  });

  it("compara por bytes UTF-8, no por caracteres JS", () => {
    // "café" en NFC (1 solo codepoint para "é") vs. la misma palabra con la
    // "é" en dos codepoints (NFD): mismo texto visualmente, bytes distintos.
    const nfc = "café";
    const nfd = "café";
    expect(nfc).not.toBe(nfd);
    expect(compararEnTiempoConstante(nfc, nfd)).toBe(false);
    expect(compararEnTiempoConstante(nfc, nfc)).toBe(true);
  });
});
