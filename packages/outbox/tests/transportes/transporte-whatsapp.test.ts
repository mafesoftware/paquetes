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
};

describe("transporteWhatsApp", () => {
  it("busca credenciales por tenantId y las pasa a enviar() junto a destino/plantilla/parametros", async () => {
    const credencial = { apiKey: "k", phoneNumberId: "p" };
    const credencialesDe = vi.fn().mockReturnValue(credencial);
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.1" });

    const transporte = transporteWhatsApp({ credencialesDe, enviar });
    const resultado = await transporte(MENSAJE);

    expect(credencialesDe).toHaveBeenCalledWith("t1");
    expect(enviar).toHaveBeenCalledWith(credencial, "5491122334455", "gf_turno_manana", ["10:00"]);
    expect(resultado).toEqual({ ok: true, idExterno: "wamid.1" });
  });

  it("datos que NO es un arreglo -> parametrosDe por defecto manda [] (no revienta armando parametros)", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.2" });
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    await transporte({ ...MENSAJE, datos: { turno: "10:00" } });
    expect(enviar).toHaveBeenCalledWith({}, "5491122334455", "gf_turno_manana", []);
  });

  it("parametrosDe propio decide los parámetros posicionales", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, id: "wamid.3" });
    const transporte = transporteWhatsApp({
      credencialesDe: () => ({}),
      enviar,
      parametrosDe: (m) => [String((m.datos as { turno: string }).turno)],
    });

    await transporte({ ...MENSAJE, datos: { turno: "11:00" } });
    expect(enviar).toHaveBeenCalledWith({}, "5491122334455", "gf_turno_manana", ["11:00"]);
  });

  it("sin credenciales (undefined) -> categoria credenciales, NO llama a enviar()", async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({ credencialesDe: () => undefined, enviar });

    const resultado = await transporte(MENSAJE);
    expect(resultado).toEqual({ ok: false, categoria: "credenciales", codigo: "sin_credenciales" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("sin credenciales (null) -> mismo resultado", async () => {
    const enviar = vi.fn();
    const transporte = transporteWhatsApp({ credencialesDe: () => null, enviar });

    const resultado = await transporte(MENSAJE);
    expect(resultado).toEqual({ ok: false, categoria: "credenciales", codigo: "sin_credenciales" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("un resultado { ok: false } de enviar() se traduce a categoria/codigo", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: false, categoria: "ventana", error: "fuera de ventana de 24h" });
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    const resultado = await transporte(MENSAJE);
    expect(resultado).toEqual({ ok: false, categoria: "ventana", codigo: "ventana" });
  });

  it("si enviar() tira, la promesa del Transporte rechaza (no hay try/catch propio)", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("boom"));
    const transporte = transporteWhatsApp({ credencialesDe: () => ({}), enviar });

    await expect(transporte(MENSAJE)).rejects.toThrow("boom");
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
