/**
 * Tests de los heurísticos `detectar*` de cada banco (`src/bancos/*.ts`):
 * `bancos.golden.test.ts` llama a cada `parser*` directo, nunca a
 * `detectar*` — y `motor.test.ts` solo prueba `detectarBanco` (que delega acá)
 * con un par de casos, no las 3 ramas de cada banco (nombre de archivo /
 * banner de contenido / ninguno).
 */
import { describe, expect, it } from "vitest";
import { detectarGalicia } from "../src/bancos/galicia.js";
import { detectarSantander } from "../src/bancos/santander.js";
import { detectarBbva } from "../src/bancos/bbva.js";
import { detectarMacro } from "../src/bancos/macro.js";
import { detectarNacion } from "../src/bancos/nacion.js";
import { detectarProvincia } from "../src/bancos/provincia.js";

function contenido(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

describe("detectarGalicia", () => {
  it("por nombre de archivo", () => expect(detectarGalicia(contenido(""), "extracto-GALICIA.csv")).toBe(true));
  it("por banner de contenido", () => expect(detectarGalicia(contenido("GALICIA;CUENTA;1;ARS"), "archivo.csv")).toBe(true));
  it("ninguno -> false", () => expect(detectarGalicia(contenido("otra cosa"), "archivo.csv")).toBe(false));
});

describe("detectarSantander", () => {
  it("por nombre de archivo", () => expect(detectarSantander(contenido(""), "extracto-santander.csv")).toBe(true));
  it("por banner de contenido", () => expect(detectarSantander(contenido("SANTANDER;CUENTA;1;ARS"), "archivo.csv")).toBe(true));
  it("ninguno -> false", () => expect(detectarSantander(contenido("otra cosa"), "archivo.csv")).toBe(false));
});

describe("detectarBbva", () => {
  it("por nombre de archivo", () => expect(detectarBbva(contenido(""), "extracto-bbva.xlsx")).toBe(true));
  it("sin match -> false", () => expect(detectarBbva(contenido(""), "extracto.xlsx")).toBe(false));
});

describe("detectarMacro", () => {
  it("por nombre de archivo", () => expect(detectarMacro(contenido(""), "extracto-MACRO.csv")).toBe(true));
  it("por banner de contenido", () => expect(detectarMacro(contenido("MACRO;CUENTA;1;ARS"), "archivo.csv")).toBe(true));
  it("ninguno -> false", () => expect(detectarMacro(contenido("otra cosa"), "archivo.csv")).toBe(false));
});

describe("detectarNacion", () => {
  it("por nombre de archivo (nación o bna)", () => {
    expect(detectarNacion(contenido(""), "extracto-nacion.csv")).toBe(true);
    expect(detectarNacion(contenido(""), "extracto-bna.csv")).toBe(true);
  });
  it("por banner de contenido", () => expect(detectarNacion(contenido("NACION;CUENTA;1;ARS"), "archivo.csv")).toBe(true));
  it("ninguno -> false", () => expect(detectarNacion(contenido("otra cosa"), "archivo.csv")).toBe(false));
});

describe("detectarProvincia", () => {
  it("por nombre de archivo (provincia o bapro)", () => {
    expect(detectarProvincia(contenido(""), "extracto-provincia.csv")).toBe(true);
    expect(detectarProvincia(contenido(""), "extracto-bapro.csv")).toBe(true);
  });
  it("por banner de contenido", () => expect(detectarProvincia(contenido("PROVINCIA;CUENTA;1;ARS"), "archivo.csv")).toBe(true));
  it("ninguno -> false", () => expect(detectarProvincia(contenido("otra cosa"), "archivo.csv")).toBe(false));
});
