import { describe, expect, it } from "vitest";
import { leerNotificacion } from "../src/notificacion.js";

const URL_BASE = "https://tienda.com/api/mercadopago/webhook";

describe("leerNotificacion", () => {
  it("lee el formato nuevo: type y data.id en el cuerpo", () => {
    const n = leerNotificacion({
      url: URL_BASE,
      cuerpo: { type: "payment", data: { id: "123" } },
    });
    expect(n).toEqual({
      tipo: "payment",
      dataId: "123",
      esPago: true,
      esContracargo: false,
    });
  });

  it("lee el formato viejo: topic y id en el cuerpo", () => {
    const n = leerNotificacion({
      url: URL_BASE,
      cuerpo: { topic: "payment", id: 456 },
    });
    expect(n.dataId).toBe("456");
    expect(n.esPago).toBe(true);
  });

  it("lee el id de la query en sus tres formas", () => {
    for (const query of ["data.id=789", "data_id=789", "id=789"]) {
      const n = leerNotificacion({
        url: `${URL_BASE}?type=payment&${query}`,
        cuerpo: {},
      });
      expect(n.dataId).toBe("789");
    }
  });

  it("la query le gana al cuerpo (es lo que MP manda al reintentar)", () => {
    const n = leerNotificacion({
      url: `${URL_BASE}?data.id=DELAQUERY`,
      cuerpo: { type: "payment", data: { id: "DELCUERPO" } },
    });
    expect(n.dataId).toBe("DELAQUERY");
  });

  it("reconoce los tipos con punto que manda MP", () => {
    for (const tipo of ["payment.created", "payment.updated", "PAYMENT"]) {
      const n = leerNotificacion({
        url: URL_BASE,
        cuerpo: { type: tipo, data: { id: "1" } },
      });
      expect(n.esPago).toBe(true);
    }
  });

  it("reconoce los contracargos y NO los cuenta como pago", () => {
    const n = leerNotificacion({
      url: URL_BASE,
      cuerpo: { type: "chargebacks", data: { id: "cb-1" } },
    });
    expect(n.esContracargo).toBe(true);
    expect(n.esPago).toBe(false);
  });

  it("un aviso de otra cosa no es ni pago ni contracargo", () => {
    const n = leerNotificacion({
      url: URL_BASE,
      cuerpo: { type: "merchant_order", data: { id: "5" } },
    });
    expect(n.esPago).toBe(false);
    expect(n.esContracargo).toBe(false);
    expect(n.dataId).toBe("5");
  });

  it("aguanta un cuerpo vacio o basura sin explotar", () => {
    for (const cuerpo of [{}, null, undefined, "texto", 7]) {
      const n = leerNotificacion({ url: URL_BASE, cuerpo });
      expect(n.dataId).toBeNull();
      expect(n.esPago).toBe(false);
    }
  });
});
