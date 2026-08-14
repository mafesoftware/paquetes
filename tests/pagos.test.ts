import { describe, expect, it } from "vitest";
import {
  buscarPagosPorReferencia,
  mapearEstado,
  pagoMasRelevante,
  traerPago,
  type PagoMP,
} from "../src/pagos.js";

function fetchQueDevuelve(estado: number, cuerpo: unknown) {
  const urls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, urls };
}

const PAGO_CRUDO = {
  id: 111,
  status: "approved",
  status_detail: "accredited",
  external_reference: "pedido-1",
  preference_id: "pref-1",
  transaction_amount: 15000,
  currency_id: "ARS",
  date_created: "2026-08-13T10:00:00.000-03:00",
};

describe("mapearEstado", () => {
  it("traduce los estados de MP a los cinco canonicos", () => {
    expect(mapearEstado("approved")).toBe("aprobado");
    expect(mapearEstado("authorized")).toBe("aprobado");
    expect(mapearEstado("refunded")).toBe("devuelto");
    expect(mapearEstado("charged_back")).toBe("contracargo");
    expect(mapearEstado("rejected")).toBe("rechazado");
    expect(mapearEstado("cancelled")).toBe("rechazado");
    expect(mapearEstado("pending")).toBe("pendiente");
    expect(mapearEstado("in_process")).toBe("pendiente");
    expect(mapearEstado("in_mediation")).toBe("pendiente");
  });

  it("no distingue mayusculas y ante lo desconocido dice pendiente", () => {
    expect(mapearEstado("APPROVED")).toBe("aprobado");
    expect(mapearEstado("algo_nuevo_de_mp")).toBe("pendiente");
    expect(mapearEstado(null)).toBe("pendiente");
    expect(mapearEstado(undefined)).toBe("pendiente");
  });

  it("separa contracargo de devolucion, que no son lo mismo", () => {
    expect(mapearEstado("charged_back")).not.toBe(mapearEstado("refunded"));
  });
});

describe("traerPago", () => {
  it("normaliza la respuesta de MP", async () => {
    const { fn, urls } = fetchQueDevuelve(200, PAGO_CRUDO);
    const pago = await traerPago({ pagoId: "111", accessToken: "T", fetch: fn });
    expect(urls[0]).toBe("https://api.mercadopago.com/v1/payments/111");
    expect(pago).toEqual({
      id: "111",
      estado: "aprobado",
      estadoCrudo: "approved",
      detalleEstado: "accredited",
      referenciaExterna: "pedido-1",
      preferenciaId: "pref-1",
      monto: 15000,
      moneda: "ARS",
      creadoEn: "2026-08-13T10:00:00.000-03:00",
    } satisfies PagoMP);
  });

  it("devuelve null cuando MP dice que el pago no existe", async () => {
    const { fn } = fetchQueDevuelve(404, { message: "not found" });
    expect(await traerPago({ pagoId: "999", accessToken: "T", fetch: fn })).toBeNull();
  });
});

describe("buscarPagosPorReferencia", () => {
  it("busca por external_reference y normaliza los resultados", async () => {
    const { fn, urls } = fetchQueDevuelve(200, { results: [PAGO_CRUDO] });
    const pagos = await buscarPagosPorReferencia({
      referenciaExterna: "pedido-1",
      accessToken: "T",
      fetch: fn,
    });
    expect(urls[0]).toContain("/v1/payments/search?external_reference=pedido-1");
    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.estado).toBe("aprobado");
  });

  it("devuelve lista vacia si no hay resultados o si MP dice 404", async () => {
    const vacio = fetchQueDevuelve(200, { results: [] });
    expect(
      await buscarPagosPorReferencia({
        referenciaExterna: "x",
        accessToken: "T",
        fetch: vacio.fn,
      })
    ).toEqual([]);

    const noExiste = fetchQueDevuelve(404, {});
    expect(
      await buscarPagosPorReferencia({
        referenciaExterna: "x",
        accessToken: "T",
        fetch: noExiste.fn,
      })
    ).toEqual([]);
  });
});

describe("pagoMasRelevante", () => {
  function pago(estado: PagoMP["estado"], creadoEn: string): PagoMP {
    return {
      id: creadoEn,
      estado,
      estadoCrudo: estado,
      detalleEstado: "",
      referenciaExterna: "pedido-1",
      preferenciaId: null,
      monto: 100,
      moneda: "ARS",
      creadoEn,
    };
  }

  it("un aprobado le gana a cualquier rechazo anterior o posterior", () => {
    const elegido = pagoMasRelevante([
      pago("rechazado", "2026-08-13T12:00:00Z"),
      pago("aprobado", "2026-08-13T10:00:00Z"),
    ]);
    expect(elegido!.estado).toBe("aprobado");
  });

  it("un contracargo le gana al aprobado: es lo ultimo que paso de verdad", () => {
    const elegido = pagoMasRelevante([
      pago("aprobado", "2026-08-13T10:00:00Z"),
      pago("contracargo", "2026-08-20T10:00:00Z"),
    ]);
    expect(elegido!.estado).toBe("contracargo");
  });

  it("entre dos del mismo peso gana el mas nuevo", () => {
    const elegido = pagoMasRelevante([
      pago("rechazado", "2026-08-13T10:00:00Z"),
      pago("rechazado", "2026-08-13T11:00:00Z"),
    ]);
    expect(elegido!.creadoEn).toBe("2026-08-13T11:00:00Z");
  });

  it("sin pagos devuelve null", () => {
    expect(pagoMasRelevante([])).toBeNull();
  });
});
