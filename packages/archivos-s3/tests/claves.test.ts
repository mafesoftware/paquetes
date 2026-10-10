import { describe, expect, it } from "vitest";
import { contentDispositionAdjunto, esClaveSegura, estaBajoPrefijo, sanitizarNombre } from "../src/claves.js";

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

describe("contentDispositionAdjunto", () => {
  it("un nombre ASCII simple va igual en filename y filename*", () => {
    expect(contentDispositionAdjunto("factura.pdf")).toBe(
      "attachment; filename=\"factura.pdf\"; filename*=UTF-8''factura.pdf",
    );
  });

  it("conserva tildes y eñes en filename* (percent-encoded UTF-8) y las saca de filename", () => {
    expect(contentDispositionAdjunto("presupuesto año.pdf")).toBe(
      "attachment; filename=\"presupuesto-ano.pdf\"; filename*=UTF-8''presupuesto%20a%C3%B1o.pdf",
    );
  });

  it("normaliza a NFC: una tilde descompuesta se codifica igual que la compuesta", () => {
    expect(contentDispositionAdjunto("cami\u006e\u0303o.pdf")).toBe(contentDispositionAdjunto("cami\u00f1o.pdf"));
  });

  it("comillas, barras y saltos de línea no pueden romper el header ni inyectar otro (no feliz)", () => {
    const valor = contentDispositionAdjunto('a"b\\c/d\r\nSet-Cookie: x=1.pdf');
    expect(valor).not.toMatch(/[\r\n]/);
    expect(valor).toBe(
      "attachment; filename=\"a-b-c-d-Set-Cookie-x-1.pdf\"; filename*=UTF-8''a%22b-c-d-Set-Cookie%3A%20x%3D1.pdf",
    );
  });

  it("codifica ' ( ) * que encodeURIComponent deja pasar (no son attr-char de RFC 5987)", () => {
    expect(contentDispositionAdjunto("it's (v2)*.pdf")).toBe(
      "attachment; filename=\"it-s-v2-.pdf\"; filename*=UTF-8''it%27s%20%28v2%29%2A.pdf",
    );
  });

  it("un sustituto UTF-16 suelto no hace tirar a encodeURIComponent", () => {
    expect(() => contentDispositionAdjunto("roto\uD800.pdf")).not.toThrow();
    expect(contentDispositionAdjunto("roto\uD800.pdf")).toContain("filename*=UTF-8''roto-.pdf");
  });

  it("recorta por code point: un emoji en el borde del límite no queda partido", () => {
    const valor = contentDispositionAdjunto(`${"a".repeat(149)}😀😀.pdf`);
    expect(valor).toContain(`filename*=UTF-8''${"a".repeat(149)}%F0%9F%98%80`);
    expect(valor.endsWith("%F0%9F%98%80")).toBe(true);
  });

  it("si del nombre original no queda nada, filename* usa el saneado", () => {
    expect(contentDispositionAdjunto("  \n ")).toBe("attachment; filename=\"archivo\"; filename*=UTF-8''archivo");
  });
});
