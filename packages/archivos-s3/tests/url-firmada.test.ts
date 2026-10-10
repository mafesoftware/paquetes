import { describe, expect, it, vi } from "vitest";
import { urlFirmada } from "../src/index.js";
import { clienteDePrueba } from "./cliente-de-prueba.js";

const BASE = { cliente: clienteDePrueba(), bucket: "mi-bucket-de-prueba" };

describe("urlFirmada", () => {
  it("devuelve una URL firmada cuando el dueño coincide con el solicitante", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-1/facturas/factura.pdf",
      quienReferencia: async () => "org-1",
      solicitante: "org-1",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.url).toMatch(/^https:\/\//);
  });

  it("acepta un quienReferencia síncrono (no solo Promise)", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-1/factura.pdf",
      quienReferencia: () => "org-1",
      solicitante: "org-1",
    });
    expect(resultado.ok).toBe(true);
  });

  it("la clave de OTRO tenant da no_encontrado, no 403 (no feliz)", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-2/facturas/factura-ajena.pdf",
      quienReferencia: async () => "org-2", // el registro existe, pero es de otra organización
      solicitante: "org-1",
    });

    expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
  });

  it("una clave que ningún registro referencia todavía da no_encontrado (no feliz)", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-1/huerfana.pdf",
      quienReferencia: async () => null,
      solicitante: "org-1",
    });

    expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
  });

  it("una clave temporal (bajo el prefijo pending/) nunca es descargable, aunque quienReferencia la reconozca (no feliz)", async () => {
    const quienReferencia = vi.fn(async () => "org-1");

    const resultado = await urlFirmada({
      ...BASE,
      clave: "pending/abc123-factura.pdf",
      quienReferencia,
      solicitante: "org-1",
    });

    expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
    // Se corta ANTES de preguntar: una clave en pending/ no puede tener dueño de verdad todavía.
    expect(quienReferencia).not.toHaveBeenCalled();
  });

  it("respeta un prefijoTemporal propio", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "tmp/abc123-factura.pdf",
      prefijoTemporal: "tmp/",
      quienReferencia: async () => "org-1",
      solicitante: "org-1",
    });
    expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
  });

  it("usa compararSolicitante cuando el dueño es un objeto", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-1/proyecto-7/factura.pdf",
      quienReferencia: async () => ({ organizacionId: "org-1", proyectoId: "7" }),
      solicitante: { organizacionId: "org-1", proyectoId: "7" },
      compararSolicitante: (dueno, solicitante) =>
        dueno.organizacionId === solicitante.organizacionId && dueno.proyectoId === solicitante.proyectoId,
    });

    expect(resultado.ok).toBe(true);
  });

  it("compararSolicitante que no coincide da no_encontrado (no feliz)", async () => {
    const resultado = await urlFirmada({
      ...BASE,
      clave: "org-1/proyecto-7/factura.pdf",
      quienReferencia: async () => ({ organizacionId: "org-1", proyectoId: "7" }),
      solicitante: { organizacionId: "org-1", proyectoId: "9" },
      compararSolicitante: (dueno, solicitante) =>
        dueno.organizacionId === solicitante.organizacionId && dueno.proyectoId === solicitante.proyectoId,
    });

    expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
  });

  describe("descargaComo", () => {
    async function urlCon(descargaComo?: string): Promise<URL> {
      const resultado = await urlFirmada({
        ...BASE,
        clave: "org-1/facturas/factura.pdf",
        quienReferencia: () => "org-1",
        solicitante: "org-1",
        ...(descargaComo === undefined ? {} : { descargaComo }),
      });
      if (!resultado.ok) throw new Error("no debería fallar");
      return new URL(resultado.url);
    }

    it("sin descargaComo, la URL no fuerza descarga (igual que antes)", async () => {
      const url = await urlCon();
      expect(url.searchParams.has("response-content-disposition")).toBe(false);
    });

    it("con descargaComo, la URL firmada lleva Content-Disposition attachment con filename ASCII y filename* UTF-8", async () => {
      const url = await urlCon("Factura Nº 12 – año.pdf");
      expect(url.searchParams.get("response-content-disposition")).toBe(
        "attachment; filename=\"Factura-No-12-ano.pdf\"; filename*=UTF-8''Factura%20N%C2%BA%2012%20%E2%80%93%20a%C3%B1o.pdf",
      );
      // El parámetro va FIRMADO (si no, S3 rechazaría la URL o cualquiera podría cambiarlo).
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("una URL con y otra sin descargaComo tienen firmas distintas", async () => {
      const [con, sin] = await Promise.all([urlCon("a.pdf"), urlCon()]);
      expect(con.searchParams.get("X-Amz-Signature")).not.toBe(sin.searchParams.get("X-Amz-Signature"));
    });

    it("no se fuerza descarga si la autorización falla (no feliz)", async () => {
      const resultado = await urlFirmada({
        ...BASE,
        clave: "org-2/factura.pdf",
        quienReferencia: () => "org-2",
        solicitante: "org-1",
        descargaComo: "factura.pdf",
      });
      expect(resultado).toEqual({ ok: false, codigo: "no_encontrado" });
    });
  });
});
