import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorMP } from "../src/errores.js";
import {
  esPathInterno,
  iniciarVinculacion,
  resolverVinculacion,
  rutaWebhook,
} from "../src/next/index.js";

const SECRETO = "secreto";
const URL_WEBHOOK = "https://bestie.com/api/mercadopago/webhook";

function pedidoFirmado(dataId: string, cuerpo: unknown, requestId = "req-1") {
  const ts = "1704908010";
  const v1 = createHmac("sha256", SECRETO)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return new Request(URL_WEBHOOK, {
    method: "POST",
    headers: {
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
      "content-type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });
}

describe("rutaWebhook", () => {
  it("procesa un pago con firma valida y responde 200", async () => {
    const recibidos: string[] = [];
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async (pagoId) => {
        recibidos.push(pagoId);
      },
    });
    const respuesta = await handler(
      pedidoFirmado("111", { type: "payment", data: { id: "111" } })
    );
    expect(respuesta.status).toBe(200);
    expect(recibidos).toEqual(["111"]);
  });

  it("responde 401 y NO procesa si la firma no valida", async () => {
    const recibidos: string[] = [];
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async (pagoId) => {
        recibidos.push(pagoId);
      },
    });
    const pedido = new Request(URL_WEBHOOK, {
      method: "POST",
      headers: { "x-signature": "ts=1,v1=falsa", "x-request-id": "req-1" },
      body: JSON.stringify({ type: "payment", data: { id: "111" } }),
    });
    const respuesta = await handler(pedido);
    expect(respuesta.status).toBe(401);
    expect(recibidos).toEqual([]);
  });

  it("un aviso que no es de pago responde 200 sin procesar", async () => {
    const recibidos: string[] = [];
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async (pagoId) => {
        recibidos.push(pagoId);
      },
    });
    const respuesta = await handler(
      pedidoFirmado("5", { type: "merchant_order", data: { id: "5" } })
    );
    expect(respuesta.status).toBe(200);
    expect(recibidos).toEqual([]);
  });

  it("un contracargo va a su propio handler", async () => {
    const contracargos: string[] = [];
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async () => {},
      alRecibirContracargo: async (id) => {
        contracargos.push(id);
      },
    });
    const respuesta = await handler(
      pedidoFirmado("cb-1", { type: "chargebacks", data: { id: "cb-1" } })
    );
    expect(respuesta.status).toBe(200);
    expect(contracargos).toEqual(["cb-1"]);
  });

  it("un fallo PASAJERO responde 500 para que MP reintente", async () => {
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async () => {
        throw new ErrorMP("red", "se cayo la base");
      },
    });
    const respuesta = await handler(
      pedidoFirmado("111", { type: "payment", data: { id: "111" } })
    );
    expect(respuesta.status).toBe(500);
  });

  it("un fallo DEFINITIVO responde 200: reintentar no lo va a arreglar", async () => {
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async () => {
        throw new ErrorMP("credenciales", "token revocado");
      },
    });
    const respuesta = await handler(
      pedidoFirmado("111", { type: "payment", data: { id: "111" } })
    );
    expect(respuesta.status).toBe(200);
  });

  it("un error nuestro cualquiera responde 500: mejor que MP reintente a perder el pago", async () => {
    const handler = rutaWebhook({
      secreto: SECRETO,
      alRecibirPago: async () => {
        throw new TypeError("undefined is not a function");
      },
    });
    const respuesta = await handler(
      pedidoFirmado("111", { type: "payment", data: { id: "111" } })
    );
    expect(respuesta.status).toBe(500);
  });

  it("un cuerpo que no es JSON no rompe la ruta", async () => {
    const handler = rutaWebhook({
      secreto: SECRETO,
      permitirSinSecreto: false,
      alRecibirPago: async () => {},
    });
    const pedido = new Request(`${URL_WEBHOOK}?type=payment&data.id=111`, {
      method: "POST",
      headers: { "x-signature": "ts=1,v1=x", "x-request-id": "r" },
      body: "no soy json",
    });
    const respuesta = await handler(pedido);
    expect(respuesta.status).toBe(401); // firma mala, pero no explotó
  });
});

describe("esPathInterno", () => {
  it("acepta paths internos", () => {
    expect(esPathInterno("/cuenta")).toBe(true);
    expect(esPathInterno("/admin/pagos?ok=1")).toBe(true);
  });

  it("rechaza cualquier cosa que pueda sacar a la persona del sitio", () => {
    for (const malo of [
      "https://evil.com",
      "//evil.com",
      "http://x",
      "cuenta",
      "",
      null,
      undefined,
    ]) {
      expect(esPathInterno(malo)).toBe(false);
    }
  });
});

describe("iniciarVinculacion", () => {
  it("arma la URL con el state y deja la cookie del nonce", () => {
    const { url, cookies } = iniciarVinculacion({
      clientId: "CLIENT",
      redirectUri: "https://bestie.com/api/mercadopago/callback",
      objetivo: "bestie",
      nonce: "NONCE",
      seguro: true,
    });
    expect(new URL(url).searchParams.get("state")).toBe("bestie:NONCE");
    const cookieNonce = cookies.find((c) => c.nombre === "mp_oauth_nonce");
    expect(cookieNonce?.valor).toBe("NONCE");
    expect(cookieNonce?.opciones.httpOnly).toBe(true);
    expect(cookieNonce?.opciones.secure).toBe(true);
    expect(cookieNonce?.opciones.sameSite).toBe("lax");
  });

  it("guarda el volverA solo si es un path interno", () => {
    const conPath = iniciarVinculacion({
      clientId: "C",
      redirectUri: "https://x/cb",
      objetivo: "bestie",
      nonce: "N",
      volverA: "/admin/pagos",
    });
    expect(conPath.cookies.some((c) => c.nombre === "mp_oauth_volver")).toBe(true);

    const conUrlExterna = iniciarVinculacion({
      clientId: "C",
      redirectUri: "https://x/cb",
      objetivo: "bestie",
      nonce: "N",
      volverA: "https://evil.com",
    });
    expect(conUrlExterna.cookies.some((c) => c.nombre === "mp_oauth_volver")).toBe(
      false
    );
  });
});

describe("resolverVinculacion", () => {
  const leerCookie = (mapa: Record<string, string>) => (n: string) => mapa[n];

  it("acepta cuando el nonce del state coincide con la cookie", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?code=CODE&state=bestie:NONCE",
      leerCookie: leerCookie({
        mp_oauth_nonce: "NONCE",
        mp_oauth_volver: "/admin/pagos",
      }),
    });
    expect(r).toEqual({
      ok: true,
      objetivo: "bestie",
      code: "CODE",
      volverA: "/admin/pagos",
    });
  });

  it("rechaza si el nonce NO coincide: alguien inyecto un code ajeno", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?code=CODE&state=bestie:OTRO",
      leerCookie: leerCookie({ mp_oauth_nonce: "NONCE" }),
    });
    expect(r).toEqual({ ok: false, motivo: "nonce_no_coincide" });
  });

  it("rechaza si no hay cookie de nonce", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?code=CODE&state=bestie:NONCE",
      leerCookie: leerCookie({}),
    });
    expect(r).toEqual({ ok: false, motivo: "nonce_no_coincide" });
  });

  it("rechaza un state viejo sin nonce", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?code=CODE&state=bestie",
      leerCookie: leerCookie({ mp_oauth_nonce: "NONCE" }),
    });
    expect(r).toEqual({ ok: false, motivo: "state_invalido" });
  });

  it("rechaza si no vino el code", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?state=bestie:NONCE",
      leerCookie: leerCookie({ mp_oauth_nonce: "NONCE" }),
    });
    expect(r).toEqual({ ok: false, motivo: "sin_code" });
  });

  it("ignora un volverA externo aunque este en la cookie", () => {
    const r = resolverVinculacion({
      url: "https://bestie.com/cb?code=C&state=bestie:NONCE",
      leerCookie: leerCookie({
        mp_oauth_nonce: "NONCE",
        mp_oauth_volver: "https://evil.com",
      }),
    });
    expect(r).toEqual({ ok: true, objetivo: "bestie", code: "C", volverA: null });
  });
});
