import { describe, expect, it } from "vitest";
import { aWhatsApp, telefonoAE164 } from "../src/telefono.ts";

describe("telefonoAE164", () => {
  it("el ejemplo del brief: 011 con 15 y guiones", () => {
    expect(telefonoAE164("011 15-4444-5555")).toBe("+5491144445555");
  });

  it("ya en formato con +54 9 y área de 2 dígitos", () => {
    expect(telefonoAE164("+54 9 11 4444-5555")).toBe("+5491144445555");
  });

  it("sin 0 ni 9 ni 15, área de 2 dígitos", () => {
    expect(telefonoAE164("11 4444 5555")).toBe("+5491144445555");
  });

  it("área de 3 dígitos (Córdoba) con 15 y paréntesis", () => {
    expect(telefonoAE164("(0351) 15 555-1234")).toBe("+5493515551234");
  });

  it("área de 3 dígitos sin separadores internos", () => {
    expect(telefonoAE164("0351 155551234")).toBe("+5493515551234");
  });

  it("área de 4 dígitos (2966) con 15", () => {
    // 2966 (Sierra Grande y alrededores) + 15 + abonado de 6 dígitos.
    expect(telefonoAE164("02966 15 123456")).toBe("+5492966123456");
  });

  it("devuelve null cuando no se puede determinar el número", () => {
    expect(telefonoAE164("123")).toBeNull();
    expect(telefonoAE164("")).toBeNull();
  });

  it("devuelve null con un largo que no es ni 10 ni 12 dígitos tras normalizar", () => {
    expect(telefonoAE164("54 11 44445555555")).toBeNull();
  });

  it("devuelve null con 12 dígitos donde el \"15\" no aparece en ninguna posición candidata", () => {
    // 12 dígitos, no empieza con "1" (candidatos 3 y 4): ni en la posición 3
    // ni en la 4 aparece "15", así que no se puede ubicar el marcador.
    expect(telefonoAE164("222222222222")).toBeNull();
  });
});

describe("aWhatsApp", () => {
  it("mismo número, sin el +", () => {
    expect(aWhatsApp("011 15-4444-5555")).toBe("5491144445555");
  });

  it("devuelve null cuando telefonoAE164 no puede determinarlo", () => {
    expect(aWhatsApp("123")).toBeNull();
  });
});
