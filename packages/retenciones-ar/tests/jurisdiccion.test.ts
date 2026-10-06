import { describe, expect, it } from "vitest";
import { jurisdiccionDeProvincia } from "../src/jurisdiccion.js";

describe("jurisdiccionDeProvincia", () => {
  it("null → null", () => {
    expect(jurisdiccionDeProvincia(null)).toBeNull();
  });

  it("CABA (variantes de texto, mayúsculas/minúsculas) → AGIP", () => {
    expect(jurisdiccionDeProvincia("CABA")).toBe("AGIP");
    expect(jurisdiccionDeProvincia("Ciudad Autónoma de Buenos Aires")).toBe("AGIP");
    expect(jurisdiccionDeProvincia("capital federal")).toBe("AGIP");
  });

  it("provincia de Buenos Aires (variantes) → ARBA", () => {
    expect(jurisdiccionDeProvincia("Buenos Aires")).toBe("ARBA");
    expect(jurisdiccionDeProvincia("PROVINCIA DE BUENOS AIRES")).toBe("ARBA");
    expect(jurisdiccionDeProvincia("pba")).toBe("ARBA");
  });

  it("otra provincia sin padrón soportado → null", () => {
    expect(jurisdiccionDeProvincia("Córdoba")).toBeNull();
  });
});
