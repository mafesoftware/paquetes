import { describe, expect, it, vi } from "vitest";
import { leerCotizaciones } from "../../src/fuentes/leer-cotizaciones.js";
import type { Fetch } from "../../src/fuentes/tipos.js";

function respuesta(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** Fixture: la forma real de dolarapi.com/v1/dolares, grabada de la API real (recortada). */
const FIXTURE_DOLARAPI = [
  { moneda: "USD", casa: "oficial", nombre: "Oficial", compra: 1500, venta: 1550, fechaActualizacion: "2026-09-28T14:00:00.000Z" },
  { moneda: "USD", casa: "blue", nombre: "Blue", compra: 1545, venta: 1565, fechaActualizacion: "2026-09-28T16:58:00.000Z" },
  { moneda: "USD", casa: "bolsa", nombre: "Bolsa", compra: 1547.9, venta: 1550.6, fechaActualizacion: "2026-09-28T16:58:00.000Z" },
  {
    moneda: "USD",
    casa: "contadoconliqui",
    nombre: "Contado con liquidación",
    compra: 1618.9,
    venta: 1619.7,
    fechaActualizacion: "2026-09-28T16:58:00.000Z",
  },
  { moneda: "USD", casa: "mayorista", nombre: "Mayorista", compra: 1519, venta: 1528, fechaActualizacion: "2026-09-28T13:59:00.000Z" },
  { moneda: "USD", casa: "cripto", nombre: "Cripto", compra: 1613.89, venta: 1616.58, fechaActualizacion: "2026-09-28T16:58:00.000Z" },
  { moneda: "USD", casa: "tarjeta", nombre: "Tarjeta", compra: 1950, venta: 2015, fechaActualizacion: "2026-09-28T14:00:00.000Z" },
];

describe("leerCotizaciones", () => {
  it("filtra a oficial/blue/mep(bolsa)/ccl(contadoconliqui), ignora mayorista/cripto/tarjeta", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta(FIXTURE_DOLARAPI));
    const r = await leerCotizaciones({ fetch: fetchMock });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no debería fallar");
    expect(r.valores).toEqual([
      { casa: "oficial", compra: "1500", venta: "1550", fecha: "2026-09-28T14:00:00.000Z" },
      { casa: "blue", compra: "1545", venta: "1565", fecha: "2026-09-28T16:58:00.000Z" },
      { casa: "mep", compra: "1547.9", venta: "1550.6", fecha: "2026-09-28T16:58:00.000Z" },
      { casa: "ccl", compra: "1618.9", venta: "1619.7", fecha: "2026-09-28T16:58:00.000Z" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://dolarapi.com/v1/dolares");
  });

  it("fetch que tira: categoria red", async () => {
    const fetchMock = vi.fn<Fetch>().mockRejectedValue(new Error("timeout"));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "red" });
  });

  it("status HTTP no-ok: categoria http", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({}, false, 503));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "http" });
  });

  it("json() tira (HTML de error, no JSON): categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response);
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("cuerpo que no es un array: categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ message: "quota exceeded" }));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("un item null en la lista: categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta([null]));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("un item sin campo casa: categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta([{ compra: 100, venta: 110 }]));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("una casa que SÍ nos interesa con compra/venta no numéricos: categoria formato", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValue(respuesta([{ casa: "oficial", compra: "no-numero", venta: 1550, fechaActualizacion: "2026-09-28T14:00:00.000Z" }]));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("lista vacía: ok con valores vacíos", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta([]));
    const r = await leerCotizaciones({ fetch: fetchMock });
    expect(r).toEqual({ ok: true, valores: [] });
  });
});
