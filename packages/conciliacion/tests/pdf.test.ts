/**
 * Tests unitarios de `extraerLineasPdf` — los casos de contraseña (PDF
 * protegido / contraseña incorrecta / error genérico que se re-tira tal
 * cual) no se pueden armar con un `.pdf` real sin una librería de escritura
 * de PDF que este paquete no tiene como dependencia, así que se mockea
 * `pdfjs-dist` (manteniendo `PasswordException`/`PasswordResponses` reales
 * vía `importOriginal`, solo se reemplaza `getDocument`). El caso feliz
 * (texto real extraído de un PDF) ya lo cubre el fixture golden de Galicia
 * en `bancos.golden.test.ts`.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

type Comportamiento = "ok" | "necesita-password" | "password-incorrecta" | "error-generico";
type ItemTexto = { str: string; hasEOL: boolean } | { marcador: true };

const estado = vi.hoisted(() => ({
  comportamiento: "ok" as Comportamiento,
  paginas: [] as ItemTexto[][],
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const PasswordException = real.PasswordException as new (mensaje: string, codigo: number) => Error;
  const PasswordResponses = real.PasswordResponses as { NEED_PASSWORD: number; INCORRECT_PASSWORD: number };

  return {
    ...real,
    getDocument: () => ({
      promise: (async () => {
        if (estado.comportamiento === "necesita-password") {
          throw new PasswordException("se necesita contraseña", PasswordResponses.NEED_PASSWORD);
        }
        if (estado.comportamiento === "password-incorrecta") {
          throw new PasswordException("contraseña incorrecta", PasswordResponses.INCORRECT_PASSWORD);
        }
        if (estado.comportamiento === "error-generico") {
          throw new Error("boom");
        }
        const paginas = estado.paginas;
        return {
          numPages: paginas.length,
          getPage: async (i: number) => ({
            getTextContent: async () => ({ items: paginas[i - 1] ?? [] }),
          }),
        };
      })(),
    }),
  };
});

const { extraerLineasPdf } = await import("../src/pdf.js");

describe("extraerLineasPdf — manejo de contraseña y errores", () => {
  beforeEach(() => {
    estado.comportamiento = "ok";
    estado.paginas = [];
  });

  it("PDF protegido sin contraseña -> mensaje en español, sin exponer el error crudo de pdfjs", async () => {
    estado.comportamiento = "necesita-password";
    await expect(extraerLineasPdf(new Uint8Array())).rejects.toThrow("el PDF está protegido");
  });

  it("contraseña incorrecta -> mensaje en español", async () => {
    estado.comportamiento = "password-incorrecta";
    await expect(extraerLineasPdf(new Uint8Array(), { contrasena: "mala" })).rejects.toThrow("contraseña incorrecta");
  });

  it("error genérico (no PasswordException) se re-tira sin traducir", async () => {
    estado.comportamiento = "error-generico";
    await expect(extraerLineasPdf(new Uint8Array())).rejects.toThrow("boom");
  });

  it("documento sin páginas -> []", async () => {
    const paginas = await extraerLineasPdf(new Uint8Array());
    expect(paginas).toEqual([]);
  });
});

describe("extraerLineasPdf — reconstrucción de líneas a partir de los items de texto", () => {
  beforeEach(() => {
    estado.comportamiento = "ok";
  });

  it("items marcados sin `str` (marked content) se descartan sin romper la reconstrucción", () => {
    estado.paginas = [[{ marcador: true }, { str: "Fecha", hasEOL: true }]];
    return extraerLineasPdf(new Uint8Array()).then((paginas) => {
      expect(paginas).toEqual([["Fecha"]]);
    });
  });

  it("items de una misma línea (sin hasEOL) se concatenan con espacio, sin espacio inicial", () => {
    estado.paginas = [[{ str: "Banco", hasEOL: false }, { str: "Galicia", hasEOL: true }]];
    return extraerLineasPdf(new Uint8Array()).then((paginas) => {
      expect(paginas).toEqual([["Banco Galicia"]]);
    });
  });

  it("item con `str` vacío no agrega un espacio de más", () => {
    estado.paginas = [[{ str: "Banco", hasEOL: false }, { str: "", hasEOL: false }, { str: "Galicia", hasEOL: true }]];
    const paginas = extraerLineasPdf(new Uint8Array());
    return paginas.then((p) => expect(p).toEqual([["Banco Galicia"]]));
  });

  it("texto pendiente sin `hasEOL` al final de la página se agrega igual como última línea", async () => {
    estado.paginas = [[{ str: "Fecha", hasEOL: true }, { str: "sin EOL al final", hasEOL: false }]];
    const paginas = await extraerLineasPdf(new Uint8Array());
    expect(paginas).toEqual([["Fecha", "sin EOL al final"]]);
  });
});
