import { describe, expect, it, vi } from "vitest";
import { conReintento } from "../src/reintento.js";

const CHOQUE_DE_UNICO = Object.assign(new Error("duplicate key"), { code: "23505" });
const OTRO_ERROR = new Error("otra cosa, no reintentable por default");

/** Espera "instantánea" para no hacer los tests lentos: resuelve enseguida pero deja registro de las llamadas. */
function esperaInmediata() {
  const llamadas: number[] = [];
  const espera = vi.fn(async (intento: number) => {
    llamadas.push(intento);
  });
  return { espera, llamadas };
}

describe("conReintento", () => {
  it("si fn resuelve al primer intento, no reintenta ni espera", async () => {
    const { espera } = esperaInmediata();
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(conReintento(fn, { espera })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(espera).not.toHaveBeenCalled();
  });

  it("reintenta un error reintentable (choque de único, por defecto) hasta que fn resuelve", async () => {
    const { espera, llamadas } = esperaInmediata();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(CHOQUE_DE_UNICO)
      .mockRejectedValueOnce(CHOQUE_DE_UNICO)
      .mockResolvedValueOnce("listo al tercer intento");

    await expect(conReintento(fn, { espera })).resolves.toBe("listo al tercer intento");
    expect(fn).toHaveBeenCalledTimes(3);
    // espera(intento) se llama ANTES del segundo y del tercer intento, con el
    // número de intento (0-based) que acaba de fallar.
    expect(llamadas).toEqual([0, 1]);
  });

  it("un error NO reintentable (según esReintentable) sale de inmediato, sin agotar los intentos", async () => {
    const { espera } = esperaInmediata();
    const fn = vi.fn().mockRejectedValue(OTRO_ERROR);

    await expect(conReintento(fn, { espera })).rejects.toBe(OTRO_ERROR);
    expect(fn).toHaveBeenCalledTimes(1); // no reintentó
    expect(espera).not.toHaveBeenCalled();
  });

  it("agota los `intentos` y tira el último error si nunca deja de fallar", async () => {
    const { espera } = esperaInmediata();
    const fn = vi.fn().mockRejectedValue(CHOQUE_DE_UNICO);

    await expect(conReintento(fn, { intentos: 3, espera })).rejects.toBe(CHOQUE_DE_UNICO);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("esReintentable propio reemplaza a esChoqueDeUnico", async () => {
    const { espera } = esperaInmediata();
    const fn = vi.fn().mockRejectedValueOnce(OTRO_ERROR).mockResolvedValueOnce("ok");

    await expect(conReintento(fn, { esReintentable: () => true, espera })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('"intentos" debe ser >= 1: con 0 (o negativo) tira de entrada, sin llamar a fn', async () => {
    const fn = vi.fn();
    await expect(conReintento(fn, { intentos: 0 })).rejects.toThrow(/intentos/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("sin `espera` inyectada, usa un backoff con jitter real (no cuelga, tarda un poco)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(CHOQUE_DE_UNICO).mockResolvedValueOnce("ok");
    await expect(conReintento(fn, { intentos: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
