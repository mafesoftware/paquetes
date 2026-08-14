import { describe, expect, it } from "vitest";
import type { EstadoPago, PagoMP } from "../src/pagos.js";
import { procesarNotificacionDePago, reconciliarPago } from "../src/procesar.js";

function pagoCrudo(estado: string, referencia: string | null = "P-1", id = 111) {
  return {
    id,
    status: estado,
    status_detail: "",
    external_reference: referencia,
    preference_id: "pref-1",
    transaction_amount: 40000,
    currency_id: "ARS",
    date_created: "2026-08-13T10:00:00Z",
  };
}

function fetchQueDevuelve(estado: number, cuerpo: unknown) {
  return (async () =>
    new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

/** Una base de mentira: guarda el estado del pedido y registra las escrituras. */
function pedidoFalso(estadoInicial: EstadoPago | null, opciones?: { gana?: boolean }) {
  const escrituras: { estado: EstadoPago; pagoId: string }[] = [];
  return {
    escrituras,
    puertos: {
      cargarPedido: async (referencia: string) =>
        referencia === "P-1" ? { estadoPago: estadoInicial } : null,
      aplicar: async (cambio: { estado: EstadoPago; pagoId: string; pago: PagoMP }) => {
        escrituras.push({ estado: cambio.estado, pagoId: cambio.pagoId });
        return opciones?.gana ?? true;
      },
    },
  };
}

describe("procesarNotificacionDePago", () => {
  it("un pago aprobado sobre un pedido pendiente se aplica", async () => {
    const { puertos, escrituras } = pedidoFalso("pendiente");
    const r = await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("approved")),
      ...puertos,
    });
    expect(r).toEqual({
      aplicado: true,
      estado: "aprobado",
      pagoId: "111",
      referenciaExterna: "P-1",
    });
    expect(escrituras).toEqual([{ estado: "aprobado", pagoId: "111" }]);
  });

  it("EL SEGUNDO webhook del mismo pago no aplica nada", async () => {
    const { puertos, escrituras } = pedidoFalso("aprobado");
    const r = await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("approved")),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "sin_cambios" });
    expect(escrituras).toEqual([]);
  });

  it("si la app dice que no afecto filas, el resultado es sin_cambios", async () => {
    // Dos webhooks a la vez: el UPDATE condicional de la app lo gana el otro.
    const { puertos } = pedidoFalso("pendiente", { gana: false });
    const r = await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("approved")),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "sin_cambios" });
  });

  it("un contracargo sobre un pedido ya aprobado SI se aplica", async () => {
    const { puertos, escrituras } = pedidoFalso("aprobado");
    await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("charged_back")),
      ...puertos,
    });
    expect(escrituras).toEqual([{ estado: "contracargo", pagoId: "111" }]);
  });

  it("un pago que MP dice que no existe no rompe nada", async () => {
    const { puertos, escrituras } = pedidoFalso("pendiente");
    const r = await procesarNotificacionDePago({
      pagoId: "999",
      accessToken: "T",
      fetch: fetchQueDevuelve(404, {}),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "pago_inexistente" });
    expect(escrituras).toEqual([]);
  });

  it("un pago sin referencia externa no es nuestro", async () => {
    const { puertos } = pedidoFalso("pendiente");
    const r = await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("approved", null)),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "sin_referencia" });
  });

  it("un pago de un pedido que no conocemos no se toca", async () => {
    const { puertos, escrituras } = pedidoFalso("pendiente");
    const r = await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("approved", "DE-OTRA-APP")),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "pedido_desconocido" });
    expect(escrituras).toEqual([]);
  });

  it("un pedido que nunca vio un pago (estadoPago null) acepta el primero", async () => {
    const { puertos, escrituras } = pedidoFalso(null);
    await procesarNotificacionDePago({
      pagoId: "111",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, pagoCrudo("pending")),
      ...puertos,
    });
    expect(escrituras).toEqual([{ estado: "pendiente", pagoId: "111" }]);
  });
});

describe("reconciliarPago", () => {
  it("busca por referencia y aplica el pago que manda", async () => {
    const { puertos, escrituras } = pedidoFalso("pendiente");
    const r = await reconciliarPago({
      referenciaExterna: "P-1",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, {
        results: [pagoCrudo("rejected", "P-1", 1), pagoCrudo("approved", "P-1", 2)],
      }),
      ...puertos,
    });
    expect(r).toMatchObject({ aplicado: true, estado: "aprobado", pagoId: "2" });
    expect(escrituras).toEqual([{ estado: "aprobado", pagoId: "2" }]);
  });

  it("sin pagos en MP no hay nada que aplicar", async () => {
    const { puertos, escrituras } = pedidoFalso("pendiente");
    const r = await reconciliarPago({
      referenciaExterna: "P-1",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, { results: [] }),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "pago_inexistente" });
    expect(escrituras).toEqual([]);
  });

  it("si el estado ya es el que dice MP, no reescribe", async () => {
    const { puertos, escrituras } = pedidoFalso("aprobado");
    const r = await reconciliarPago({
      referenciaExterna: "P-1",
      accessToken: "T",
      fetch: fetchQueDevuelve(200, { results: [pagoCrudo("approved", "P-1", 2)] }),
      ...puertos,
    });
    expect(r).toEqual({ aplicado: false, motivo: "sin_cambios" });
    expect(escrituras).toEqual([]);
  });
});
