/**
 * Tests del punto de entrada del parseo (`motor.ts`): nada lo ejercitaba
 * directamente — `bancos.golden.test.ts` llama a cada `parser*` por su
 * cuenta, sin pasar por `bancosSoportados`/`bancosConFormato`/
 * `detectarBanco`/`parsearExtracto`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bancosSoportados, bancosConFormato, detectarBanco, parsearExtracto } from "../src/motor.js";

const FIXTURES = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

function leer(banco: string, archivo: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, banco, archivo)));
}

describe("bancosSoportados", () => {
  it("devuelve los 6 bancos registrados", () => {
    expect(bancosSoportados()).toEqual(["galicia", "santander", "bbva", "macro", "nacion", "provincia"]);
  });
});

describe("bancosConFormato", () => {
  it('"pdf" -> solo galicia (único banco con parser de PDF)', () => {
    expect(bancosConFormato("pdf")).toEqual(["galicia"]);
  });

  it('"csv" -> todos menos bbva (que es solo xlsx)', () => {
    expect(bancosConFormato("csv")).toEqual(["galicia", "santander", "macro", "nacion", "provincia"]);
  });

  it('"xlsx" -> solo bbva', () => {
    expect(bancosConFormato("xlsx")).toEqual(["bbva"]);
  });
});

describe("detectarBanco", () => {
  it("reconoce por nombre de archivo", () => {
    expect(detectarBanco(new TextEncoder().encode(""), "extracto-santander-sep.csv")).toBe("santander");
  });

  it("reconoce por contenido (banner) cuando el nombre de archivo no dice nada", () => {
    const contenido = new TextEncoder().encode("MACRO;CUENTA;123;ARS\n...");
    expect(detectarBanco(contenido, "extracto.csv")).toBe("macro");
  });

  it("banco no reconocido -> null", () => {
    expect(detectarBanco(new TextEncoder().encode("NO ES UN BANCO CONOCIDO"), "archivo.csv")).toBeNull();
  });
});

describe("parsearExtracto", () => {
  it("banco no soportado -> tira con la lista de bancos soportados", async () => {
    await expect(parsearExtracto("inexistente", new Uint8Array(), { formato: "csv" })).rejects.toThrow(
      /Banco no soportado: "inexistente"\. Bancos soportados: galicia, santander, bbva, macro, nacion, provincia\./,
    );
  });

  it('banco sin parser para el formato pedido, pedido en "pdf" -> sugiere los bancos con PDF y exportar CSV', async () => {
    await expect(parsearExtracto("santander", new Uint8Array(), { formato: "pdf" })).rejects.toThrow(
      /Banco Santander no tiene extractos en PDF soportados acá\. Bancos con soporte de PDF: galicia\. Probá exportando el extracto en CSV\./,
    );
  });

  it("banco sin parser para el formato pedido, NO pdf -> lista los formatos que sí soporta ese banco", async () => {
    await expect(parsearExtracto("galicia", new Uint8Array(), { formato: "xlsx" })).rejects.toThrow(
      /Banco Galicia no soporta el formato "xlsx" acá\. Formatos soportados para ese banco: csv, pdf\./,
    );
  });

  it("delega en el parser correcto y devuelve el extracto parseado", async () => {
    const extractos = await parsearExtracto("santander", leer("santander", "extracto.csv"), { formato: "csv" });
    expect(extractos).toHaveLength(1);
    expect(extractos[0]?.lineas.length).toBeGreaterThan(0);
  });
});
