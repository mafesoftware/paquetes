import { describe, expect, it } from "vitest";
import { pedidoQuedoComprado, pendienteDeItem, transicionADestino, transicionPedido } from "../src/pedidos.js";

describe("transicionPedido", () => {
  it("transiciones válidas del ciclo completo", () => {
    expect(transicionPedido("borrador", "enviar")).toBe("enviado");
    expect(transicionPedido("enviado", "aprobar")).toBe("aprobado");
    expect(transicionPedido("enviado", "rechazar")).toBe("rechazado");
    expect(transicionPedido("rechazado", "reenviar")).toBe("enviado");
    expect(transicionPedido("aprobado", "cotizar")).toBe("cotizando");
    expect(transicionPedido("comprado_parcial", "cerrar")).toBe("cerrado");
    expect(transicionPedido("comprado", "cerrar")).toBe("cerrado");
  });

  it("borrador + comprar → error (comprar solo es válido en cotizando/comprado_parcial)", () => {
    const resultado = transicionPedido("borrador", "comprar");
    expect(resultado).toBeInstanceOf(Error);
  });

  it("cerrado no admite ningún evento", () => {
    expect(transicionPedido("cerrado", "enviar")).toBeInstanceOf(Error);
    expect(transicionPedido("cerrado", "cerrar")).toBeInstanceOf(Error);
  });

  it("comprar desde cotizando: pendiente > 0 → comprado_parcial", () => {
    const resultado = transicionPedido("cotizando", "comprar", { pendienteCero: false });
    expect(resultado).toBe("comprado_parcial");
  });

  it("comprar desde comprado_parcial: pendiente = 0 → comprado", () => {
    const resultado = transicionPedido("comprado_parcial", "comprar", { pendienteCero: true });
    expect(resultado).toBe("comprado");
  });
});

describe("transicionADestino (kanban)", () => {
  it("aprobado → cotizando (arrastrar de 'Aprobado' a 'Cotizando')", () => {
    expect(transicionADestino("aprobado", "cotizando")).toBe("cotizando");
  });

  it("destino sin evento que lo alcance → error", () => {
    expect(transicionADestino("borrador", "comprado")).toBeInstanceOf(Error);
  });
});

describe("pendienteDeItem / pedidoQuedoComprado", () => {
  it("OC de 850 ladrillos contra un pedido de 1.000 → pendiente 150", () => {
    expect(pendienteDeItem("1000", "850")).toBe("150.0000");
  });

  it("OC por el resto (150) → pendiente 0, el pedido queda comprado", () => {
    expect(pendienteDeItem("1000", "1000")).toBe("0.0000");
    expect(pedidoQuedoComprado([{ cantidadPedida: "1000", cantidadComprada: "1000" }])).toBe(true);
  });

  it("con dos ítems, alcanza que UNO tenga pendiente para que el pedido no esté completo", () => {
    const items = [
      { cantidadPedida: "1000", cantidadComprada: "1000" }, // ladrillos: completo
      { cantidadPedida: "50", cantidadComprada: "0" }, // cemento: nada comprado todavía
    ];
    expect(pedidoQuedoComprado(items)).toBe(false);
  });
});
