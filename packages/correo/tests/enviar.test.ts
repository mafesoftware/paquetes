/**
 * El contrato con Resend: qué se manda y cómo vuelven los errores.
 *
 * Lo que más importa: `enviarCorreo` NUNCA tira. Un mail es un aviso, y quien
 * lo dispara (una venta, una factura) no puede caerse porque el correo falló.
 */

import { describe, expect, it } from "vitest";
import { enviarCorreo, URL_API_RESEND } from "../src/index.js";

type Pedido = { url: string; init: RequestInit };

function resendFalso(respuesta: {
  status?: number;
  cuerpo?: unknown;
  tirar?: boolean;
}) {
  const pedidos: Pedido[] = [];
  const fn: typeof fetch = async (url, init) => {
    pedidos.push({ url: String(url), init: init ?? {} });
    if (respuesta.tirar) throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify(respuesta.cuerpo ?? { id: "email-1" }), {
      status: respuesta.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, pedidos };
}

const BASE = {
  apiKey: "re_test",
  de: "Bestie <no-reply-bestie@store360.com.ar>",
  para: "clienta@gmail.com",
  asunto: "Tu compra",
  html: "<p>Hola</p>",
};

describe("enviarCorreo", () => {
  it("arma el POST a /emails con el token y el cuerpo que Resend espera", async () => {
    const { fn, pedidos } = resendFalso({});
    const r = await enviarCorreo({ ...BASE, fetch: fn });

    expect(r).toEqual({ ok: true, id: "email-1" });
    expect(pedidos[0]!.url).toBe(`${URL_API_RESEND}/emails`);
    const headers = pedidos[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");

    const cuerpo = JSON.parse(String(pedidos[0]!.init.body));
    expect(cuerpo).toEqual({
      from: "Bestie <no-reply-bestie@store360.com.ar>",
      to: ["clienta@gmail.com"],
      subject: "Tu compra",
      html: "<p>Hola</p>",
    });
  });

  it("varios destinatarios viajan como lista, limpios de espacios", async () => {
    const { fn, pedidos } = resendFalso({});
    await enviarCorreo({
      ...BASE,
      para: [" duenia@bestie.com ", "socio@bestie.com"],
      fetch: fn,
    });
    const cuerpo = JSON.parse(String(pedidos[0]!.init.body));
    expect(cuerpo.to).toEqual(["duenia@bestie.com", "socio@bestie.com"]);
  });

  it("el adjunto va en base64 con su nombre, que es lo que ve quien recibe", async () => {
    const { fn, pedidos } = resendFalso({});
    await enviarCorreo({
      ...BASE,
      adjuntos: [
        {
          nombre: "factura.pdf",
          contenido: new TextEncoder().encode("PDF"),
          tipo: "application/pdf",
        },
      ],
      fetch: fn,
    });
    const cuerpo = JSON.parse(String(pedidos[0]!.init.body));
    expect(cuerpo.attachments).toEqual([
      {
        filename: "factura.pdf",
        content: Buffer.from("PDF").toString("base64"),
        content_type: "application/pdf",
      },
    ]);
  });

  it("un base64 ya armado pasa tal cual, sin recodificarse", async () => {
    const { fn, pedidos } = resendFalso({});
    await enviarCorreo({
      ...BASE,
      adjuntos: [{ nombre: "logo.png", contenido: "aWJhc2U2NA==" }],
      fetch: fn,
    });
    const cuerpo = JSON.parse(String(pedidos[0]!.init.body));
    expect(cuerpo.attachments[0].content).toBe("aWJhc2U2NA==");
  });

  it("responderA viaja como reply_to", async () => {
    const { fn, pedidos } = resendFalso({});
    await enviarCorreo({ ...BASE, responderA: "duenia@bestie.com", fetch: fn });
    const cuerpo = JSON.parse(String(pedidos[0]!.init.body));
    expect(cuerpo.reply_to).toBe("duenia@bestie.com");
  });

  it("401 es credenciales: reintentar no arregla una API key mala", async () => {
    const { fn } = resendFalso({
      status: 401,
      cuerpo: { message: "API key is invalid" },
    });
    const r = await enviarCorreo({ ...BASE, fetch: fn });
    expect(r).toEqual({
      ok: false,
      categoria: "credenciales",
      error: "API key is invalid",
    });
  });

  it("429 es limite y 500 es red: los dos se arreglan reintentando", async () => {
    const { fn: f429 } = resendFalso({ status: 429, cuerpo: {} });
    const r429 = await enviarCorreo({ ...BASE, fetch: f429 });
    expect(r429.ok).toBe(false);
    if (!r429.ok) expect(r429.categoria).toBe("limite");

    const { fn: f500 } = resendFalso({ status: 500, cuerpo: {} });
    const r500 = await enviarCorreo({ ...BASE, fetch: f500 });
    expect(r500.ok).toBe(false);
    if (!r500.ok) expect(r500.categoria).toBe("red");
  });

  it("un fetch que explota NO tira: vuelve como error de red", async () => {
    const { fn } = resendFalso({ tirar: true });
    const r = await enviarCorreo({ ...BASE, fetch: fn });
    expect(r).toEqual({
      ok: false,
      categoria: "red",
      error: "No se pudo llegar a Resend.",
    });
  });

  it("valida ANTES de tocar la red: sin key, sin destino, sin cuerpo", async () => {
    const { fn, pedidos } = resendFalso({});

    const sinKey = await enviarCorreo({ ...BASE, apiKey: "  ", fetch: fn });
    expect(sinKey.ok).toBe(false);
    if (!sinKey.ok) expect(sinKey.categoria).toBe("credenciales");

    const sinDestino = await enviarCorreo({ ...BASE, para: [], fetch: fn });
    expect(sinDestino.ok).toBe(false);

    const destinoRoto = await enviarCorreo({
      ...BASE,
      para: "no es un mail",
      fetch: fn,
    });
    expect(destinoRoto.ok).toBe(false);

    const sinCuerpo = await enviarCorreo({
      ...BASE,
      html: undefined,
      fetch: fn,
    });
    expect(sinCuerpo.ok).toBe(false);

    expect(pedidos).toHaveLength(0);
  });
});
