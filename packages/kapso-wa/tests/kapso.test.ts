import { describe, it, expect, vi } from "vitest";
import {
  aNumeroWhatsApp,
  bajarMedia,
  crearCliente,
  crearPlantilla,
  crearSetupLink,
  dentroDeVentana24h,
  enviarAviso,
  enviarBotones,
  enviarLista,
  enviarPlantilla,
  enviarTexto,
  EVENTOS_WEBHOOK_NUMERO,
  leerEventoWebhook,
  leerEventosWebhook,
  listarPlantillas,
  listarWebhooksNumero,
  registrarWebhookNumero,
  verificarFirmaWebhook,
  type FetchLike,
} from "../src/index.ts";
import { createHmac } from "node:crypto";

/** Un `fetch` de mentira que anota lo que le pidieron. */
function espia(respuesta: { estado?: number; cuerpo?: unknown; texto?: string } = {}) {
  const llamadas: { url: string; init: RequestInit; cuerpo: any }[] = [];
  const fetch: FetchLike = async (url, init) => {
    llamadas.push({
      url,
      init: init ?? {},
      cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const texto = respuesta.texto ?? JSON.stringify(respuesta.cuerpo ?? { messages: [{ id: "wamid.1" }] });
    return new Response(texto, { status: respuesta.estado ?? 200 });
  };
  return { fetch, llamadas };
}

const cred = (fetch: FetchLike) => ({ apiKey: "k_test", phoneNumberId: "pn_1", fetch });

describe("aNumeroWhatsApp", () => {
  it("normaliza las formas en que se tipea un celular argentino", () => {
    for (const entrada of [
      "1145678901",
      "011 4567-8901",
      "+54 9 11 4567 8901",
      "5491145678901",
      "54 11 4567 8901",
      "011 15 4567-8901",
      "0011 4567 8901",
    ]) {
      expect(aNumeroWhatsApp(entrada)).toBe("5491145678901");
    }
  });
  it("un celular del interior", () => {
    expect(aNumeroWhatsApp("0261 659-4040")).toBe("5492616594040");
  });
  it("NUNCA adivina: devuelve null si no se reconoce", () => {
    // Mandarle el aviso de deuda de un socio a otra persona es peor que no mandarlo.
    for (const basura of ["", "   ", "hola", "123", "12345678901234567890", null, undefined]) {
      expect(aNumeroWhatsApp(basura as never)).toBeNull();
    }
  });
  it("otro pais", () => {
    expect(aNumeroWhatsApp("99123456", "598")).toBe("59899123456");
    expect(aNumeroWhatsApp("59899123456", "598")).toBe("59899123456");
  });
});

describe("enviarTexto", () => {
  it("pega en el endpoint de Kapso con la clave en el header", async () => {
    const { fetch, llamadas } = espia();
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: true, id: "wamid.1" });
    expect(llamadas[0]!.url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/pn_1/messages");
    expect((llamadas[0]!.init.headers as any)["X-API-Key"]).toBe("k_test");
    expect(llamadas[0]!.cuerpo).toEqual({
      messaging_product: "whatsapp",
      to: "5491145678901",
      type: "text",
      text: { body: "Hola", preview_url: false },
    });
  });

  it("sin clave no sale a la red", async () => {
    const { fetch, llamadas } = espia();
    const r = await enviarTexto({ apiKey: "", phoneNumberId: "pn_1", fetch }, "549114", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(llamadas).toHaveLength(0);
  });

  it("sin phoneNumberId tampoco", async () => {
    const { fetch, llamadas } = espia();
    const r = await enviarTexto({ apiKey: "k", phoneNumberId: "", fetch }, "549114", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(llamadas).toHaveLength(0);
  });

  it("un destinatario vacio no sale a la red", async () => {
    const { fetch, llamadas } = espia();
    const r = await enviarTexto(cred(fetch), "", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "numero" });
    expect(llamadas).toHaveLength(0);
  });
});

describe("nunca tira: un aviso no puede tumbar la operacion que lo dispara", () => {
  it("la red caida devuelve un resultado, no una excepcion", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: false, categoria: "red", error: "ECONNREFUSED" });
  });

  it("una respuesta que no es JSON tampoco revienta", async () => {
    const { fetch } = espia({ estado: 500, texto: "<html>502 Bad Gateway</html>" });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "red", estado: 500 });
  });

  it("un 200 con un cuerpo raro devuelve ok con id vacio: el mensaje YA salio", async () => {
    const { fetch } = espia({ cuerpo: { algo: "distinto" } });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: true, id: "" });
  });
});

describe("categorias de error: dicen si reintentar sirve", () => {
  const casos: [number, string, string][] = [
    [402, "Paid WhatsApp sends are paused until the billing issue is resolved", "facturacion"],
    [401, "unauthorized", "credenciales"],
    [403, "forbidden", "credenciales"],
    [429, "too many requests", "limite"],
    [500, "boom", "red"],
    [503, "unavailable", "red"],
    [400, "template name does not exist", "plantilla"],
    [400, "recipient phone number not valid", "numero"],
    [400, "cualquier otra cosa", "rechazado"],
  ];
  for (const [estado, texto, categoria] of casos) {
    it(`${estado} ${texto.slice(0, 30)} → ${categoria}`, async () => {
      const { fetch } = espia({ estado, texto: JSON.stringify({ error: { message: texto } }) });
      const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
      expect(r).toMatchObject({ ok: false, categoria, estado });
    });
  }

  it("el 402 conserva el mensaje de Kapso, que es lo que hay que leerle a una persona", async () => {
    const { fetch } = espia({
      estado: 402,
      texto: JSON.stringify({ error: { message: "Paid WhatsApp sends are paused" } }),
    });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, error: "Paid WhatsApp sends are paused" });
  });
});

describe("enviarPlantilla", () => {
  it("arma el cuerpo con los parametros POSICIONALES", async () => {
    const { fetch, llamadas } = espia();
    await enviarPlantilla(cred(fetch), "5491145678901", "gf_cuota_vence", ["Juan", "$ 12.500", "10/09"]);
    expect(llamadas[0]!.cuerpo.template).toEqual({
      name: "gf_cuota_vence",
      language: { code: "es_AR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Juan" },
            { type: "text", text: "$ 12.500" },
            { type: "text", text: "10/09" },
          ],
        },
      ],
    });
  });

  it("sin parametros no manda components", async () => {
    const { fetch, llamadas } = espia();
    await enviarPlantilla(cred(fetch), "5491145678901", "gf_bienvenida");
    expect(llamadas[0]!.cuerpo.template.components).toBeUndefined();
  });

  it("acepta el idioma por parametro", async () => {
    const { fetch, llamadas } = espia();
    await enviarPlantilla(cred(fetch), "5491145678901", "gf_x", [], "es_MX");
    expect(llamadas[0]!.cuerpo.template.language.code).toBe("es_MX");
  });
});

describe("enviarBotones", () => {
  it("arma un interactivo con nuestro propio id adentro", async () => {
    const { fetch, llamadas } = espia();
    await enviarBotones(cred(fetch), "5491145678901", "¿Confirmás?", [
      { id: "reserva:abc123:si", titulo: "Sí" },
      { id: "reserva:abc123:no", titulo: "No" },
    ]);
    expect(llamadas[0]!.cuerpo.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "reserva:abc123:si", title: "Sí" } },
      { type: "reply", reply: { id: "reserva:abc123:no", title: "No" } },
    ]);
  });

  it("frena en 3 botones con un mensaje entendible, en vez del error opaco de Meta", async () => {
    const { fetch, llamadas } = espia();
    const r = await enviarBotones(cred(fetch), "549114", "x", [
      { id: "1", titulo: "a" },
      { id: "2", titulo: "b" },
      { id: "3", titulo: "c" },
      { id: "4", titulo: "d" },
    ]);
    expect(r).toMatchObject({ ok: false, categoria: "rechazado" });
    expect((r as any).error).toContain("3 botones");
    expect(llamadas).toHaveLength(0);
  });

  it("sin botones no manda nada", async () => {
    const { fetch, llamadas } = espia();
    expect(await enviarBotones(cred(fetch), "549114", "x", [])).toMatchObject({ ok: false });
    expect(llamadas).toHaveLength(0);
  });

  it("recorta los titulos al limite de WhatsApp", async () => {
    const { fetch, llamadas } = espia();
    await enviarBotones(cred(fetch), "549114", "x", [
      { id: "1", titulo: "Un titulo larguisimo que Meta no acepta" },
    ]);
    expect(llamadas[0]!.cuerpo.interactive.action.buttons[0].reply.title).toHaveLength(20);
  });

  it("encabezado y pie son opcionales", async () => {
    const { fetch, llamadas } = espia();
    await enviarBotones(cred(fetch), "549114", "x", [{ id: "1", titulo: "a" }], {
      encabezado: "Reserva",
      pie: "Club Atlético",
    });
    expect(llamadas[0]!.cuerpo.interactive.header).toEqual({ type: "text", text: "Reserva" });
    // El footer de Cloud API NO lleva `type`; el header si. Mandarselo da 400.
    expect(llamadas[0]!.cuerpo.interactive.footer).toEqual({ text: "Club Atlético" });
  });
});

describe("enviarLista", () => {
  it("arma las secciones", async () => {
    const { fetch, llamadas } = espia();
    await enviarLista(cred(fetch), "549114", "Turnos libres", "Ver turnos", [
      {
        titulo: "Miércoles",
        opciones: [
          { id: "t:1", titulo: "18:00", descripcion: "Cancha 1" },
          { id: "t:2", titulo: "19:00" },
        ],
      },
    ]);
    const accion = llamadas[0]!.cuerpo.interactive.action;
    expect(accion.button).toBe("Ver turnos");
    expect(accion.sections[0].rows).toEqual([
      { id: "t:1", title: "18:00", description: "Cancha 1" },
      { id: "t:2", title: "19:00" },
    ]);
  });

  it("frena en 10 opciones contando TODAS las secciones", async () => {
    const { fetch, llamadas } = espia();
    const seccion = (n: number) => ({
      titulo: `S${n}`,
      opciones: Array.from({ length: 6 }, (_, i) => ({ id: `${n}:${i}`, titulo: `o${i}` })),
    });
    const r = await enviarLista(cred(fetch), "549114", "x", "Ver", [seccion(1), seccion(2)]);
    expect(r).toMatchObject({ ok: false, categoria: "rechazado" });
    expect((r as any).error).toContain("10 opciones");
    expect(llamadas).toHaveLength(0);
  });

  it("una lista sin opciones no se manda", async () => {
    const { fetch } = espia();
    expect(await enviarLista(cred(fetch), "549114", "x", "Ver", [])).toMatchObject({ ok: false });
  });
});

describe("dentroDeVentana24h", () => {
  const ahora = new Date("2026-09-09T12:00:00Z");
  it("adentro", () => {
    expect(dentroDeVentana24h(new Date("2026-09-09T11:00:00Z"), ahora)).toBe(true);
  });
  it("justo en el borde ya esta afuera", () => {
    expect(dentroDeVentana24h(new Date("2026-09-08T12:00:00Z"), ahora)).toBe(false);
  });
  it("un minuto antes del borde, adentro", () => {
    expect(dentroDeVentana24h(new Date("2026-09-08T12:01:00Z"), ahora)).toBe(true);
  });
  it("nunca escribio: afuera", () => {
    expect(dentroDeVentana24h(null, ahora)).toBe(false);
    expect(dentroDeVentana24h(undefined, ahora)).toBe(false);
  });
  it("un mensaje del FUTURO no abre la ventana", () => {
    expect(dentroDeVentana24h(new Date("2026-09-10T12:00:00Z"), ahora)).toBe(false);
  });
});

describe("enviarAviso: elige solo texto o plantilla", () => {
  const ahora = new Date("2026-09-09T12:00:00Z");
  const opciones = {
    texto: "Tu cuota vence el 10",
    plantilla: "gf_cuota_vence",
    parametros: ["Juan", "10/09"],
    ahora,
  };

  it("adentro de la ventana manda texto libre, que es gratis", async () => {
    const { fetch, llamadas } = espia();
    await enviarAviso(cred(fetch), "549114", {
      ...opciones,
      ultimoMensajeEntrante: new Date("2026-09-09T11:00:00Z"),
    });
    expect(llamadas[0]!.cuerpo.type).toBe("text");
  });

  it("afuera manda la plantilla, que es lo unico que sale en frio", async () => {
    const { fetch, llamadas } = espia();
    await enviarAviso(cred(fetch), "549114", { ...opciones, ultimoMensajeEntrante: null });
    expect(llamadas[0]!.cuerpo.type).toBe("template");
    expect(llamadas[0]!.cuerpo.template.name).toBe("gf_cuota_vence");
  });
});

describe("leerEventoWebhook: nunca tira, lo raro se ignora", () => {
  it("un mensaje de texto", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: {
        phone_number_id: "pn_1",
        message: { id: "wamid.9", from: "5491145678901", text: { body: "¿Cuánto debo?" }, timestamp: "1789000000" },
      },
    });
    expect(e).toEqual({
      tipo: "mensaje",
      mensaje: {
        tipo: "texto",
        de: "5491145678901",
        phoneNumberId: "pn_1",
        texto: "¿Cuánto debo?",
        mensajeId: "wamid.9",
        fechaHora: new Date(1789000000 * 1000),
      },
    });
  });

  it("el timestamp de Cloud API viene en SEGUNDOS y como texto", () => {
    // Pasarlo directo a new Date() da 1970 y el aviso queda fuera de todo rango.
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "x" }, timestamp: "1789000000" } },
    });
    expect((e as any).mensaje.fechaHora.getUTCFullYear()).toBe(2026);
  });

  it("un boton devuelve NUESTRO payload", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: {
        phone_number_id: "pn_1",
        message: {
          id: "wamid.9",
          from: "549114",
          interactive: { type: "button_reply", button_reply: { id: "reserva:abc:si", title: "Sí" } },
        },
      },
    });
    expect(e).toMatchObject({
      tipo: "mensaje",
      mensaje: { tipo: "boton", payload: "reserva:abc:si", texto: "Sí" },
    });
  });

  it("una opcion de lista", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: {
        message: {
          id: "m",
          from: "549114",
          interactive: { type: "list_reply", list_reply: { id: "turno:18", title: "18:00" } },
        },
      },
    });
    expect(e).toMatchObject({ tipo: "mensaje", mensaje: { tipo: "opcion_lista", payload: "turno:18" } });
  });

  it("un audio sale como 'audio' con su media, no como texto vacio", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", type: "audio", audio: { id: "a" } } },
    });
    expect(e).toMatchObject({ tipo: "mensaje", mensaje: { tipo: "audio", texto: "", media: { id: "a" } } });
  });

  it("un tipo que no se conoce (sticker, reacción) sigue saliendo como 'otro'", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", type: "reaction", reaction: { emoji: "👍" } } },
    });
    expect(e).toMatchObject({ tipo: "mensaje", mensaje: { tipo: "otro", texto: "" } });
    expect((e as any).mensaje.media).toBeUndefined();
  });

  it("un estado por evento, porque status_updated NO existe", () => {
    for (const [evento, estado] of [
      ["whatsapp.message.delivered", "delivered"],
      ["whatsapp.message.read", "read"],
      ["whatsapp.message.failed", "failed"],
      ["whatsapp.message.sent", "sent"],
    ]) {
      const e = leerEventoWebhook({ event: evento, data: { message: { id: "wamid.9" } } });
      expect(e).toMatchObject({ tipo: "estado", mensajeId: "wamid.9", estado });
    }
  });

  it("el nombre inventado status_updated se ignora, no se traga como estado", () => {
    const e = leerEventoWebhook({ event: "whatsapp.message.status_updated", data: { id: "x" } });
    expect(e.tipo).toBe("ignorado");
  });

  it("una conexion de numero", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.phone_number.created",
      data: { phone_number_id: "pn_9", customer_id: "cus_1", display_phone_number: "+5491145678901" },
    });
    expect(e).toEqual({
      tipo: "numero_conectado",
      clienteId: "cus_1",
      phoneNumberId: "pn_9",
      telefono: "+5491145678901",
    });
  });

  it("una desconexion", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.phone_number.deleted",
      data: { phone_number_id: "pn_9", customer_id: "cus_1" },
    });
    expect(e).toMatchObject({ tipo: "numero_desconectado", clienteId: "cus_1" });
  });

  it("todo lo que no se entiende se IGNORA, para poder contestar 200", () => {
    // Contestar error haria que Kapso reintente el mismo cuerpo para siempre y
    // los eventos que si importan queden atras en la cola.
    for (const basura of [null, undefined, "hola", 42, [], {}, { event: "algo.raro" }, { event: "whatsapp.message.received" }]) {
      expect(leerEventoWebhook(basura).tipo).toBe("ignorado");
    }
  });

  it("una conexion sin ids se ignora en vez de crear un club fantasma", () => {
    expect(leerEventoWebhook({ event: "whatsapp.phone_number.created", data: {} }).tipo).toBe("ignorado");
  });
});

describe("onboarding", () => {
  it("crearCliente prefija el id externo con la aplicacion", async () => {
    // El webhook de conexion trae SOLO el id de cliente, nunca el producto.
    const { fetch, llamadas } = espia({ cuerpo: { id: "cus_1", external_customer_id: "gestionflow:club_9" } });
    const r = await crearCliente({ apiKey: "k", fetch }, "Club Atlético del Oeste", "club_9");
    expect(llamadas[0]!.cuerpo.customer.external_customer_id).toBe("gestionflow:club_9");
    expect(r).toEqual({ ok: true, cliente: { id: "cus_1", externalCustomerId: "gestionflow:club_9" } });
  });

  it("crearCliente tolera que la respuesta venga envuelta en data", async () => {
    const { fetch } = espia({ cuerpo: { data: { id: "cus_2", external_customer_id: "gestionflow:x" } } });
    const r = await crearCliente({ apiKey: "k", fetch }, "Club", "x");
    expect(r).toMatchObject({ ok: true, cliente: { id: "cus_2" } });
  });

  it("crearSetupLink pide COEXISTENCIA siempre", async () => {
    // Dedicated le apaga la app de WhatsApp Business al club, que la usa todo el dia.
    const { fetch, llamadas } = espia({ cuerpo: { url: "https://kapso.ai/s/abc", expires_at: "2026-10-09" } });
    const r = await crearSetupLink({ apiKey: "k", fetch }, "cus_1");
    expect(llamadas[0]!.cuerpo.setup_link.allowed_connection_types).toEqual(["coexistence"]);
    expect(r).toEqual({ ok: true, url: "https://kapso.ai/s/abc", expira: "2026-10-09" });
  });

  it("el modo de facturacion se elige POR CLUB, no por entorno", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { url: "u" } });
    await crearSetupLink({ apiKey: "k", fetch }, "cus_1", { metaBilling: "partner_managed" });
    expect(llamadas[0]!.cuerpo.setup_link.meta_billing_mode).toBe("partner_managed");
  });

  it("por defecto lo paga el club, que es el caso que siempre funciona", async () => {
    // partner_managed NO anda con una WABA en pesos, y una WABA argentina con
    // tarjeta local ya configurada queda en pesos.
    const { fetch, llamadas } = espia({ cuerpo: { url: "u" } });
    await crearSetupLink({ apiKey: "k", fetch }, "cus_1");
    expect(llamadas[0]!.cuerpo.setup_link.meta_billing_mode).toBe("customer_managed");
  });

  it("una respuesta sin url no se hace pasar por exito", async () => {
    const { fetch } = espia({ cuerpo: { algo: "raro" } });
    expect(await crearSetupLink({ apiKey: "k", fetch }, "cus_1")).toMatchObject({ ok: false });
  });

  it("un error del onboarding trae su categoria", async () => {
    const { fetch } = espia({ estado: 401, texto: JSON.stringify({ error: { message: "bad key" } }) });
    expect(await crearCliente({ apiKey: "k", fetch }, "Club", "x")).toMatchObject({
      ok: false,
      categoria: "credenciales",
    });
  });
});

describe("el 15 se saca solo si sobran dígitos", () => {
  /**
   * Con diez dígitos el número ya está en formato nacional: no hay 15 de acceso
   * que quitar, y el "15" que aparezca es parte del número local.
   *
   * Se sacaba igual, así que un socio con un número como `11 1523-4567` quedaba
   * en ocho dígitos y la función devolvía `null`. Ese socio no se identificaba
   * nunca cuando le escribía al WhatsApp del club: Lia lo trataba como
   * desconocido y no había nada en ninguna pantalla que dijera por qué.
   *
   * La ambigüedad es real —mirando los dígitos no se distingue el 15 de acceso
   * del 15 que arranca la parte local— y el largo es lo único que la resuelve.
   */
  it("un número de diez dígitos con 15 en la parte local se respeta", () => {
    expect(aNumeroWhatsApp("1115234567")).toBe("5491115234567");
    expect(aNumeroWhatsApp("11 1523-4567")).toBe("5491115234567");
  });

  it("pero el 15 de acceso se sigue sacando cuando sobra", () => {
    expect(aNumeroWhatsApp("011 15 4567-8901")).toBe("5491145678901");
    expect(aNumeroWhatsApp("0351 15 456-7890")).toBe("5493514567890");
  });

  it("los formatos de siempre no se movieron", () => {
    for (const entrada of ["011 4567-8901", "11 4567-8901", "+54 9 11 4567-8901", "+54 11 4567-8901", "5491145678901", "005491145678901"]) {
      expect(aNumeroWhatsApp(entrada), entrada).toBe("5491145678901");
    }
  });

  it("y lo que no se reconoce sigue siendo null, nunca un número adivinado", () => {
    // Mandarle el aviso de deuda de un socio a otra persona es peor que no
    // mandarlo.
    for (const entrada of ["", "4567", "no tengo", "123", "1".repeat(20)]) {
      expect(aNumeroWhatsApp(entrada), entrada).toBeNull();
    }
  });
});

describe("un mensaje entrante no puede ser de cualquier tamaño", () => {
  /**
   * WhatsApp topea un mensaje en 4096 caracteres, así que más que eso no viene
   * de una persona.
   *
   * Sin corte, ese cuerpo se guardaba entero en la tabla de mensajes y se le
   * pasaba al asistente: un solo POST con megabytes de texto llena la base y
   * deja el hilo del club inservible. El webhook está firmado, así que hace
   * falta que la clave se filtre para llegar acá — y una clave filtrada es
   * exactamente el escenario en el que este límite importa.
   */
  it("el texto se recorta", () => {
    const largo = "a".repeat(50_000);
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { phone_number_id: "123", message: { from: "5491145678901", id: "m1", text: { body: largo } } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.texto.length).toBeLessThanOrEqual(4096);
  });

  it("y el payload de un botón también", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: {
        phone_number_id: "123",
        message: {
          from: "5491145678901",
          id: "m2",
          interactive: { type: "button_reply", button_reply: { id: "x".repeat(50_000), title: "y".repeat(50_000) } },
        },
      },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") {
      expect(e.mensaje.texto.length).toBeLessThanOrEqual(4096);
      expect((e.mensaje.payload ?? "").length).toBeLessThanOrEqual(4096);
    }
  });

  it("un mensaje normal no se toca", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { phone_number_id: "123", message: { from: "5491145678901", id: "m3", text: { body: "hola, cuánto debo?" } } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.texto).toBe("hola, cuánto debo?");
  });
});

describe("aNumeroWhatsApp con otro pais: tambien tiene piso y techo", () => {
  it("menos de 8 digitos no es un numero", () => {
    expect(aNumeroWhatsApp("9912345", "598")).toBeNull();
  });
  it("mas de 15 digitos tampoco", () => {
    expect(aNumeroWhatsApp("1234567890123456", "598")).toBeNull();
  });
});

describe("enviarPlantilla con parametros en las dos formas", () => {
  it("acepta un objeto {tipo, valor}, no solo strings sueltos", async () => {
    const { fetch, llamadas } = espia();
    await enviarPlantilla(cred(fetch), "549114", "gf_cuota_vence", [
      "Juana",
      { tipo: "texto", valor: "$12.000" },
    ]);
    expect(llamadas[0]!.cuerpo.template.components[0].parameters).toEqual([
      { type: "text", text: "Juana" },
      { type: "text", text: "$12.000" },
    ]);
  });
});

describe("enviarLista: encabezado y pie tambien son opcionales ahi", () => {
  it("se agregan cuando se pasan", async () => {
    const { fetch, llamadas } = espia();
    await enviarLista(cred(fetch), "549114", "Turnos", "Ver", [{ titulo: "S1", opciones: [{ id: "1", titulo: "a" }] }], {
      encabezado: "Reservas",
      pie: "Club",
    });
    expect(llamadas[0]!.cuerpo.interactive.header).toEqual({ type: "text", text: "Reservas" });
    expect(llamadas[0]!.cuerpo.interactive.footer).toEqual({ text: "Club" });
  });
});

describe("categoria ventana: el error de fuera de las 24h", () => {
  it("un 400 que menciona la ventana de 24h categoriza como ventana", async () => {
    const { fetch } = espia({
      estado: 400,
      texto: JSON.stringify({ error: { message: "message failed to send because more than 24 hours have passed since the customer last replied to this number (window)" } }),
    });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "ventana" });
  });
});

describe("el detalle de un error sin mensaje cae al texto crudo, o al estado HTTP", () => {
  it("sin campo message en el error, usa el texto crudo de la respuesta", async () => {
    const { fetch } = espia({ estado: 400, texto: "no es json ni tiene message" });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, error: "no es json ni tiene message" });
  });
  it("sin texto en absoluto, el mensaje es el estado HTTP", async () => {
    const { fetch } = espia({ estado: 400, texto: "" });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, error: "HTTP 400" });
  });
});

describe("mensajeDe: lo que se le puede leer a un error de red", () => {
  it("un throw que no es un Error igual da un mensaje legible", async () => {
    const fetch: FetchLike = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "ECONNRESET";
    };
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: false, categoria: "red", error: "ECONNRESET" });
  });
  it("un AbortError (timeout) da un mensaje propio", async () => {
    const fetch: FetchLike = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: false, categoria: "red", error: "tiempo de espera agotado" });
  });
});

describe("pedir(): timeout y respuesta que no se puede leer como texto", () => {
  it("un fetch que nunca resuelve se corta con AbortController al vencer el timeout", async () => {
    vi.useFakeTimers();
    let abortado = false;
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortado = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    try {
      const promesa = enviarTexto({ apiKey: "k", phoneNumberId: "pn_1", fetch, timeoutMs: 100 }, "549114", "hola");
      await vi.advanceTimersByTimeAsync(150);
      const r = await promesa;
      expect(abortado).toBe(true);
      expect(r).toEqual({ ok: false, categoria: "red", error: "tiempo de espera agotado" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("una respuesta cuyo .text() revienta no hace caer a pedir()", async () => {
    const fetch: FetchLike = async () =>
      ({ ok: true, status: 200, text: () => Promise.reject(new Error("stream cortado")) }) as unknown as Response;
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toEqual({ ok: true, id: "" });
  });
});

describe("pedir(): sin clave o sin fetch, no sale a la red (vía crearCliente)", () => {
  it("crearCliente sin clave no llama a fetch", async () => {
    const { fetch, llamadas } = espia();
    const r = await crearCliente({ apiKey: "", fetch }, "Club", "x");
    expect(r).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(llamadas).toHaveLength(0);
  });

  it("sin fetch inyectado, usa el fetch global", async () => {
    const original = globalThis.fetch;
    let llamado = false;
    globalThis.fetch = (async () => {
      llamado = true;
      return new Response(JSON.stringify({ id: "cus_1" }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await crearCliente({ apiKey: "k" }, "Club", "x");
      expect(llamado).toBe(true);
      expect(r).toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("sin fetch inyectado NI global disponible, da un resultado y no revienta", async () => {
    const original = globalThis.fetch;
    // @ts-expect-error simula un entorno sin fetch global
    globalThis.fetch = undefined;
    try {
      const r = await crearCliente({ apiKey: "k" }, "Club", "x");
      expect(r).toEqual({ ok: false, categoria: "red", error: "no hay fetch disponible" });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("crearCliente: variantes de la respuesta de Kapso", () => {
  it("sin id en la respuesta, no se hace pasar por exito", async () => {
    const { fetch } = espia({ cuerpo: { algo: "raro" } });
    const r = await crearCliente({ apiKey: "k", fetch }, "Club", "x");
    expect(r).toMatchObject({ ok: false, categoria: "rechazado" });
  });
  it("sin external_customer_id en la respuesta, arma el default con el prefijo", async () => {
    const { fetch } = espia({ cuerpo: { id: "cus_9" } });
    const r = await crearCliente({ apiKey: "k", fetch }, "Club", "club_9");
    expect(r).toMatchObject({ ok: true, cliente: { id: "cus_9", externalCustomerId: "gestionflow:club_9" } });
  });
});

describe("crearSetupLink: las tres opciones de redirección/tema, y su error", () => {
  it("volverBienA, volverMalA y colorPrimario viajan si se pasan", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { url: "u" } });
    await crearSetupLink({ apiKey: "k", fetch }, "cus_1", {
      volverBienA: "https://app/ok",
      volverMalA: "https://app/mal",
      colorPrimario: "#111827",
    });
    expect(llamadas[0]!.cuerpo.setup_link.success_redirect_url).toBe("https://app/ok");
    expect(llamadas[0]!.cuerpo.setup_link.failure_redirect_url).toBe("https://app/mal");
    expect(llamadas[0]!.cuerpo.setup_link.theme_config).toEqual({ primary_color: "#111827" });
  });
  it("un error de Kapso en crearSetupLink vuelve con su categoria", async () => {
    const { fetch } = espia({ estado: 500, texto: "boom" });
    const r = await crearSetupLink({ apiKey: "k", fetch }, "cus_1");
    expect(r).toMatchObject({ ok: false, categoria: "red" });
  });
});

describe("leerFecha: los distintos formatos que manda Kapso", () => {
  it("sin timestamp/created_at/occurred_at, usa el momento actual", () => {
    const antes = Date.now();
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "hola" } } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.fechaHora.getTime()).toBeGreaterThanOrEqual(antes);
  });
  it("created_at como fecha ISO se lee tal cual", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "hola" }, created_at: "2026-09-01T00:00:00Z" } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.fechaHora.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
  it("un occurred_at que no se puede parsear cae al momento actual, no a 1970", () => {
    const antes = Date.now();
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "hola" }, occurred_at: "no es una fecha" } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.fechaHora.getTime()).toBeGreaterThanOrEqual(antes);
  });
  it("un timestamp numerico en milisegundos no se vuelve a multiplicar", () => {
    const ms = Date.parse("2026-08-19T00:00:00Z");
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "hola" }, timestamp: ms } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.fechaHora.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
  it("un timestamp numerico en SEGUNDOS si se multiplica", () => {
    const segundos = Date.parse("2026-08-19T00:00:00Z") / 1000;
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", text: { body: "hola" }, timestamp: segundos } },
    });
    expect(e.tipo).toBe("mensaje");
    if (e.tipo === "mensaje") expect(e.mensaje.fechaHora.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe("numero_conectado / numero_desconectado: campos alternativos y faltantes", () => {
  it("sin display_phone_number, telefono queda undefined", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.phone_number.created",
      data: { phone_number_id: "pn_9", customer_id: "cus_1" },
    });
    expect(e).toEqual({ tipo: "numero_conectado", clienteId: "cus_1", phoneNumberId: "pn_9", telefono: undefined });
  });
  it("una desconexion tambien acepta id/external_customer_id como alternativa", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.phone_number.deleted",
      data: { id: "pn_9", external_customer_id: "cus_1" },
    });
    expect(e).toEqual({ tipo: "numero_desconectado", clienteId: "cus_1", phoneNumberId: "pn_9" });
  });
  it("una desconexion sin ids tambien se ignora", () => {
    expect(leerEventoWebhook({ event: "whatsapp.phone_number.deleted", data: {} }).tipo).toBe("ignorado");
  });
});

describe("estado de mensaje: campos alternativos de id y ausencia", () => {
  it("acepta datos.id como alternativa a message.id", () => {
    const e = leerEventoWebhook({ event: "whatsapp.message.delivered", data: { id: "wamid.1" } });
    expect(e).toMatchObject({ tipo: "estado", mensajeId: "wamid.1", estado: "delivered" });
  });
  it("acepta message_id como otra alternativa mas", () => {
    const e = leerEventoWebhook({ event: "whatsapp.message.read", data: { message_id: "wamid.2" } });
    expect(e).toMatchObject({ tipo: "estado", mensajeId: "wamid.2", estado: "read" });
  });
  it("un estado sin ningun id se ignora", () => {
    expect(leerEventoWebhook({ event: "whatsapp.message.sent", data: {} }).tipo).toBe("ignorado");
  });
});

describe("mensaje entrante: campos que faltan no rompen el evento", () => {
  it("un boton sin id (payload) y sin id de mensaje", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { from: "549114", interactive: { type: "button_reply", button_reply: { title: "Sí" } } } },
    });
    expect(e).toEqual({
      tipo: "mensaje",
      mensaje: expect.objectContaining({ tipo: "boton", payload: undefined, mensajeId: "" }),
    });
  });
  it("una opcion de lista sin id (payload) y sin id de mensaje", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { from: "549114", interactive: { type: "list_reply", list_reply: { title: "18:00" } } } },
    });
    expect(e).toEqual({
      tipo: "mensaje",
      mensaje: expect.objectContaining({ tipo: "opcion_lista", payload: undefined, mensajeId: "" }),
    });
  });
  it("un mensaje de texto sin id de mensaje", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { from: "549114", text: { body: "hola" } } },
    });
    expect(e).toMatchObject({ mensaje: { mensajeId: "" } });
  });
});

describe("categoriaDe: la ventana tambien se reconoce en espanol", () => {
  it("24 horas + 'ventana' (sin 'window') categoriza como ventana", async () => {
    const { fetch } = espia({
      estado: 400,
      texto: JSON.stringify({ error: { message: "no se puede: pasaron más de 24hs de la ventana de atención" } }),
    });
    const r = await enviarTexto(cred(fetch), "5491145678901", "Hola");
    expect(r).toMatchObject({ ok: false, categoria: "ventana" });
  });
});

describe("enviarAviso sin parametros explicitos, fuera de la ventana", () => {
  it("manda la plantilla sin parametros (arma components vacio)", async () => {
    const { fetch, llamadas } = espia();
    await enviarAviso(cred(fetch), "549114", {
      texto: "Tu cuota vence",
      plantilla: "gf_cuota_vence",
      ultimoMensajeEntrante: null,
      ahora: new Date("2026-09-09T12:00:00Z"),
    });
    expect(llamadas[0]!.cuerpo.template.components).toBeUndefined();
  });
});

/* ============================================================
   Payloads v2 reales (copiados de la documentación de Kapso)
   ============================================================ */

const RECIBIDO_V2 = {
  message: {
    id: "wamid.123",
    timestamp: "1730092800",
    type: "text",
    from: "16315551181",
    text: { body: "Hello" },
    kapso: { direction: "inbound", status: "received", origin: "cloud_api", has_media: false, content: "Hello" },
  },
  conversation: { id: "conv_123", contact_name: "John Doe", phone_number: "16315551181", phone_number_id: "123456789012345" },
  is_new_conversation: true,
  phone_number_id: "123456789012345",
};

const firmar = (cuerpo: string, secreto: string) => createHmac("sha256", secreto).update(cuerpo).digest("hex");

describe("verificarFirmaWebhook: HMAC-SHA256 en hex sobre el cuerpo CRUDO", () => {
  const cuerpo = JSON.stringify(RECIBIDO_V2);

  it("acepta la firma que calcula Kapso", () => {
    expect(verificarFirmaWebhook(cuerpo, firmar(cuerpo, "s3creto"), "s3creto")).toBe(true);
  });
  it("acepta el cuerpo como bytes, y la firma en mayúsculas o con espacios", () => {
    const bytes = new TextEncoder().encode(cuerpo);
    expect(verificarFirmaWebhook(bytes, ` ${firmar(cuerpo, "s").toUpperCase()} `, "s")).toBe(true);
  });
  it("rechaza con otro secreto", () => {
    expect(verificarFirmaWebhook(cuerpo, firmar(cuerpo, "otro"), "s3creto")).toBe(false);
  });
  it("rechaza si el cuerpo se re-serializó (por eso tiene que ser el crudo)", () => {
    const reserializado = JSON.stringify(JSON.parse(cuerpo), null, 2);
    expect(verificarFirmaWebhook(reserializado, firmar(cuerpo, "s"), "s")).toBe(false);
  });
  it("sin firma, sin secreto, o con una firma de otro largo: false, nunca tira", () => {
    expect(verificarFirmaWebhook(cuerpo, null, "s")).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, undefined, "s")).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, "", "s")).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, firmar(cuerpo, ""), "")).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, "abc", "s")).toBe(false);
  });
});

describe("el nombre del evento viene en la cabecera X-Webhook-Event", () => {
  it("un cuerpo v2 sin `event` se ignora si no se pasa la cabecera", () => {
    expect(leerEventoWebhook(RECIBIDO_V2).tipo).toBe("ignorado");
  });
  it("con la cabecera, el mismo cuerpo es un mensaje, con nombre de contacto", () => {
    const e = leerEventoWebhook(RECIBIDO_V2, "whatsapp.message.received");
    expect(e).toEqual({
      tipo: "mensaje",
      mensaje: {
        tipo: "texto",
        de: "16315551181",
        phoneNumberId: "123456789012345",
        texto: "Hello",
        nombreContacto: "John Doe",
        mensajeId: "wamid.123",
        fechaHora: new Date(1730092800 * 1000),
      },
    });
  });
  it("la cabecera manda sobre `event` del cuerpo", () => {
    const e = leerEventoWebhook({ ...RECIBIDO_V2, event: "algo.viejo" }, "whatsapp.message.received");
    expect(e.tipo).toBe("mensaje");
  });
  it("una cabecera vacía o en blanco cae al `event` del cuerpo (compatible)", () => {
    expect(leerEventoWebhook({ ...RECIBIDO_V2, event: "whatsapp.message.received" }, "  ").tipo).toBe("mensaje");
    expect(leerEventoWebhook({ ...RECIBIDO_V2, event: "whatsapp.message.received" }, null).tipo).toBe("mensaje");
  });
});

describe("leerEventosWebhook: el sobre de lote del buffering", () => {
  const lote = {
    type: "whatsapp.message.received",
    batch: true,
    data: [
      {
        message: { id: "wamid.111", timestamp: "1730092801", type: "text", text: { body: "First in batch" }, kapso: { phone_number_id: "123" } },
        conversation: { id: "conv_123", phone_number: "+15551234567", phone_number_id: "123" },
        phone_number_id: "123",
      },
      {
        message: { id: "wamid.112", timestamp: "1730092802", type: "text", text: { body: "Second in batch" } },
        conversation: { id: "conv_123", phone_number: "+15551234567", phone_number_id: "123" },
        phone_number_id: "123",
      },
    ],
    batch_info: { size: 2, window_ms: 5000 },
  };

  it("devuelve un evento por elemento, con el nombre del `type` del sobre", () => {
    const es = leerEventosWebhook(lote);
    expect(es).toHaveLength(2);
    expect(es.map((e) => (e.tipo === "mensaje" ? e.mensaje.texto : null))).toEqual(["First in batch", "Second in batch"]);
    // Los elementos de un lote no traen `from`: sale del teléfono de la conversación, sin `+`.
    expect(es[0]).toMatchObject({ mensaje: { de: "15551234567", phoneNumberId: "123", mensajeId: "wamid.111" } });
  });
  it("la cabecera manda también en un lote", () => {
    const es = leerEventosWebhook({ ...lote, type: "otro" }, "whatsapp.message.received");
    expect(es.every((e) => e.tipo === "mensaje")).toBe(true);
  });
  it("un evento suelto sale como arreglo de uno", () => {
    const es = leerEventosWebhook(RECIBIDO_V2, "whatsapp.message.received");
    expect(es).toHaveLength(1);
    expect(es[0]!.tipo).toBe("mensaje");
  });
  it("un lote vacío es un arreglo vacío; un lote sin data, un ignorado", () => {
    expect(leerEventosWebhook({ batch: true, data: [], type: "whatsapp.message.received" })).toEqual([]);
    expect(leerEventosWebhook({ batch: true })).toEqual([{ tipo: "ignorado", motivo: "lote sin data" }]);
  });
  it("basura sigue siendo un ignorado, nunca tira", () => {
    expect(leerEventosWebhook(null)).toEqual([{ tipo: "ignorado", motivo: "cuerpo vacío" }]);
  });
  it("leerEventoWebhook con un lote no se queda con uno en silencio", () => {
    const e = leerEventoWebhook(lote);
    expect(e).toEqual({ tipo: "ignorado", motivo: "lote de 2 eventos: usar leerEventosWebhook" });
    expect(leerEventoWebhook({ batch: true })).toMatchObject({ motivo: "lote de 0 eventos: usar leerEventosWebhook" });
  });
});

describe("media entrante: imagen, video, documento, audio y ubicación", () => {
  const recibido = (message: Record<string, unknown>) =>
    leerEventoWebhook({ message: { id: "m", from: "549114", ...message }, phone_number_id: "pn" }, "whatsapp.message.received");

  it("una imagen trae su id, el mime y el media_url de Kapso; el epígrafe va a texto", () => {
    const e = recibido({
      type: "image",
      image: { caption: "Comprobante", id: "media_id_123", mime_type: "image/jpeg" },
      kapso: {
        has_media: true,
        media_url: "https://api.kapso.ai/media/abc",
        media_data: { url: "https://api.kapso.ai/media/otro", filename: "photo.jpg", content_type: "image/png" },
      },
    });
    expect(e).toMatchObject({
      tipo: "mensaje",
      mensaje: {
        tipo: "imagen",
        texto: "Comprobante",
        media: { id: "media_id_123", mimeType: "image/jpeg", nombreArchivo: "photo.jpg", url: "https://api.kapso.ai/media/abc" },
      },
    });
  });
  it("sin mime_type de Meta ni media_url, usa media_data de Kapso", () => {
    const e = recibido({
      type: "document",
      document: { id: "d1", filename: "factura.pdf" },
      kapso: { media_data: { url: "https://api.kapso.ai/media/d1", content_type: "application/pdf" }, message_type_data: { caption: "La factura" } },
    });
    expect(e).toMatchObject({
      mensaje: {
        tipo: "documento",
        texto: "La factura",
        media: { id: "d1", mimeType: "application/pdf", nombreArchivo: "factura.pdf", url: "https://api.kapso.ai/media/d1" },
      },
    });
  });
  it("un video sin nada más que el tipo da media con id vacío, sin campos de más", () => {
    const e = recibido({ type: "video" });
    expect(e).toMatchObject({ mensaje: { tipo: "video", texto: "", media: { id: "" } } });
    expect(Object.keys((e as any).mensaje.media)).toEqual(["id"]);
  });
  it("una ubicación sale como 'lat,lng'", () => {
    const e = recibido({ type: "location", location: { latitude: -34.6037, longitude: -58.3816, name: "Obelisco" } });
    expect(e).toMatchObject({ mensaje: { tipo: "ubicacion", texto: "-34.6037,-58.3816" } });
  });
  it("una ubicación sin coordenadas válidas es 'otro', no 'NaN,NaN'", () => {
    expect(recibido({ type: "location", location: { latitude: "x", longitude: 1 } })).toMatchObject({ mensaje: { tipo: "otro", texto: "" } });
    expect(recibido({ type: "location", location: {} })).toMatchObject({ mensaje: { tipo: "otro" } });
    expect(recibido({ type: "location" })).toMatchObject({ mensaje: { tipo: "otro" } });
  });
  it("el botón de una PLANTILLA llega como type 'button' y devuelve su payload", () => {
    const e = recibido({ type: "button", button: { payload: "turno:abc:confirmar", text: "Confirmar" } });
    expect(e).toMatchObject({ mensaje: { tipo: "boton", texto: "Confirmar", payload: "turno:abc:confirmar" } });
    const sinPayload = recibido({ type: "button", button: { text: "Confirmar" } });
    expect((sinPayload as any).mensaje.payload).toBeUndefined();
  });
  it("sin remitente en ningún lado, se ignora", () => {
    const e = leerEventoWebhook({ message: { id: "m", text: { body: "x" } }, conversation: {} }, "whatsapp.message.received");
    expect(e).toEqual({ tipo: "ignorado", motivo: "mensaje sin remitente" });
  });
  it("phone_number_id de la conversación o de message.kapso si no viene arriba", () => {
    const deConversacion = leerEventoWebhook(
      { message: { id: "m", from: "1", text: { body: "x" } }, conversation: { phone_number_id: "pn_c" } },
      "whatsapp.message.received"
    );
    expect(deConversacion).toMatchObject({ mensaje: { phoneNumberId: "pn_c" } });
    const deKapso = leerEventoWebhook(
      { message: { id: "m", from: "1", text: { body: "x" }, kapso: { phone_number_id: "pn_k" } } },
      "whatsapp.message.received"
    );
    expect(deKapso).toMatchObject({ mensaje: { phoneNumberId: "pn_k" } });
  });
});

describe("estado failed: el error de Meta viaja con el evento", () => {
  const fallido = {
    message: {
      id: "wamid.789",
      timestamp: "1730093200",
      kapso: {
        status: "failed",
        statuses: [
          { id: "wamid.789", status: "sent", timestamp: "1730093100" },
          {
            id: "wamid.789",
            status: "failed",
            timestamp: "1730093200",
            errors: [{ code: 131047, title: "Re-engagement message", message: "More than 24 hours have passed" }],
          },
        ],
      },
    },
    phone_number_id: "123",
  };

  it("toma el error del ÚLTIMO estado", () => {
    const e = leerEventoWebhook(fallido, "whatsapp.message.failed");
    expect(e).toEqual({
      tipo: "estado",
      mensajeId: "wamid.789",
      estado: "failed",
      fechaHora: new Date(1730093200 * 1000),
      error: { codigo: 131047, titulo: "Re-engagement message", mensaje: "More than 24 hours have passed" },
    });
  });
  it("un delivered no lleva error aunque el historial tenga uno", () => {
    const e = leerEventoWebhook(fallido, "whatsapp.message.delivered");
    expect((e as any).error).toBeUndefined();
  });
  it("un failed sin historial de estados no inventa un error", () => {
    const e = leerEventoWebhook({ message: { id: "w", kapso: { statuses: [] } } }, "whatsapp.message.failed");
    expect(e).toMatchObject({ tipo: "estado", estado: "failed" });
    expect((e as any).error).toBeUndefined();
  });
  it("acepta errors en el mensaje o arriba, y error_data.details como mensaje", () => {
    const enMensaje = leerEventoWebhook({ message: { id: "w", errors: [{ code: 1, error_data: { details: "detalle" } }] } }, "whatsapp.message.failed");
    expect((enMensaje as any).error).toEqual({ codigo: 1, mensaje: "detalle" });
    const arriba = leerEventoWebhook({ message: { id: "w" }, errors: [{ title: "T" }] }, "whatsapp.message.failed");
    expect((arriba as any).error).toEqual({ titulo: "T" });
  });
  it("un error vacío o que no es un objeto no se adjunta", () => {
    const vacio = leerEventoWebhook({ message: { id: "w", errors: [{ code: "x" }] } }, "whatsapp.message.failed");
    expect((vacio as any).error).toBeUndefined();
    const raro = leerEventoWebhook({ message: { id: "w", errors: ["boom"] } }, "whatsapp.message.failed");
    expect((raro as any).error).toBeUndefined();
  });
});

describe("conexión de número: el payload v2 trae customer: { id, external_id }", () => {
  const v2 = {
    phone_number_id: "123456789012345",
    project: { id: "990e8400" },
    customer: { id: "880e8400", external_id: "gestionflow:club_9" },
  };
  it("created", () => {
    expect(leerEventoWebhook(v2, "whatsapp.phone_number.created")).toEqual({
      tipo: "numero_conectado",
      clienteId: "880e8400",
      phoneNumberId: "123456789012345",
      idExterno: "gestionflow:club_9",
      telefono: undefined,
    });
  });
  it("deleted", () => {
    expect(leerEventoWebhook(v2, "whatsapp.phone_number.deleted")).toEqual({
      tipo: "numero_desconectado",
      clienteId: "880e8400",
      phoneNumberId: "123456789012345",
      idExterno: "gestionflow:club_9",
    });
  });
  it("acepta external_customer_id adentro de customer (v1)", () => {
    const e = leerEventoWebhook({ phone_number_id: "p", customer: { id: "c", external_customer_id: "x:1" } }, "whatsapp.phone_number.created");
    expect(e).toMatchObject({ idExterno: "x:1" });
  });
});

describe("crearSetupLink: reconectar un número", () => {
  it("manda reconnect_phone_number y NO allowed_connection_types ni meta_billing_mode", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { data: { url: "https://setup.kapso.ai/s/x" } } });
    const r = await crearSetupLink({ apiKey: "k", fetch }, "cus_1", { reconectarTelefono: "+5491145678901" });
    expect(r).toMatchObject({ ok: true, url: "https://setup.kapso.ai/s/x" });
    const sl = llamadas[0]!.cuerpo.setup_link;
    expect(sl.reconnect_phone_number).toBe("+5491145678901");
    expect(sl).not.toHaveProperty("allowed_connection_types");
    expect(sl).not.toHaveProperty("meta_billing_mode");
  });
  it("si se pasa metaBilling explícito al reconectar, viaja", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { url: "u" } });
    await crearSetupLink({ apiKey: "k", fetch }, "cus_1", { reconectarTelefono: "+549", metaBilling: "partner_managed" });
    expect(llamadas[0]!.cuerpo.setup_link.meta_billing_mode).toBe("partner_managed");
  });
  it("sin reconectar, sigue pidiendo coexistencia", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { url: "u" } });
    await crearSetupLink({ apiKey: "k", fetch }, "cus_1");
    expect(llamadas[0]!.cuerpo.setup_link.allowed_connection_types).toEqual(["coexistence"]);
    expect(llamadas[0]!.cuerpo.setup_link).not.toHaveProperty("reconnect_phone_number");
  });
});

describe("crearCliente: cada app pasa su prefijo", () => {
  it("el prefijo propio viaja en external_customer_id", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { data: { id: "cus_1" } } });
    const r = await crearCliente({ apiKey: "k", fetch }, "Consorcio", "c_1", "ediflow");
    expect(llamadas[0]!.cuerpo.customer.external_customer_id).toBe("ediflow:c_1");
    expect(r).toMatchObject({ ok: true, cliente: { id: "cus_1", externalCustomerId: "ediflow:c_1" } });
  });
});

describe("registrarWebhookNumero / listarWebhooksNumero", () => {
  const credP = (fetch: FetchLike) => ({ apiKey: "k", fetch });

  it("registra un webhook kapso con los eventos por defecto y el secreto propio", async () => {
    const { fetch, llamadas } = espia({
      estado: 201,
      cuerpo: { data: { id: "wh_1", url: "https://app/wh", events: [...EVENTOS_WEBHOOK_NUMERO], active: true } },
    });
    const r = await registrarWebhookNumero(credP(fetch), "pn_1", { url: "https://app/wh", secreto: "s" });
    expect(r).toEqual({
      ok: true,
      webhook: { id: "wh_1", url: "https://app/wh", eventos: [...EVENTOS_WEBHOOK_NUMERO], activo: true },
    });
    expect(llamadas[0]!.url).toBe("https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/pn_1/webhooks");
    expect(llamadas[0]!.init.method).toBe("POST");
    expect(llamadas[0]!.cuerpo).toEqual({
      whatsapp_webhook: {
        kind: "kapso",
        url: "https://app/wh",
        events: [
          "whatsapp.message.received",
          "whatsapp.message.delivered",
          "whatsapp.message.read",
          "whatsapp.message.failed",
        ],
        secret_key: "s",
        active: true,
      },
    });
  });
  it("eventos propios reemplazan a los por defecto", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { id: "wh_2" } });
    const r = await registrarWebhookNumero(credP(fetch), "pn_1", { url: "u", secreto: "s", eventos: ["whatsapp.message.received"] });
    expect(llamadas[0]!.cuerpo.whatsapp_webhook.events).toEqual(["whatsapp.message.received"]);
    // Una respuesta sin `data` y sin campos tampoco rompe.
    expect(r).toEqual({ ok: true, webhook: { id: "wh_2", url: "", eventos: [], activo: true } });
  });
  it("valida antes de salir a la red", async () => {
    const { fetch, llamadas } = espia();
    expect(await registrarWebhookNumero(credP(fetch), "", { url: "u", secreto: "s" })).toMatchObject({ ok: false, categoria: "numero" });
    expect(await registrarWebhookNumero(credP(fetch), "pn", { url: "", secreto: "s" })).toMatchObject({ ok: false, categoria: "rechazado" });
    expect(await registrarWebhookNumero(credP(fetch), "pn", { url: "u", secreto: "" })).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(llamadas).toHaveLength(0);
  });
  it("sin id en la respuesta no se hace pasar por éxito; un 422 vuelve con categoría", async () => {
    const sinId = espia({ cuerpo: { data: {} } });
    expect(await registrarWebhookNumero(credP(sinId.fetch), "pn", { url: "u", secreto: "s" })).toMatchObject({ ok: false, categoria: "rechazado" });
    const mal = espia({ estado: 422, cuerpo: { error: { message: "url is invalid" } } });
    expect(await registrarWebhookNumero(credP(mal.fetch), "pn", { url: "u", secreto: "s" })).toEqual({
      ok: false,
      categoria: "rechazado",
      error: "url is invalid",
      estado: 422,
    });
  });
  it("lista desenvolviendo { data: [...] }", async () => {
    const { fetch, llamadas } = espia({
      cuerpo: { data: [{ id: "a", url: "https://x", events: ["whatsapp.message.received"], active: false }, { nada: 1 }], meta: {} },
    });
    const r = await listarWebhooksNumero(credP(fetch), "pn_1");
    expect(r).toEqual({ ok: true, webhooks: [{ id: "a", url: "https://x", eventos: ["whatsapp.message.received"], activo: false }] });
    expect(llamadas[0]!.init.method).toBe("GET");
    expect(llamadas[0]!.url).toBe("https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/pn_1/webhooks");
  });
  it("lista: arreglo pelado, cuerpo raro, sin número y error", async () => {
    expect(await listarWebhooksNumero(credP(espia({ cuerpo: [{ id: "b" }] }).fetch), "pn")).toMatchObject({ ok: true, webhooks: [{ id: "b" }] });
    expect(await listarWebhooksNumero(credP(espia({ texto: "" }).fetch), "pn")).toEqual({ ok: true, webhooks: [] });
    expect(await listarWebhooksNumero(credP(espia().fetch), "")).toMatchObject({ ok: false, categoria: "numero" });
    expect(await listarWebhooksNumero(credP(espia({ estado: 401, texto: "no" }).fetch), "pn")).toMatchObject({ ok: false, categoria: "credenciales" });
  });
});

describe("crearPlantilla / listarPlantillas (proxy de Meta)", () => {
  const credP = (fetch: FetchLike) => ({ apiKey: "k", fetch });
  const definicion = {
    nombre: "ef_expensa_vence",
    categoria: "UTILITY" as const,
    componentes: [{ type: "BODY", text: "Hola {{1}}", example: { body_text: [["Juana"]] } }],
  };

  it("crea en la WABA con el cuerpo de Meta y devuelve el estado", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { id: "tpl_1", status: "PENDING", category: "UTILITY" } });
    const r = await crearPlantilla(credP(fetch), "waba_1", definicion);
    expect(r).toEqual({
      ok: true,
      plantilla: { id: "tpl_1", nombre: "ef_expensa_vence", idioma: "es_AR", estado: "PENDING", categoria: "UTILITY" },
    });
    expect(llamadas[0]!.url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/waba_1/message_templates");
    expect(llamadas[0]!.cuerpo).toEqual({
      name: "ef_expensa_vence",
      language: "es_AR",
      category: "UTILITY",
      components: definicion.componentes,
    });
  });
  it("idioma y formato de parámetros propios; respuesta envuelta y sin estado", async () => {
    const { fetch, llamadas } = espia({ cuerpo: { data: { id: "tpl_2" } } });
    const r = await crearPlantilla(credP(fetch), "waba_1", { ...definicion, idioma: "es", formatoParametros: "NAMED" });
    expect(llamadas[0]!.cuerpo).toMatchObject({ language: "es", parameter_format: "NAMED" });
    expect(r).toEqual({ ok: true, plantilla: { id: "tpl_2", nombre: "ef_expensa_vence", idioma: "es", estado: "PENDING" } });
  });
  it("valida, y un rechazo de Meta cae en la categoría plantilla", async () => {
    const { fetch, llamadas } = espia();
    expect(await crearPlantilla(credP(fetch), "", definicion)).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(await crearPlantilla(credP(fetch), "w", { ...definicion, nombre: "" })).toMatchObject({ ok: false, categoria: "plantilla" });
    expect(llamadas).toHaveLength(0);
    const mal = espia({ estado: 400, cuerpo: { error: { message: "Template name already exists" } } });
    expect(await crearPlantilla(credP(mal.fetch), "w", definicion)).toMatchObject({ ok: false, categoria: "plantilla" });
    const sinId = espia({ cuerpo: { status: "PENDING" } });
    expect(await crearPlantilla(credP(sinId.fetch), "w", definicion)).toMatchObject({ ok: false, categoria: "rechazado" });
  });
  it("lista con nombre y estado, y sin página siguiente si no la hay", async () => {
    const { fetch, llamadas } = espia({
      cuerpo: {
        data: [
          { id: "1", name: "ef_a", language: "es_AR", status: "APPROVED", category: "UTILITY" },
          { id: "2", name: "ef_b", status: "PENDING" },
          { id: "3" },
        ],
        paging: { cursors: { after: "CUR" } },
      },
    });
    const r = await listarPlantillas(credP(fetch), "waba_1", { nombre: "ef_a", estado: "APPROVED" });
    expect(r).toEqual({
      ok: true,
      plantillas: [
        { id: "1", nombre: "ef_a", idioma: "es_AR", estado: "APPROVED", categoria: "UTILITY" },
        { id: "2", nombre: "ef_b", estado: "PENDING" },
      ],
    });
    const url = new URL(llamadas[0]!.url);
    expect(url.pathname).toBe("/meta/whatsapp/v24.0/waba_1/message_templates");
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "100", name: "ef_a", status: "APPROVED" });
  });
  it("con `next` (o página llena) devuelve el cursor, y `despues` lo usa", async () => {
    const conNext = espia({ cuerpo: { data: [], paging: { next: "https://…", cursors: { after: "CUR" } } } });
    expect(await listarPlantillas(credP(conNext.fetch), "w", { despues: "ANT" })).toEqual({ ok: true, plantillas: [], siguiente: "CUR" });
    expect(new URL(conNext.llamadas[0]!.url).searchParams.get("after")).toBe("ANT");

    const llena = espia({ cuerpo: { data: [{ id: "1", name: "a" }], paging: { cursors: { after: "C2" } } } });
    expect(await listarPlantillas(credP(llena.fetch), "w", { limite: 1 })).toMatchObject({ siguiente: "C2" });
    expect(new URL(llena.llamadas[0]!.url).searchParams.get("limit")).toBe("1");
  });
  it("el límite se acota a 1..100; sin WABA o con error no lista", async () => {
    const { fetch, llamadas } = espia({ cuerpo: {} });
    expect(await listarPlantillas(credP(fetch), "w", { limite: 500 })).toEqual({ ok: true, plantillas: [] });
    await listarPlantillas(credP(fetch), "w", { limite: 0 });
    expect(llamadas.map((l) => new URL(l.url).searchParams.get("limit"))).toEqual(["100", "1"]);
    expect(await listarPlantillas(credP(fetch), "")).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(await listarPlantillas(credP(espia({ estado: 503, texto: "x" }).fetch), "w")).toMatchObject({ ok: false, categoria: "red" });
  });
});

describe("bajarMedia: dos pasos, y el segundo sin la clave", () => {
  /** Un fetch que contesta distinto según la URL. */
  function fetchMedia(opciones: {
    meta?: { estado?: number; cuerpo?: unknown };
    archivo?: { estado?: number; bytes?: Uint8Array; tipo?: string | null; texto?: string };
  }) {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init) => {
      llamadas.push({ url, init: init ?? {} });
      if (url.startsWith("https://api.kapso.ai/meta/whatsapp/v24.0/")) {
        return new Response(JSON.stringify(opciones.meta?.cuerpo ?? {}), { status: opciones.meta?.estado ?? 200 });
      }
      const a = opciones.archivo ?? {};
      if (a.texto !== undefined) return new Response(a.texto, { status: a.estado ?? 200 });
      const headers: Record<string, string> = {};
      if (a.tipo) headers["content-type"] = a.tipo;
      return new Response(a.bytes ?? new Uint8Array([1, 2, 3]), { status: a.estado ?? 200, headers });
    };
    return { fetch, llamadas };
  }
  const DESCARGA = "https://api.kapso.ai/meta/whatsapp/media_download?token=abc";

  it("pide el download_url y baja los bytes sin X-API-Key", async () => {
    const { fetch, llamadas } = fetchMedia({
      meta: { cuerpo: { id: "m1", mime_type: "image/jpeg", url: "https://lookaside.fbsbx.com/x", download_url: DESCARGA } },
      archivo: { bytes: new Uint8Array([9, 8, 7]), tipo: "application/octet-stream" },
    });
    const r = await bajarMedia(cred(fetch), "m1");
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([9, 8, 7]), mimeType: "image/jpeg" });
    expect(llamadas[0]!.url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/m1?phone_number_id=pn_1");
    expect((llamadas[0]!.init.headers as any)["X-API-Key"]).toBe("k_test");
    // El url de Meta (lookaside) NO se usa: pide el token de Meta.
    expect(llamadas[1]!.url).toBe(DESCARGA);
    expect(llamadas[1]!.init.headers).toBeUndefined();
  });
  it("sin mime_type de Meta usa el content-type; sin ninguno, octet-stream; pasa el filename", async () => {
    const conTipo = fetchMedia({ meta: { cuerpo: { download_url: DESCARGA, filename: "f.pdf" } }, archivo: { tipo: "application/pdf" } });
    expect(await bajarMedia(cred(conTipo.fetch), "m")).toMatchObject({ ok: true, mimeType: "application/pdf", nombreArchivo: "f.pdf" });
    const sinTipo = fetchMedia({ meta: { cuerpo: { download_url: DESCARGA } }, archivo: { tipo: null, texto: "abc" } });
    const r = await bajarMedia(cred(sinTipo.fetch), "m");
    expect(r.ok && r.mimeType).toMatch(/^(application\/octet-stream|text\/plain.*)$/);
  });
  it("sin download_url no inventa nada", async () => {
    const { fetch, llamadas } = fetchMedia({ meta: { cuerpo: { url: "https://lookaside.fbsbx.com/x" } } });
    expect(await bajarMedia(cred(fetch), "m")).toMatchObject({ ok: false, categoria: "rechazado" });
    expect(llamadas).toHaveLength(1);
  });
  it("un 404 de la media o un download_url vencido vuelven con su categoría", async () => {
    const noEsta = fetchMedia({ meta: { estado: 404, cuerpo: { error: { message: "Media not found" } } } });
    expect(await bajarMedia(cred(noEsta.fetch), "m")).toEqual({ ok: false, categoria: "rechazado", error: "Media not found", estado: 404 });
    const vencido = fetchMedia({ meta: { cuerpo: { download_url: DESCARGA } }, archivo: { estado: 403, texto: '{"error":{"message":"token expired"}}' } });
    expect(await bajarMedia(cred(vencido.fetch), "m")).toEqual({ ok: false, categoria: "credenciales", error: "token expired", estado: 403 });
  });
  it("un error de red al bajar el archivo es `red`", async () => {
    let n = 0;
    const fetch: FetchLike = async () => {
      if (n++ === 0) return new Response(JSON.stringify({ download_url: DESCARGA }));
      throw new Error("ECONNRESET");
    };
    expect(await bajarMedia(cred(fetch), "m")).toEqual({ ok: false, categoria: "red", error: "ECONNRESET" });
  });
  it("una respuesta de error cuyo cuerpo no se puede leer igual da un resultado", async () => {
    let n = 0;
    const fetch: FetchLike = async () => {
      if (n++ === 0) return new Response(JSON.stringify({ download_url: DESCARGA }));
      return { ok: false, status: 500, text: () => Promise.reject(new Error("x")) } as unknown as Response;
    };
    expect(await bajarMedia(cred(fetch), "m")).toEqual({ ok: false, categoria: "red", error: "HTTP 500", estado: 500 });
  });
  it("valida antes de salir a la red", async () => {
    const { fetch, llamadas } = fetchMedia({});
    expect(await bajarMedia({ apiKey: "k", phoneNumberId: "", fetch }, "m")).toMatchObject({ ok: false, categoria: "credenciales" });
    expect(await bajarMedia(cred(fetch), "")).toMatchObject({ ok: false, categoria: "rechazado" });
    expect(llamadas).toHaveLength(0);
  });
  it("sin fetch global en el segundo paso, da un resultado y no revienta", async () => {
    const original = globalThis.fetch;
    // @ts-expect-error simula un entorno sin fetch global
    globalThis.fetch = undefined;
    try {
      const primero: FetchLike = async () => new Response(JSON.stringify({ download_url: DESCARGA }));
      // El primer paso usa el fetch inyectado... que se saca para el segundo.
      const c: { apiKey: string; phoneNumberId: string; fetch?: FetchLike } = { apiKey: "k", phoneNumberId: "pn", fetch: undefined };
      c.fetch = async (url, init) => {
        const rta = await primero(url, init);
        c.fetch = undefined;
        return rta;
      };
      expect(await bajarMedia(c, "m")).toEqual({ ok: false, categoria: "red", error: "no hay fetch disponible" });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("estado v2: la hora sale del historial o del mensaje, no de 'ahora'", () => {
  it("usa el timestamp del último estado", () => {
    const e = leerEventoWebhook(
      { message: { id: "w", timestamp: "1730092860", kapso: { statuses: [{ status: "sent", timestamp: "1730092860" }, { status: "delivered", timestamp: "1730092888" }] } } },
      "whatsapp.message.delivered"
    );
    expect((e as any).fechaHora).toEqual(new Date(1730092888 * 1000));
  });
  it("sin historial, usa message.timestamp", () => {
    const e = leerEventoWebhook({ message: { id: "w", timestamp: "1730092860" } }, "whatsapp.message.read");
    expect((e as any).fechaHora).toEqual(new Date(1730092860 * 1000));
  });
});
