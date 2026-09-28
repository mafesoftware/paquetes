import { describe, expect, it } from "vitest";
import { esClaveSegura, estaBajoPrefijo, sanitizarNombre } from "../src/claves.js";

describe("sanitizarNombre", () => {
  it("deja pasar un nombre simple sin cambios", () => {
    expect(sanitizarNombre("factura.pdf")).toBe("factura.pdf");
  });

  it("saca los acentos y colapsa los caracteres fuera de [A-Za-z0-9._-]", () => {
    expect(sanitizarNombre("comprobación (2024) áéíóú.pdf")).toBe("comprobacion-2024-aeiou.pdf");
  });

  it("no deja escapar un intento de traversal en el nombre", () => {
    const resultado = sanitizarNombre("../../etc/passwd");
    expect(resultado).not.toMatch(/\.\.|\//);
  });

  it("recorta '-'/'.' de las puntas", () => {
    expect(sanitizarNombre("  -hola-  ")).toBe("hola");
  });

  it("da 'archivo' si no queda ningún carácter útil (no feliz)", () => {
    expect(sanitizarNombre("😀😀😀")).toBe("archivo");
  });

  it("recorta nombres extremadamente largos", () => {
    const largo = "a".repeat(500) + ".pdf";
    expect(sanitizarNombre(largo).length).toBeLessThanOrEqual(150);
  });
});

describe("esClaveSegura", () => {
  it("acepta una clave normal bajo un prefijo", () => {
    expect(esClaveSegura("pending/abc123-factura.pdf")).toBe(true);
  });

  it("rechaza la clave vacía (no feliz)", () => {
    expect(esClaveSegura("")).toBe(false);
  });

  it("rechaza una clave que arranca con '/' (no feliz)", () => {
    expect(esClaveSegura("/etc/passwd")).toBe(false);
  });

  it("rechaza una clave con un segmento '..' (no feliz)", () => {
    expect(esClaveSegura("org-1/../org-2/secreto.pdf")).toBe(false);
  });

  it("no confunde '..oculto' (segmento que no es EXACTAMENTE '..') con traversal", () => {
    expect(esClaveSegura("carpeta/..oculto/archivo.pdf")).toBe(true);
  });
});

describe("estaBajoPrefijo", () => {
  it("true cuando la clave arranca con el prefijo", () => {
    expect(estaBajoPrefijo("pending/abc.pdf", "pending/")).toBe(true);
  });

  it("false cuando no (no feliz)", () => {
    expect(estaBajoPrefijo("final/abc.pdf", "pending/")).toBe(false);
  });
});
