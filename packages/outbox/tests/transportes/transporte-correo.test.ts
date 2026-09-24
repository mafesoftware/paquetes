import { describe, expect, it, vi } from "vitest";
import { transporteCorreo } from "../../src/transportes/transporte-correo.js";
import { ErrorOutbox } from "../../src/errores.js";
import type { MensajeParaEnviar } from "../../src/transporte.js";

const MENSAJE: MensajeParaEnviar = {
  id: "m1",
  tenantId: "t1",
  canal: "correo",
  destino: "ana@mail.com",
  plantilla: "bienvenida",
  datos: { nombre: "Ana" },
  claveIdempotencia: "t1:k1",
};

const CONTEXTO = { señal: new AbortController().signal };

function render(mensaje: Pick<MensajeParaEnviar, "plantilla" | "datos">) {
  const { nombre } = mensaje.datos as { nombre: string };
  return { asunto: `Hola, ${nombre}!`, html: `<p>Bienvenido, ${nombre}.</p>` };
}

describe("transporteCorreo", () => {
  it("arma el envío con render() y pasa para/asunto/html/texto/de/claveIdempotencia a enviar()", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "resend_1" });
    const transporte = transporteCorreo({ remitente: "Mi App <no-reply@mi-app.com>", enviar, render });

    const resultado = await transporte(MENSAJE, CONTEXTO);

    expect(enviar).toHaveBeenCalledWith({
      para: "ana@mail.com",
      asunto: "Hola, Ana!",
      html: "<p>Bienvenido, Ana.</p>",
      texto: undefined,
      de: "Mi App <no-reply@mi-app.com>",
      claveIdempotencia: "t1:k1",
    });
    expect(resultado).toEqual({ ok: true, idExterno: "resend_1" });
  });

  it("un resultado { ok: false } de enviar() se traduce a categoria/codigo (mismo valor en los dos)", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: false, categoria: "limite", error: "429 de Resend" });
    const transporte = transporteCorreo({ remitente: "x@y.com", enviar, render });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "limite", codigo: "limite" });
  });

  it("nunca pasa el .error crudo de enviar() al resultado (solo categoria)", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: false, categoria: "rechazado", error: "detalle con datos del mail" });
    const transporte = transporteCorreo({ remitente: "x@y.com", enviar, render });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(JSON.stringify(resultado)).not.toContain("detalle con datos del mail");
  });

  it('si render() tira, se clasifica { ok: false, categoria: "plantilla", codigo: "render" } (permanente, NO rechaza)', async () => {
    const enviar = vi.fn();
    const transporte = transporteCorreo({
      remitente: "x@y.com",
      enviar,
      render: () => {
        throw new Error("plantilla desconocida (nunca debería verse este texto)");
      },
    });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "plantilla", codigo: "render" });
    expect(enviar).not.toHaveBeenCalled();
    expect(JSON.stringify(resultado)).not.toContain("nunca debería verse este texto");
  });

  it("si enviar() tira, la promesa del Transporte rechaza (no hay try/catch propio para enviar)", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("boom"));
    const transporte = transporteCorreo({ remitente: "x@y.com", enviar, render });

    await expect(transporte(MENSAJE, CONTEXTO)).rejects.toThrow("boom");
  });

  it('"enviar" no función -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => transporteCorreo({ remitente: "x@y.com", enviar: undefined as never, render })).toThrow(ErrorOutbox);
  });

  it('"render" no función -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => transporteCorreo({ remitente: "x@y.com", enviar: vi.fn(), render: undefined as never })).toThrow(ErrorOutbox);
  });

  it('"remitente" vacío o solo espacios -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => transporteCorreo({ remitente: "", enviar: vi.fn(), render })).toThrow(ErrorOutbox);
    expect(() => transporteCorreo({ remitente: "   ", enviar: vi.fn(), render })).toThrow(ErrorOutbox);
  });
});
