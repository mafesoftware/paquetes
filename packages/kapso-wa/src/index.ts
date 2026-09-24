/**
 * WhatsApp por [Kapso](https://kapso.ai), que es un proxy de la Cloud API de
 * Meta con la aprobación de Tech Provider ya resuelta.
 *
 * Sin dependencias, sin framework: `fetch` inyectable para los tests y
 * **resultados en vez de excepciones** — un aviso de WhatsApp es un aviso, y
 * mandarlo no puede tumbar la reserva ni el cobro que lo dispara.
 *
 * ## Las tres cosas que hay que saber antes de tocar esto
 *
 * 1. **Afuera de la ventana de 24 horas solo salen PLANTILLAS aprobadas.** Si
 *    la persona no nos escribió en las últimas 24 h, un texto libre da 422. Un
 *    aviso de vencimiento de cuota siempre es plantilla; una respuesta del
 *    asistente adentro de una conversación abierta puede ser texto.
 * 2. **El nombre de la plantilla lleva el prefijo de la aplicación**
 *    (`gf_cuota_vence`). Todas las apps de MAFE comparten el número de prueba,
 *    y dos plantillas con el mismo nombre y distinto cuerpo se pisan.
 * 3. **Un HTTP 402 no es un error de código: es la facturación de Meta.**
 *    Kapso contesta `Paid WhatsApp sends are paused until the billing issue is
 *    resolved` y no sale NINGÚN mensaje pago. La integración puede estar
 *    perfecta de punta a punta y no enviar nada, así que este paquete le da
 *    una categoría propia — un reintento no arregla nada y hay que avisarle a
 *    una persona.
 *
 * ## Multi-tenant
 *
 * La clave de API es **del proyecto**, no del club: alcanza con guardar el
 * `phoneNumberId` de cada club para mandar en su nombre. La contracara es que
 * esa clave abre TODOS los números del proyecto, así que una aplicación toca
 * únicamente los números de sus propios clientes.
 */

const BASE_META = "https://api.kapso.ai/meta/whatsapp/v24.0";
const BASE_PLATAFORMA = "https://api.kapso.ai/platform/v1";

/** Un `fetch` compatible. Se inyecta en los tests para no salir a la red. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Credenciales = {
  apiKey: string;
  /** El número desde el que se manda. Es un dato del CLUB, no del deployment. */
  phoneNumberId: string;
  fetch?: FetchLike;
  /** Milisegundos antes de cortar. 15 s por defecto. */
  timeoutMs?: number;
};

/**
 * Por qué falló, y sobre todo **si reintentar sirve**.
 *
 * - `red`, `limite` — sí, más tarde.
 * - `credenciales`, `numero`, `plantilla`, `ventana`, `rechazado` — no: son
 *   errores de configuración o de contenido, y reintentar los repite igual.
 * - `facturacion` — no, y además **ningún** envío pago va a salir hasta que
 *   alguien resuelva el medio de pago de Meta. Es el único que merece una
 *   alarma y no una fila de reintentos.
 */
export type CategoriaError =
  | "red"
  | "credenciales"
  | "facturacion"
  | "limite"
  | "numero"
  | "plantilla"
  | "ventana"
  | "rechazado";

export type Resultado =
  | { ok: true; id: string }
  | { ok: false; categoria: CategoriaError; error: string; estado?: number };

/* ============================================================
   NÚMEROS
   ============================================================ */

/**
 * Un celular argentino a E.164 sin `+`, como lo quiere WhatsApp: `549` + los
 * diez dígitos nacionales.
 *
 * Devuelve `null` si el número no se reconoce, **nunca un número adivinado**:
 * mandarle el aviso de deuda de un socio a otra persona es peor que no
 * mandarlo.
 */
export function aNumeroWhatsApp(telefono: string | null | undefined, paisPorDefecto = "54"): string | null {
  if (!telefono) return null;
  let d = String(telefono).replace(/\D/g, "");
  if (!d) return null;

  // Ya viene internacional.
  if (d.startsWith("00")) d = d.slice(2);

  if (paisPorDefecto === "54") {
    // Se saca el 54 y el 9 para normalizar, y se rearma. Asi entran por igual
    // "011 4567-8901", "+54 9 11 4567 8901" y "5491145678901".
    if (d.startsWith("54")) d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
    // El 0 de larga distancia y el 15 de celular no viajan a WhatsApp.
    if (d.startsWith("0")) d = d.slice(1);

    /**
     * El 15 se saca SOLO si sobran dígitos.
     *
     * Con diez dígitos el número ya está en formato nacional y no hay nada que
     * quitar: sacarle un "15" que en realidad es parte del número local lo
     * dejaba en ocho o nueve dígitos y la función devolvía `null`. O sea que un
     * socio con un número como `11 1523-4567` no se identificaba nunca cuando
     * le escribía al WhatsApp del club — Lia lo trataba como desconocido y no
     * había nada que dijera por qué.
     *
     * La ambigüedad es real: mirando los dígitos no se distingue el 15 de
     * acceso del 15 que arranca la parte local. El largo sí la resuelve.
     */
    if (d.length > 10) d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");

    if (d.length !== 10) return null;
    return `549${d}`;
  }

  if (d.length < 8 || d.length > 15) return null;
  return d.startsWith(paisPorDefecto) ? d : `${paisPorDefecto}${d}`;
}

/* ============================================================
   ENVÍO
   ============================================================ */

/**
 * Texto libre. **Solo adentro de la ventana de 24 horas.**
 *
 * Es lo que usa el asistente para contestar una conversación que la persona
 * abrió. Para avisar algo "en frío" va `enviarPlantilla`.
 */
export function enviarTexto(
  cred: Credenciales,
  para: string,
  texto: string
): Promise<Resultado> {
  return postMensaje(cred, {
    messaging_product: "whatsapp",
    to: para,
    type: "text",
    text: { body: texto, preview_url: false },
  });
}

export type ParametroPlantilla = string | { tipo: "texto"; valor: string };

/**
 * Una plantilla aprobada por Meta. Es lo único que sale en frío.
 *
 * Los parámetros son **posicionales** (`{{1}}`, `{{2}}`…) y el orden tiene que
 * coincidir con el que se aprobó. Ese es el error más caro del módulo: la
 * plantilla se manda, Meta la acepta, y al socio le llega su deuda en el lugar
 * donde iba la fecha. No hay forma de validarlo desde acá — se valida con un
 * test que arme los parámetros con la misma función que los manda.
 */
export function enviarPlantilla(
  cred: Credenciales,
  para: string,
  plantilla: string,
  parametros: readonly ParametroPlantilla[] = [],
  idioma = "es_AR"
): Promise<Resultado> {
  const components = parametros.length
    ? [
        {
          type: "body",
          parameters: parametros.map((p) => ({
            type: "text",
            text: typeof p === "string" ? p : p.valor,
          })),
        },
      ]
    : undefined;

  return postMensaje(cred, {
    messaging_product: "whatsapp",
    to: para,
    type: "template",
    template: {
      name: plantilla,
      language: { code: idioma },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Botones de respuesta rápida. Hasta 3, y es un límite de Meta.
 *
 * Se prefieren a los WhatsApp Flows para un producto multi-tenant: un Flow
 * pertenece a una WABA, así que habría que crear, cifrar y publicar uno por
 * club — y publicarlo exige que Meta le verifique el portfolio **a cada club**,
 * con documentación societaria. La mayoría no lo va a hacer. Con mensajes
 * interactivos, el club número doscientos anda sin que nadie configure nada.
 *
 * Cada botón lleva un `id` que vuelve en el webhook: ahí va nuestro propio
 * identificador (`reserva:abc123`), y por eso el payload de otra aplicación que
 * comparta el número no resuelve y se ignora solo.
 */
export function enviarBotones(
  cred: Credenciales,
  para: string,
  cuerpo: string,
  botones: readonly { id: string; titulo: string }[],
  opciones: { encabezado?: string; pie?: string } = {}
): Promise<Resultado> {
  if (!botones.length) {
    return Promise.resolve({ ok: false, categoria: "rechazado", error: "sin botones" });
  }
  if (botones.length > 3) {
    // Meta corta en 3 y devuelve un error opaco. Mejor decirlo acá.
    return Promise.resolve({
      ok: false,
      categoria: "rechazado",
      error: `WhatsApp acepta hasta 3 botones, se pasaron ${botones.length}`,
    });
  }

  return postMensaje(cred, {
    messaging_product: "whatsapp",
    to: para,
    type: "interactive",
    interactive: {
      type: "button",
      ...(opciones.encabezado ? { header: { type: "text", text: opciones.encabezado } } : {}),
      body: { text: cuerpo },
      ...(opciones.pie ? { footer: { text: opciones.pie } } : {}),
      action: {
        buttons: botones.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: recortar(b.titulo, 20) },
        })),
      },
    },
  });
}

/**
 * Una lista desplegable. Hasta 10 opciones en total, repartidas en secciones.
 *
 * Es lo que usa el asistente para ofrecer los turnos libres de una cancha.
 */
export function enviarLista(
  cred: Credenciales,
  para: string,
  cuerpo: string,
  textoBoton: string,
  secciones: readonly { titulo: string; opciones: readonly { id: string; titulo: string; descripcion?: string }[] }[],
  opciones: { encabezado?: string; pie?: string } = {}
): Promise<Resultado> {
  const total = secciones.reduce((n, s) => n + s.opciones.length, 0);
  if (!total) {
    return Promise.resolve({ ok: false, categoria: "rechazado", error: "lista sin opciones" });
  }
  if (total > 10) {
    return Promise.resolve({
      ok: false,
      categoria: "rechazado",
      error: `WhatsApp acepta hasta 10 opciones, se pasaron ${total}`,
    });
  }

  return postMensaje(cred, {
    messaging_product: "whatsapp",
    to: para,
    type: "interactive",
    interactive: {
      type: "list",
      ...(opciones.encabezado ? { header: { type: "text", text: opciones.encabezado } } : {}),
      body: { text: cuerpo },
      ...(opciones.pie ? { footer: { text: opciones.pie } } : {}),
      action: {
        button: recortar(textoBoton, 20),
        sections: secciones.map((s) => ({
          title: recortar(s.titulo, 24),
          rows: s.opciones.map((o) => ({
            id: o.id,
            title: recortar(o.titulo, 24),
            ...(o.descripcion ? { description: recortar(o.descripcion, 72) } : {}),
          })),
        })),
      },
    },
  });
}

async function postMensaje(cred: Credenciales, cuerpo: unknown): Promise<Resultado> {
  if (!cred.apiKey) return { ok: false, categoria: "credenciales", error: "falta la clave de Kapso" };
  if (!cred.phoneNumberId) {
    return { ok: false, categoria: "credenciales", error: "falta el phoneNumberId del club" };
  }

  const cuerpoTipado = cuerpo as { to?: string };
  if (!cuerpoTipado.to) return { ok: false, categoria: "numero", error: "destinatario vacío" };

  const r = await pedir(
    cred,
    `${BASE_META}/${encodeURIComponent(cred.phoneNumberId)}/messages`,
    { method: "POST", body: JSON.stringify(cuerpo) }
  );
  if (!r.ok) return r;

  // Cloud API devuelve el id adentro de `messages[0].id`. Si el cuerpo cambia
  // de forma, es preferible un id vacio a tirar: el mensaje YA salio.
  const cuerpoRta = r.datos as { messages?: { id?: string }[] } | null;
  return { ok: true, id: cuerpoRta?.messages?.[0]?.id ?? "" };
}

/* ============================================================
   ONBOARDING DE UN CLUB
   ============================================================ */

export type ClienteKapso = { id: string; externalCustomerId: string };

/**
 * Da de alta un club como cliente de Kapso.
 *
 * `externalCustomerId` lleva el prefijo de la aplicación
 * (`gestionflow:<clubId>`) porque el webhook de conexión trae **solo** el id de
 * cliente y nunca el producto: sin prefijo no hay forma de saber de quién es.
 */
export async function crearCliente(
  cred: { apiKey: string; fetch?: FetchLike; timeoutMs?: number },
  nombre: string,
  clubId: string,
  prefijo = "gestionflow"
): Promise<{ ok: true; cliente: ClienteKapso } | { ok: false; categoria: CategoriaError; error: string }> {
  const r = await pedir(cred, `${BASE_PLATAFORMA}/customers`, {
    method: "POST",
    body: JSON.stringify({
      customer: { name: nombre, external_customer_id: `${prefijo}:${clubId}` },
    }),
  });
  if (!r.ok) return r;

  const d = r.datos as { id?: string; external_customer_id?: string; data?: { id?: string; external_customer_id?: string } };
  const fila = d?.data ?? d;
  if (!fila?.id) return { ok: false, categoria: "rechazado", error: "Kapso no devolvió un id de cliente" };
  return {
    ok: true,
    cliente: { id: fila.id, externalCustomerId: fila.external_customer_id ?? `${prefijo}:${clubId}` },
  };
}

/**
 * El link que el club abre para conectar su WhatsApp. Tarda unos cinco minutos.
 *
 * ## Dos decisiones que NO se pueden cambiar después
 *
 * - **`allowed_connection_types: ["coexistence"]`**, siempre. La alternativa
 *   (`dedicated`) le apaga la app de WhatsApp Business en el teléfono, y un
 *   club usa ese WhatsApp todo el día. Su ventaja —mil mensajes por segundo—
 *   resuelve un problema que no tenemos.
 * - **`metaBilling`** decide quién le paga a Meta, y cambiarlo en una WABA ya
 *   conectada es un ticket de soporte. Peor: borrar el número y reconectar con
 *   el otro modo **no lo cambia**, porque el modo es de la WABA y la WABA
 *   sobrevive al número. Solo se lee en el PRIMER registro.
 *
 *   `partner_managed` (nosotros le pagamos a Meta y lo revendemos) **no
 *   funciona con una WABA en pesos**, y una WABA argentina con tarjeta local ya
 *   configurada queda en pesos. Por eso el modo se decide **por club** y no por
 *   entorno: una variable global obliga a todos al caso raro.
 *
 * Solo hay **un link activo por cliente**: crear otro revoca el anterior. Y
 * sobre un número YA conectado no se emite un link nuevo — puede intentar una
 * segunda conexión y arruinar la que funciona.
 */
export async function crearSetupLink(
  cred: { apiKey: string; fetch?: FetchLike; timeoutMs?: number },
  clienteId: string,
  opciones: {
    metaBilling?: "customer_managed" | "partner_managed";
    volverBienA?: string;
    volverMalA?: string;
    colorPrimario?: string;
    idioma?: string;
  } = {}
): Promise<{ ok: true; url: string; expira?: string } | { ok: false; categoria: CategoriaError; error: string }> {
  const r = await pedir(
    cred,
    `${BASE_PLATAFORMA}/customers/${encodeURIComponent(clienteId)}/setup_links`,
    {
      method: "POST",
      body: JSON.stringify({
        setup_link: {
          language: opciones.idioma ?? "es",
          allowed_connection_types: ["coexistence"],
          meta_billing_mode: opciones.metaBilling ?? "customer_managed",
          ...(opciones.volverBienA ? { success_redirect_url: opciones.volverBienA } : {}),
          ...(opciones.volverMalA ? { failure_redirect_url: opciones.volverMalA } : {}),
          ...(opciones.colorPrimario ? { theme_config: { primary_color: opciones.colorPrimario } } : {}),
        },
      }),
    }
  );
  if (!r.ok) return r;

  const d = r.datos as { url?: string; expires_at?: string; data?: { url?: string; expires_at?: string } };
  const fila = d?.data ?? d;
  if (!fila?.url) return { ok: false, categoria: "rechazado", error: "Kapso no devolvió una URL" };
  return { ok: true, url: fila.url, expira: fila.expires_at };
}

/* ============================================================
   WEBHOOK ENTRANTE
   ============================================================ */

export type MensajeEntrante = {
  tipo: "texto" | "boton" | "opcion_lista" | "otro";
  /** El número que escribió, en E.164 sin `+`. */
  de: string;
  phoneNumberId: string;
  /** El texto, o el título del botón/opción que tocaron. */
  texto: string;
  /** El `id` que le pusimos al botón o a la opción. Es nuestro, no de Meta. */
  payload?: string;
  mensajeId: string;
  fechaHora: Date;
};

export type EventoWebhook =
  | { tipo: "mensaje"; mensaje: MensajeEntrante }
  | { tipo: "estado"; mensajeId: string; estado: string; fechaHora: Date }
  | { tipo: "numero_conectado"; clienteId: string; phoneNumberId: string; telefono?: string }
  | { tipo: "numero_desconectado"; clienteId: string; phoneNumberId: string }
  | { tipo: "ignorado"; motivo: string };

/**
 * Lee un evento del webhook. **Nunca tira.**
 *
 * Lo que no se entiende sale como `"ignorado"` y **el webhook igual contesta
 * 200**. Si contestara error, Kapso reintenta el mismo cuerpo para siempre y
 * los eventos que sí importan se quedan atrás en la cola.
 *
 * Un evento de un cliente que no es nuestro también es `"ignorado"`: el webhook
 * de proyecto dispara para TODAS las aplicaciones que comparten el proyecto, y
 * filtrar es responsabilidad de cada una.
 */
/**
 * Cuánto texto se acepta de un mensaje entrante.
 *
 * WhatsApp topea un mensaje en 4096 caracteres, así que más que eso no viene de
 * una persona. Sin corte, ese cuerpo se guarda entero en la tabla de mensajes y
 * se le pasa al asistente: un solo POST con megabytes de texto llena la base y
 * el hilo del club queda inservible.
 */
const MAXIMO_TEXTO = 4096;

const soloLoQueEntra = (v: unknown): string => String(v ?? "").slice(0, MAXIMO_TEXTO);

export function leerEventoWebhook(crudo: unknown): EventoWebhook {
  if (!crudo || typeof crudo !== "object") return { tipo: "ignorado", motivo: "cuerpo vacío" };
  const e = crudo as Record<string, any>;

  const evento = String(e.event ?? e.type ?? "");
  const datos = e.data ?? e.payload ?? e;

  if (evento === "whatsapp.phone_number.created") {
    const id = datos?.phone_number_id ?? datos?.id;
    const cliente = datos?.customer_id ?? datos?.external_customer_id;
    if (!id || !cliente) return { tipo: "ignorado", motivo: "conexión sin ids" };
    return {
      tipo: "numero_conectado",
      clienteId: String(cliente),
      phoneNumberId: String(id),
      telefono: datos?.display_phone_number ? String(datos.display_phone_number) : undefined,
    };
  }

  if (evento === "whatsapp.phone_number.deleted") {
    const id = datos?.phone_number_id ?? datos?.id;
    const cliente = datos?.customer_id ?? datos?.external_customer_id;
    if (!id || !cliente) return { tipo: "ignorado", motivo: "desconexión sin ids" };
    return { tipo: "numero_desconectado", clienteId: String(cliente), phoneNumberId: String(id) };
  }

  // Kapso manda UN evento por estado. No existe
  // `whatsapp.message.status_updated`: suscribirse a ese nombre inventado deja
  // las marcas de entrega vacias para siempre sin que nada parezca roto.
  const estado = /^whatsapp\.message\.(delivered|read|failed|sent)$/.exec(evento);
  if (estado) {
    const id = datos?.message?.id ?? datos?.id ?? datos?.message_id;
    if (!id) return { tipo: "ignorado", motivo: "estado sin id de mensaje" };
    return { tipo: "estado", mensajeId: String(id), estado: estado[1]!, fechaHora: leerFecha(datos) };
  }

  if (evento === "whatsapp.message.received") {
    const m = datos?.message ?? datos;
    const de = m?.from ?? datos?.from;
    if (!de) return { tipo: "ignorado", motivo: "mensaje sin remitente" };

    const phoneNumberId =
      datos?.phone_number_id ?? m?.phone_number_id ?? datos?.metadata?.phone_number_id ?? "";

    const interactivo = m?.interactive;
    if (interactivo?.type === "button_reply") {
      return {
        tipo: "mensaje",
        mensaje: {
          tipo: "boton",
          de: String(de),
          phoneNumberId: String(phoneNumberId),
          texto: soloLoQueEntra(interactivo.button_reply?.title),
          payload: interactivo.button_reply?.id ? soloLoQueEntra(interactivo.button_reply.id) : undefined,
          mensajeId: String(m?.id ?? ""),
          fechaHora: leerFecha(m ?? datos),
        },
      };
    }
    if (interactivo?.type === "list_reply") {
      return {
        tipo: "mensaje",
        mensaje: {
          tipo: "opcion_lista",
          de: String(de),
          phoneNumberId: String(phoneNumberId),
          texto: soloLoQueEntra(interactivo.list_reply?.title),
          payload: interactivo.list_reply?.id ? soloLoQueEntra(interactivo.list_reply.id) : undefined,
          mensajeId: String(m?.id ?? ""),
          fechaHora: leerFecha(m ?? datos),
        },
      };
    }

    const texto = m?.text?.body ?? m?.body;
    return {
      tipo: "mensaje",
      mensaje: {
        tipo: texto ? "texto" : "otro",
        de: String(de),
        phoneNumberId: String(phoneNumberId),
        texto: texto ? soloLoQueEntra(texto) : "",
        mensajeId: String(m?.id ?? ""),
        fechaHora: leerFecha(m ?? datos),
      },
    };
  }

  return { tipo: "ignorado", motivo: `evento no manejado: ${evento || "(sin nombre)"}` };
}

/**
 * ¿Se le puede mandar texto libre a esta persona?
 *
 * La ventana de servicio son 24 horas desde el ÚLTIMO mensaje que ELLA mandó.
 * Afuera, solo plantillas. `null` significa "nunca escribió", que también es
 * afuera.
 */
export function dentroDeVentana24h(ultimoMensajeEntrante: Date | null | undefined, ahora = new Date()): boolean {
  if (!ultimoMensajeEntrante) return false;
  const ms = ahora.getTime() - ultimoMensajeEntrante.getTime();
  // Un mensaje del futuro (reloj desfasado) no abre la ventana: mandar texto
  // libre afuera de ella da 422 y el aviso se pierde entero.
  return ms >= 0 && ms < 24 * 3600 * 1000;
}

/**
 * Elige solo: texto adentro de la ventana, plantilla afuera.
 *
 * Es el patrón de todo aviso del producto, y escrito a mano en cada llamada se
 * olvida justo en el aviso que sale de madrugada.
 */
export function enviarAviso(
  cred: Credenciales,
  para: string,
  opciones: {
    ultimoMensajeEntrante?: Date | null;
    texto: string;
    plantilla: string;
    parametros?: readonly ParametroPlantilla[];
    idioma?: string;
    ahora?: Date;
  }
): Promise<Resultado> {
  if (dentroDeVentana24h(opciones.ultimoMensajeEntrante, opciones.ahora)) {
    return enviarTexto(cred, para, opciones.texto);
  }
  return enviarPlantilla(cred, para, opciones.plantilla, opciones.parametros ?? [], opciones.idioma);
}

/* ============================================================
   INTERNO
   ============================================================ */

type RespuestaOk = { ok: true; datos: unknown };
type RespuestaMal = { ok: false; categoria: CategoriaError; error: string; estado?: number };

async function pedir(
  cred: { apiKey: string; fetch?: FetchLike; timeoutMs?: number },
  url: string,
  init: RequestInit
): Promise<RespuestaOk | RespuestaMal> {
  if (!cred.apiKey) return { ok: false, categoria: "credenciales", error: "falta la clave de Kapso" };

  const hacerFetch = cred.fetch ?? globalThis.fetch;
  if (!hacerFetch) return { ok: false, categoria: "red", error: "no hay fetch disponible" };

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), cred.timeoutMs ?? 15_000);

  let rta: Response;
  try {
    rta = await hacerFetch(url, {
      ...init,
      signal: control.signal,
      headers: {
        "X-API-Key": cred.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    // Todo lo que sea salir a la red es `red`: reintentar sirve.
    return { ok: false, categoria: "red", error: mensajeDe(e) };
  } finally {
    clearTimeout(corte);
  }

  const texto = await rta.text().catch(() => "");
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (rta.ok) return { ok: true, datos };

  return {
    ok: false,
    categoria: categoriaDe(rta.status, texto),
    error: detalleDe(datos, texto, rta.status),
    estado: rta.status,
  };
}

function categoriaDe(estado: number, texto: string): CategoriaError {
  // 402 es la facturacion de Meta pausada, y no se arregla reintentando: hasta
  // que alguien cargue un medio de pago, NINGUN envio pago sale.
  if (estado === 402) return "facturacion";
  if (estado === 401 || estado === 403) return "credenciales";
  if (estado === 429) return "limite";
  if (estado >= 500) return "red";

  const t = texto.toLowerCase();
  if (t.includes("template")) return "plantilla";
  if (t.includes("24") && (t.includes("window") || t.includes("ventana"))) return "ventana";
  if (t.includes("phone") || t.includes("recipient")) return "numero";
  return "rechazado";
}

function detalleDe(datos: unknown, texto: string, estado: number): string {
  const d = datos as { error?: { message?: string }; message?: string; errors?: unknown } | null;
  const msg = d?.error?.message ?? d?.message;
  if (typeof msg === "string" && msg) return msg;
  return texto ? texto.slice(0, 500) : `HTTP ${estado}`;
}

function leerFecha(o: any): Date {
  const crudo = o?.timestamp ?? o?.created_at ?? o?.occurred_at;
  if (crudo == null) return new Date();
  // Cloud API manda el timestamp en SEGUNDOS y como texto. Pasarlo directo a
  // `new Date()` da 1970, y un aviso fechado en 1970 queda fuera de todo rango.
  if (typeof crudo === "number") return new Date(crudo < 1e12 ? crudo * 1000 : crudo);
  if (/^\d+$/.test(String(crudo))) {
    const n = Number(crudo);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const f = new Date(String(crudo));
  return Number.isNaN(f.getTime()) ? new Date() : f;
}

function recortar(s: string, largo: number): string {
  const t = String(s ?? "").trim();
  return t.length <= largo ? t : `${t.slice(0, largo - 1)}…`;
}

function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.name === "AbortError" ? "tiempo de espera agotado" : e.message;
  return String(e);
}
