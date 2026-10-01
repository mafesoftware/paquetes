import { describe, expect, it } from "vitest";
import { totalesOrdenCompra, transicionOrdenCompra } from "../src/ordenes-compra.js";

describe("transicionOrdenCompra", () => {
  it("ciclo completo: borrador → pendiente_aprobacion → aprobada → enviada → entregada → facturada → cerrada", () => {
    expect(transicionOrdenCompra("borrador", "enviar_aprobacion")).toBe("pendiente_aprobacion");
    expect(transicionOrdenCompra("pendiente_aprobacion", "aprobar")).toBe("aprobada");
    expect(transicionOrdenCompra("aprobada", "enviar_proveedor")).toBe("enviada");
    expect(transicionOrdenCompra("entregada", "facturar")).toBe("facturada");
    expect(transicionOrdenCompra("facturada", "cerrar")).toBe("cerrada");
  });

  it("rechazar vuelve a borrador (la OC no tiene estado propio de rechazo)", () => {
    expect(transicionOrdenCompra("pendiente_aprobacion", "rechazar")).toBe("borrador");
  });

  it("anular es válido desde cualquier estado no terminal", () => {
    for (const estado of ["borrador", "pendiente_aprobacion", "aprobada", "enviada", "entregada_parcial", "entregada", "facturada"] as const) {
      expect(transicionOrdenCompra(estado, "anular")).toBe("anulada");
    }
  });

  it("no se puede anular una OC ya cerrada o ya anulada", () => {
    expect(transicionOrdenCompra("cerrada", "anular")).toBeInstanceOf(Error);
    expect(transicionOrdenCompra("anulada", "anular")).toBeInstanceOf(Error);
  });

  it("no se puede cerrar antes de aprobar", () => {
    expect(transicionOrdenCompra("borrador", "cerrar")).toBeInstanceOf(Error);
    expect(transicionOrdenCompra("pendiente_aprobacion", "cerrar")).toBeInstanceOf(Error);
  });

  it("evento inválido en el estado → error", () => {
    expect(transicionOrdenCompra("borrador", "aprobar")).toBeInstanceOf(Error);
    expect(transicionOrdenCompra("cerrada", "enviar_proveedor")).toBeInstanceOf(Error);
  });
});

describe("totalesOrdenCompra", () => {
  it("OC cemento 200 × $ 12.000 = $ 2.400.000 + IVA 21 % $ 504.000 = $ 2.904.000,00", () => {
    const totales = totalesOrdenCompra([{ cantidad: "200", precio: 1_200_000n, alicuotaIva: "21" }]);
    expect(totales.subtotal).toBe(240_000_000n); // $ 2.400.000,00 en centavos
    expect(totales.iva).toBe(50_400_000n); // $ 504.000,00
    expect(totales.total).toBe(290_400_000n); // $ 2.904.000,00
  });

  it("ítems con distinta alícuota de IVA se calculan por separado", () => {
    const totales = totalesOrdenCompra([
      { cantidad: "10", precio: 10_000n, alicuotaIva: "21" }, // subtotal 100.000, iva 21.000
      { cantidad: "5", precio: 20_000n, alicuotaIva: "10.5" }, // subtotal 100.000, iva 10.500
    ]);
    expect(totales.subtotal).toBe(200_000n);
    expect(totales.iva).toBe(31_500n);
    expect(totales.total).toBe(231_500n);
  });
});
