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
});
