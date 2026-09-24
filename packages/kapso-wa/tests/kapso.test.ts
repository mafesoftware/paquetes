import { describe, it, expect, vi } from "vitest";
import {
  aNumeroWhatsApp,
  crearCliente,
  crearSetupLink,
  dentroDeVentana24h,
  enviarAviso,
  enviarBotones,
  enviarLista,
  enviarPlantilla,
  enviarTexto,
  leerEventoWebhook,
  type FetchLike,
} from "../src/index.ts";

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

  it("un audio o una foto salen como 'otro', no como texto vacio", () => {
    const e = leerEventoWebhook({
      event: "whatsapp.message.received",
      data: { message: { id: "m", from: "549114", type: "audio", audio: { id: "a" } } },
    });
    expect(e).toMatchObject({ tipo: "mensaje", mensaje: { tipo: "otro", texto: "" } });
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
