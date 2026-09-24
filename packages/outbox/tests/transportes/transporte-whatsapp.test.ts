import { describe, expect, it, vi } from "vitest";
import { transporteWhatsApp } from "../../src/transportes/transporte-whatsapp.js";
import { ErrorOutbox } from "../../src/errores.js";
import type { MensajeParaEnviar } from "../../src/transporte.js";

const MENSAJE: MensajeParaEnviar = {
  id: "m1",
  tenantId: "t1",
  canal: "whatsapp",
  destino: "5491122334455",
  plantilla: "gf_turno_manana",
  datos: ["10:00"],
  claveIdempotencia: "t1:k1",
};

const CONTEXTO = { señal: new AbortController().signal };

describe("transporteWhatsApp", () => {
  it("busca credenciales por tenantId y las pasa a enviar() junto a destino/plantilla/parametros/claveIdempotencia/señal", async () => {
    const credencial = { apiKey: "k", phoneNumberId: "p" };
    const credencialesDe = vi.fn().mockReturnValue(credencial);
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.1" });

    const transporte = transporteWhatsApp({ credencialesDe, enviar });
    const resultado = await transporte(MENSAJE, CONTEXTO);

    expect(credencialesDe).toHaveBeenCalledWith("t1");
    expect(enviar).toHaveBeenCalledWith(credencial, "5491122334455", "gf_turno_manana", ["10:00"], "t1:k1", CONTEXTO.señal);
    expect(resultado).toEqual({ ok: true, idExterno: "wamid.1" });
  });

  it("reenvía LA MISMA señal (AbortSignal) que le llegó en el contexto — L2 (kapso-wa no la usa hoy, pero un enviar propio puede)", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.x" });
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });
    const contexto = { señal: new AbortController().signal };

    await transporte(MENSAJE, contexto);

    const señalRecibida = enviar.mock.calls[0]![5] as AbortSignal;
    expect(señalRecibida).toBe(contexto.señal);
  });

  it("datos que NO es un arreglo -> parametrosDe por defecto manda [] (no revienta armando parametros)", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.2" });
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    await transporte({ ...MENSAJE, datos: { turno: "10:00" } }, CONTEXTO);
    expect(enviar).toHaveBeenCalledWith({}, "5491122334455", "gf_turno_manana", [], "t1:k1", CONTEXTO.señal);
  });

  it("parametrosDe propio decide los parámetros posicionales", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.3" });
    const transporte = transporteWhatsApp({
      credencialesDe: () => ({}),
      enviar,
      parametrosDe: (m) => [String((m.datos as { turno: string }).turno)],
    });

    await transporte({ ...MENSAJE, datos: { turno: "11:00" } }, CONTEXTO);
    expect(enviar).toHaveBeenCalledWith({}, "5491122334455", "gf_turno_manana", ["11:00"], "t1:k1", CONTEXTO.señal);
  });

  it('si parametrosDe() tira, se clasifica { ok: false, categoria: "plantilla", codigo: "render" } (permanente, NO rechaza)', async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({
      credencialesDe: () => ({}),
      enviar,
      parametrosDe: () => {
        throw new Error("dato faltante (nunca debería verse este texto)");
      },
    });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "plantilla", codigo: "render" });
    expect(enviar).not.toHaveBeenCalled();
    expect(JSON.stringify(resultado)).not.toContain("nunca debería verse este texto");
  });

  it("sin credenciales (undefined, sync) -> categoria credenciales, NO llama a enviar()", async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({ credencialesDe: () => undefined, enviar });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "credenciales", codigo: "sin_credenciales" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("sin credenciales (null, sync) -> mismo resultado", async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({ credencialesDe: () => null, enviar });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "credenciales", codigo: "sin_credenciales" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("credencialesDe ASYNC resolviendo null -> se espera de verdad (no un objeto Promise truthy), categoria credenciales, NO llama a enviar()", async () => {
    const enviar = vi.fn();
    let recibido: unknown = "sin-llamar";
    const transporte = transporteWhatsApp({
      credencialesDe: async () => null,
      enviar: async (c) => {
        recibido = c;
        return { ok: true, id: "no-deberia-llamarse" };
      },
    });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "credenciales", codigo: "sin_credenciales" });
    expect(enviar).not.toHaveBeenCalled();
    expect(recibido).toBe("sin-llamar"); // enviar() nunca se llamó
  });

  it("credencialesDe ASYNC resolviendo credenciales válidas -> se manda (recibido NO es una Promise)", async () => {
    const credencial = { apiKey: "k" };
    let recibido: unknown;
    const transporte = transporteWhatsApp({
      credencialesDe: async () => credencial,
      enviar: async (c) => {
        recibido = c;
        return { ok: true, id: "wamid.async" };
      },
    });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: true, idExterno: "wamid.async" });
    expect(recibido).toBe(credencial);
    expect(recibido instanceof Promise).toBe(false);
  });

  it('credencialesDe ASYNC que RECHAZA -> "transitorio" (categoria "red", codigo "credenciales_excepcion"), NO llama a enviar()', async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({
      credencialesDe: async () => {
        throw new Error("conexión a la base cortada (nunca debería verse este texto)");
      },
      enviar,
    });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "red", codigo: "credenciales_excepcion" });
    expect(enviar).not.toHaveBeenCalled();
    expect(JSON.stringify(resultado)).not.toContain("nunca debería verse este texto");
  });

  it("un resultado { ok: false } de enviar() se traduce a categoria/codigo", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: false, categoria: "ventana", error: "fuera de ventana de 24h" });
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    const resultado = await transporte(MENSAJE, CONTEXTO);
    expect(resultado).toEqual({ ok: false, categoria: "ventana", codigo: "ventana" });
  });

  it("si enviar() tira, la promesa del Transporte rechaza (no hay try/catch propio para enviar)", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("boom"));
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    await expect(transporte(MENSAJE, CONTEXTO)).rejects.toThrow("boom");
  });

  it('"credencialesDe" no función -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => transporteWhatsApp({ credencialesDe: undefined as never, enviar: vi.fn() })).toThrow(ErrorOutbox);
  });

  it('"enviar" no función -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() => transporteWhatsApp({ credencialesDe: () => ({}), enviar: undefined as never })).toThrow(ErrorOutbox);
  });

  it('"parametrosDe" (si se pasa) no función -> ErrorOutbox("opciones_invalidas")', () => {
    expect(() =>
      transporteWhatsApp({ credencialesDe: () => ({}), enviar: vi.fn(), parametrosDe: "no-es-funcion" as never }),
    ).toThrow(ErrorOutbox);
  });
});
