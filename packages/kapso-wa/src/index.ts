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

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_META = "https://api.kapso.ai/meta/whatsapp/v24.0";
const BASE_PLATAFORMA = "https://api.kapso.ai/platform/v1";

/** Un `fetch` compatible. Se inyecta en los tests para no salir a la red. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Lo que necesita una llamada a la API de plataforma (clientes, webhooks, plantillas). */
export type CredencialesPlataforma = {
  apiKey: string;
  fetch?: FetchLike;
  /** Milisegundos antes de cortar. 15 s por defecto. */
  timeoutMs?: number;
};

export type Credenciales = CredencialesPlataforma & {
  /** El número desde el que se manda. Es un dato del CLUB, no del deployment. */
  phoneNumberId: string;
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
 *
 * **Cada aplicación tiene que pasar SU prefijo** (`"consult360"`, `"ediflow"`…).
 * El default `"gestionflow"` queda solo por compatibilidad con la primera app
 * que usó el paquete: otra app que lo omita da de alta a sus clientes como si
 * fueran de GestionFlow, y como el proyecto de Kapso es uno solo para todo MAFE
 * Software, después no hay forma de separarlos.
 */
export async function crearCliente(
  cred: CredencialesPlataforma,
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
 *
 * ## Reconectar un número que se cayó
 *
 * La excepción es `reconectarTelefono` (`reconnect_phone_number`, el número
 * como se muestra, p. ej. `"+5491145678901"`): cuando la credencial se rompió
 * (token revocado, cambio de contraseña), el link queda atado a ESE número y a
 * su WABA, y solo renueva la credencial. Kapso fija ahí el tipo de conexión al
 * de la conexión existente y contesta 422 si se le manda otro, así que en ese
 * caso **no se manda `allowed_connection_types`**, y tampoco
 * `meta_billing_mode` salvo que se pase explícito (es de la WABA y no cambia).
 * Si el número no es de ese cliente, también es 422.
 */
export async function crearSetupLink(
  cred: CredencialesPlataforma,
  clienteId: string,
  opciones: {
    metaBilling?: "customer_managed" | "partner_managed";
    volverBienA?: string;
    volverMalA?: string;
    colorPrimario?: string;
    idioma?: string;
    /** Número ya conectado de este cliente cuya credencial hay que renovar. */
    reconectarTelefono?: string;
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
          ...(opciones.reconectarTelefono
            ? {
                reconnect_phone_number: opciones.reconectarTelefono,
                ...(opciones.metaBilling ? { meta_billing_mode: opciones.metaBilling } : {}),
              }
            : {
                allowed_connection_types: ["coexistence"],
                meta_billing_mode: opciones.metaBilling ?? "customer_managed",
              }),
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
   WEBHOOKS DEL NÚMERO
   ============================================================ */

/**
 * Los eventos que un número le manda a la aplicación por defecto.
 *
 * Uno por estado: no existe `whatsapp.message.status_updated`. `sent` no va
 * porque eso ya lo dice la respuesta del envío.
 */
export const EVENTOS_WEBHOOK_NUMERO = [
  "whatsapp.message.received",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.failed",
] as const;

export type WebhookNumero = { id: string; url: string; eventos: string[]; activo: boolean };

/**
 * Registra el webhook de un número (`kind: "kapso"`).
 *
 * Los mensajes se rutean **por número**, no por proyecto: el webhook de
 * proyecto solo trae conexiones (`whatsapp.phone_number.*`). Por eso cada
 * número que se conecta registra el suyo apuntando a la aplicación dueña, y un
 * mensaje al número de un club nunca termina en otra app del mismo proyecto.
 *
 * El `secreto` es obligatorio y **Kapso no lo genera**: lo elige la app. Con uno
 * solo para todos sus números, `verificarFirmaWebhook` usa un único secreto.
 *
 * Registrar dos veces la misma URL deja dos webhooks y cada evento llega
 * duplicado: mirar antes con `listarWebhooksNumero`.
 */
export async function registrarWebhookNumero(
  cred: CredencialesPlataforma,
  phoneNumberId: string,
  webhook: { url: string; secreto: string; eventos?: readonly string[] }
): Promise<{ ok: true; webhook: WebhookNumero } | { ok: false; categoria: CategoriaError; error: string; estado?: number }> {
  if (!phoneNumberId) return { ok: false, categoria: "numero", error: "falta el phoneNumberId" };
  if (!webhook.url) return { ok: false, categoria: "rechazado", error: "falta la URL del webhook" };
  if (!webhook.secreto) return { ok: false, categoria: "credenciales", error: "falta el secreto del webhook" };
  const eventos = webhook.eventos?.length ? [...webhook.eventos] : [...EVENTOS_WEBHOOK_NUMERO];

  const r = await pedir(cred, `${BASE_PLATAFORMA}/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      whatsapp_webhook: { kind: "kapso", url: webhook.url, events: eventos, secret_key: webhook.secreto, active: true },
    }),
  });
  if (!r.ok) return r;

  const d = r.datos as { data?: unknown } | null;
  const fila = aWebhook(d?.data ?? d);
  if (!fila) return { ok: false, categoria: "rechazado", error: "Kapso no devolvió un id de webhook" };
  return { ok: true, webhook: fila };
}

/**
 * Los webhooks de un número, el más nuevo primero.
 *
 * Devuelve el arreglo ya desenvuelto del `{ data: [...] }` de Kapso: leer
 * `.data.data` daba `undefined` y la lista se veía vacía siempre.
 */
export async function listarWebhooksNumero(
  cred: CredencialesPlataforma,
  phoneNumberId: string
): Promise<{ ok: true; webhooks: WebhookNumero[] } | { ok: false; categoria: CategoriaError; error: string; estado?: number }> {
  if (!phoneNumberId) return { ok: false, categoria: "numero", error: "falta el phoneNumberId" };
  const r = await pedir(cred, `${BASE_PLATAFORMA}/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`, {
    method: "GET",
  });
  if (!r.ok) return r;
  const d = r.datos as { data?: unknown } | null;
  const filas = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
  return { ok: true, webhooks: filas.map(aWebhook).filter((w): w is WebhookNumero => w !== null) };
}

function aWebhook(crudo: any): WebhookNumero | null {
  if (!crudo?.id) return null;
  return {
    id: String(crudo.id),
    url: String(crudo.url ?? ""),
    eventos: Array.isArray(crudo.events) ? crudo.events.map(String) : [],
    activo: crudo.active !== false,
  };
}

/* ============================================================
   PLANTILLAS
   ============================================================ */

export type CategoriaPlantilla = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export type Plantilla = {
  id: string;
  nombre: string;
  idioma?: string;
  /** `APPROVED`, `PENDING`, `REJECTED`… tal cual lo dice Meta. */
  estado: string;
  categoria?: string;
};

/**
 * Da de alta una plantilla en la WABA del club. Queda `PENDING` hasta que Meta
 * la revisa (minutos a horas); recién `APPROVED` se puede mandar.
 *
 * `componentes` es el arreglo `components` de Meta tal cual (`BODY`, `HEADER`,
 * `FOOTER`, `BUTTONS`), con sus `example`: Meta rechaza un cuerpo con
 * parámetros sin ejemplo. El nombre lleva el prefijo de la app (ver el
 * encabezado del módulo).
 *
 * La WABA es del club, así que esto se corre **una vez por club** al conectar
 * su número, no una vez por aplicación.
 */
export async function crearPlantilla(
  cred: CredencialesPlataforma,
  wabaId: string,
  definicion: {
    nombre: string;
    idioma?: string;
    categoria: CategoriaPlantilla;
    componentes: readonly unknown[];
    formatoParametros?: "POSITIONAL" | "NAMED";
  }
): Promise<{ ok: true; plantilla: Plantilla } | { ok: false; categoria: CategoriaError; error: string; estado?: number }> {
  if (!wabaId) return { ok: false, categoria: "credenciales", error: "falta el id de la WABA" };
  if (!definicion.nombre) return { ok: false, categoria: "plantilla", error: "falta el nombre de la plantilla" };

  const idioma = definicion.idioma ?? "es_AR";
  const r = await pedir(cred, `${BASE_META}/${encodeURIComponent(wabaId)}/message_templates`, {
    method: "POST",
    body: JSON.stringify({
      name: definicion.nombre,
      language: idioma,
      category: definicion.categoria,
      ...(definicion.formatoParametros ? { parameter_format: definicion.formatoParametros } : {}),
      components: definicion.componentes,
    }),
  });
  if (!r.ok) return r;

  // El proxy de Meta contesta `{ id, status, category }` SIN el sobre `data`.
  const d = r.datos as { id?: string; status?: string; category?: string; data?: { id?: string; status?: string; category?: string } } | null;
  const fila = d?.data ?? d;
  if (!fila?.id) return { ok: false, categoria: "rechazado", error: "Kapso no devolvió un id de plantilla" };
  return {
    ok: true,
    plantilla: {
      id: String(fila.id),
      nombre: definicion.nombre,
      idioma,
      estado: String(fila.status ?? "PENDING"),
      ...(fila.category ? { categoria: String(fila.category) } : {}),
    },
  };
}

/**
 * Las plantillas de una WABA con su estado. Sirve para saber si una ya está
 * aprobada antes de mandarla, o si hay que darla de alta.
 *
 * Trae hasta `limite` (100 por defecto, el máximo de Meta). Si hay más,
 * `siguiente` es el cursor para pedir la página que sigue con `despues`.
 */
export async function listarPlantillas(
  cred: CredencialesPlataforma,
  wabaId: string,
  opciones: { nombre?: string; estado?: string; limite?: number; despues?: string } = {}
): Promise<
  | { ok: true; plantillas: Plantilla[]; siguiente?: string }
  | { ok: false; categoria: CategoriaError; error: string; estado?: number }
> {
  if (!wabaId) return { ok: false, categoria: "credenciales", error: "falta el id de la WABA" };
  const limite = Math.min(Math.max(1, Math.trunc(opciones.limite ?? 100)), 100);
  const q = new URLSearchParams({ limit: String(limite) });
  if (opciones.nombre) q.set("name", opciones.nombre);
  if (opciones.estado) q.set("status", opciones.estado);
  if (opciones.despues) q.set("after", opciones.despues);

  const r = await pedir(cred, `${BASE_META}/${encodeURIComponent(wabaId)}/message_templates?${q}`, { method: "GET" });
  if (!r.ok) return r;

  const d = r.datos as { data?: unknown; paging?: { next?: string; cursors?: { after?: string } } } | null;
  const filas: any[] = Array.isArray(d?.data) ? d.data : [];
  const plantillas = filas
    .filter((f) => f?.name)
    .map((f) => ({
      id: String(f.id ?? ""),
      nombre: String(f.name),
      ...(f.language ? { idioma: String(f.language) } : {}),
      estado: String(f.status ?? ""),
      ...(f.category ? { categoria: String(f.category) } : {}),
    }));
  // Meta deja `cursors.after` aun en la última página: solo hay "siguiente" si
  // dice `next`, o si la página vino llena.
  const despues = d?.paging?.cursors?.after;
  const hayMas = Boolean(d?.paging?.next) || filas.length >= limite;
  return { ok: true, plantillas, ...(despues && hayMas ? { siguiente: despues } : {}) };
}

/* ============================================================
   MEDIA ENTRANTE
   ============================================================ */

/**
 * Baja lo adjunto a un mensaje entrante (foto de un comprobante, audio…).
 *
 * Son dos pasos: `GET /{media_id}?phone_number_id=…` devuelve los datos de Meta
 * más un `download_url` de Kapso con la autenticación adentro (vale **4
 * minutos**), y después se baja ese `download_url` sin la clave. El `url` de
 * Meta que viene al lado NO sirve: pide el token de Meta, que no tenemos.
 *
 * En un evento de Kapso suele venir además `mensaje.media.url`
 * (`message.kapso.media_url`), que ya está espejado; esto es para cuando solo
 * se tiene el id, o para bajarlo más tarde.
 */
export async function bajarMedia(
  cred: Credenciales,
  mediaId: string
): Promise<
  | { ok: true; bytes: Uint8Array; mimeType: string; nombreArchivo?: string }
  | { ok: false; categoria: CategoriaError; error: string; estado?: number }
> {
  if (!cred.phoneNumberId) return { ok: false, categoria: "credenciales", error: "falta el phoneNumberId del club" };
  if (!mediaId) return { ok: false, categoria: "rechazado", error: "falta el id de la media" };

  const q = new URLSearchParams({ phone_number_id: cred.phoneNumberId });
  const r = await pedir(cred, `${BASE_META}/${encodeURIComponent(mediaId)}?${q}`, { method: "GET" });
  if (!r.ok) return r;

  const d = r.datos as { download_url?: string; mime_type?: string; filename?: string } | null;
  if (!d?.download_url) return { ok: false, categoria: "rechazado", error: "Kapso no devolvió un download_url" };

  const b = await bajarBytes(cred, d.download_url);
  if (!b.ok) return b;
  return {
    ok: true,
    bytes: b.bytes,
    mimeType: d.mime_type || b.tipo || "application/octet-stream",
    ...(d.filename ? { nombreArchivo: String(d.filename) } : {}),
  };
}

/* ============================================================
   WEBHOOK ENTRANTE
   ============================================================ */

/**
 * ¿Este cuerpo lo mandó Kapso de verdad?
 *
 * Kapso firma cada entrega con HMAC-SHA256 sobre el **cuerpo crudo**, en hex,
 * con el `secret_key` que se eligió al registrar el webhook, y lo manda en la
 * cabecera `X-Webhook-Signature`.
 *
 * **Crudo** quiere decir los bytes tal como llegaron (`await request.text()`),
 * no un `JSON.stringify` del objeto ya parseado: cualquier diferencia de orden
 * de claves o de escapes rompe la firma, y lo rompe de a ratos, que es la peor
 * forma de romperse.
 *
 * Sin secreto o sin firma el resultado es `false`, nunca "dejar pasar": un
 * webhook sin verificar deja que cualquiera POSTee "el socio 1042 pregunta por
 * su deuda" haciéndose pasar por su teléfono. Decidir qué hacer en desarrollo
 * es de la aplicación (el paquete no mira `NODE_ENV`).
 *
 * Usa `node:crypto` como `verificarFirmaWebhook` de `@mafesoftware/mercadopago-ar`:
 * sincrónico, y corre en Node ≥ 20 y en las funciones de Vercel. La comparación
 * es en tiempo constante.
 */
export function verificarFirmaWebhook(
  cuerpoCrudo: string | Uint8Array,
  firmaHex: string | null | undefined,
  secreto: string
): boolean {
  if (!secreto || !firmaHex) return false;
  // El hex de Kapso viene en minúsculas; se normaliza por si un proxy lo toca.
  const recibida = Buffer.from(firmaHex.trim().toLowerCase(), "utf8");
  const calculada = Buffer.from(createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex"), "utf8");
  // timingSafeEqual tira si los largos difieren, así que se chequea antes. El
  // largo de un HMAC no es secreto: siempre son 64 caracteres.
  if (recibida.length !== calculada.length) return false;
  return timingSafeEqual(recibida, calculada);
}

/** Lo adjunto a un mensaje entrante: imagen, video, documento o audio. */
export type MediaEntrante = {
  /** El id de Meta. Con esto se baja por `bajarMedia`. */
  id: string;
  mimeType?: string;
  nombreArchivo?: string;
  /**
   * `message.kapso.media_url`: Kapso ya lo espejó y lo deja listo para bajar
   * sin pasar por `bajarMedia`. Puede no venir (p. ej. en un webhook `meta`).
   */
  url?: string;
};

export type MensajeEntrante = {
  tipo: "texto" | "boton" | "opcion_lista" | "imagen" | "video" | "documento" | "audio" | "ubicacion" | "otro";
  /** El número que escribió, en E.164 sin `+`. */
  de: string;
  phoneNumberId: string;
  /**
   * El texto; el título del botón/opción que tocaron; el epígrafe de una
   * imagen, video o documento (vacío si no tiene); o `"lat,lng"` en una
   * ubicación.
   */
  texto: string;
  /** El `id` que le pusimos al botón o a la opción. Es nuestro, no de Meta. */
  payload?: string;
  /** Solo en imagen, video, documento y audio. */
  media?: MediaEntrante;
  /** `conversation.contact_name`: el nombre de perfil de WhatsApp, si Kapso lo sabe. */
  nombreContacto?: string;
  mensajeId: string;
  fechaHora: Date;
};

/** El error que Meta adjunta a un estado `failed` (p. ej. 131047, fuera de la ventana). */
export type ErrorDeEstado = { codigo?: number; titulo?: string; mensaje?: string };

export type EventoWebhook =
  | { tipo: "mensaje"; mensaje: MensajeEntrante }
  | { tipo: "estado"; mensajeId: string; estado: string; fechaHora: Date; error?: ErrorDeEstado }
  | {
      tipo: "numero_conectado";
      /** El id de cliente de Kapso (`customer.id`), el que devolvió `crearCliente`. */
      clienteId: string;
      phoneNumberId: string;
      telefono?: string;
      /** `customer.external_id`: el `<prefijo>:<id>` que se le puso en `crearCliente`. */
      idExterno?: string;
    }
  | { tipo: "numero_desconectado"; clienteId: string; phoneNumberId: string; idExterno?: string }
  | { tipo: "ignorado"; motivo: string };

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

/** Lo que Meta llama `image`/`video`/`document`/`audio`, en nuestros nombres. */
const TIPOS_MEDIA: Record<string, "imagen" | "video" | "documento" | "audio"> = {
  image: "imagen",
  video: "video",
  document: "documento",
  audio: "audio",
};

/**
 * Lee UN evento del webhook. **Nunca tira.**
 *
 * **El nombre del evento viaja en la cabecera `X-Webhook-Event`, no en el
 * cuerpo**: el cuerpo v2 de un mensaje es `{ message, conversation,
 * phone_number_id }` y no dice qué evento es. Por eso el segundo argumento —
 * pasarle `request.headers.get("x-webhook-event")` — manda sobre
 * `cuerpo.event`/`cuerpo.type`, que quedan solo como respaldo. Sin la cabecera,
 * un mensaje real de Kapso sale `"ignorado"`.
 *
 * Lo que no se entiende sale como `"ignorado"` y **el webhook igual contesta
 * 200**. Si contestara error, Kapso reintenta el mismo cuerpo y los eventos que
 * sí importan se quedan atrás en la cola.
 *
 * Un evento de un cliente que no es nuestro también es `"ignorado"`: el webhook
 * de proyecto dispara para TODAS las aplicaciones que comparten el proyecto, y
 * filtrar es responsabilidad de cada una.
 *
 * Un lote (`batch: true`, con buffering prendido) no se lee acá: sale
 * `"ignorado"` diciendo que se use `leerEventosWebhook`, para no perder en
 * silencio todos los mensajes menos uno.
 */
export function leerEventoWebhook(crudo: unknown, nombreEvento?: string | null): EventoWebhook {
  if (!crudo || typeof crudo !== "object") return { tipo: "ignorado", motivo: "cuerpo vacío" };
  const e = crudo as Record<string, any>;

  if (e.batch === true) {
    const n = Array.isArray(e.data) ? e.data.length : 0;
    return { tipo: "ignorado", motivo: `lote de ${n} eventos: usar leerEventosWebhook` };
  }

  const evento = String(nombreEvento?.trim() || e.event || e.type || "");
  const datos = e.data ?? e.payload ?? e;

  if (evento === "whatsapp.phone_number.created" || evento === "whatsapp.phone_number.deleted") {
    const id = datos?.phone_number_id ?? datos?.id;
    // v2 manda `customer: { id, external_id }`; `customer_id` suelto es de v1.
    const cliente = datos?.customer?.id ?? datos?.customer_id ?? datos?.external_customer_id;
    const externo = datos?.customer?.external_id ?? datos?.customer?.external_customer_id;
    const conectado = evento === "whatsapp.phone_number.created";
    if (!id || !cliente) return { tipo: "ignorado", motivo: conectado ? "conexión sin ids" : "desconexión sin ids" };
    const comun = {
      clienteId: String(cliente),
      phoneNumberId: String(id),
      ...(externo ? { idExterno: String(externo) } : {}),
    };
    if (!conectado) return { tipo: "numero_desconectado", ...comun };
    return {
      tipo: "numero_conectado",
      ...comun,
      telefono: datos?.display_phone_number ? String(datos.display_phone_number) : undefined,
    };
  }

  // Kapso manda UN evento por estado. No existe
  // `whatsapp.message.status_updated`: suscribirse a ese nombre inventado deja
  // las marcas de entrega vacias para siempre sin que nada parezca roto.
  const estado = /^whatsapp\.message\.(delivered|read|failed|sent)$/.exec(evento);
  if (estado) {
    const id = datos?.message?.id ?? datos?.id ?? datos?.message_id;
    if (!id) return { tipo: "ignorado", motivo: "estado sin id de mensaje" };
    const error = estado[1] === "failed" ? errorDeEstado(datos) : undefined;
    // En v2 la hora está en el último estado del historial, o en el mensaje;
    // la raíz no trae `timestamp`, y leerla ahí fechaba todo con "ahora".
    const ultimo = ultimoEstado(datos);
    return {
      tipo: "estado",
      mensajeId: String(id),
      estado: estado[1]!,
      fechaHora: leerFecha(ultimo?.timestamp != null ? ultimo : (datos?.message?.timestamp != null ? datos.message : datos)),
      ...(error ? { error } : {}),
    };
  }

  if (evento === "whatsapp.message.received") return leerMensaje(datos);

  return { tipo: "ignorado", motivo: `evento no manejado: ${evento || "(sin nombre)"}` };
}

/**
 * Lee TODO lo que trae una entrega del webhook, sea un evento suelto o un lote.
 *
 * Con buffering prendido para `whatsapp.message.received`, Kapso manda
 * **siempre** un sobre `{ type, batch: true, data: [...], batch_info }`, aunque
 * traiga un solo mensaje. Cada elemento de `data` tiene la misma forma que un
 * evento suelto. Sin buffering, devuelve un arreglo de uno.
 *
 * El nombre del evento sale de la cabecera `X-Webhook-Event` si se pasa, y si
 * no del `type` del sobre. Nunca tira.
 */
export function leerEventosWebhook(crudo: unknown, nombreEvento?: string | null): EventoWebhook[] {
  if (crudo && typeof crudo === "object" && (crudo as Record<string, unknown>).batch === true) {
    const sobre = crudo as Record<string, any>;
    if (!Array.isArray(sobre.data)) return [{ tipo: "ignorado", motivo: "lote sin data" }];
    const evento = String(nombreEvento?.trim() || sobre.type || sobre.event || "");
    return sobre.data.map((item: unknown) => leerEventoWebhook(item, evento));
  }
  return [leerEventoWebhook(crudo, nombreEvento)];
}

function leerMensaje(datos: any): EventoWebhook {
  const m = datos?.message ?? datos;
  const conversacion = datos?.conversation;
  // `from` puede no venir (identidades BSUID, y los elementos de un lote no lo
  // traen): el teléfono de la conversación es el mismo número.
  const de = m?.from ?? datos?.from ?? conversacion?.phone_number;
  if (!de) return { tipo: "ignorado", motivo: "mensaje sin remitente" };

  const phoneNumberId =
    datos?.phone_number_id ??
    m?.phone_number_id ??
    datos?.metadata?.phone_number_id ??
    conversacion?.phone_number_id ??
    m?.kapso?.phone_number_id ??
    "";

  const base = {
    de: String(de).replace(/^\+/, ""),
    phoneNumberId: String(phoneNumberId),
    ...(conversacion?.contact_name ? { nombreContacto: soloLoQueEntra(conversacion.contact_name) } : {}),
    mensajeId: String(m?.id ?? ""),
    fechaHora: leerFecha(m ?? datos),
  };
  const mensaje = (resto: Pick<MensajeEntrante, "tipo" | "texto"> & Partial<MensajeEntrante>): EventoWebhook => ({
    tipo: "mensaje",
    mensaje: { ...base, ...resto },
  });

  const interactivo = m?.interactive;
  if (interactivo?.type === "button_reply" || interactivo?.type === "list_reply") {
    const r = interactivo.type === "button_reply" ? interactivo.button_reply : interactivo.list_reply;
    return mensaje({
      tipo: interactivo.type === "button_reply" ? "boton" : "opcion_lista",
      texto: soloLoQueEntra(r?.title),
      payload: r?.id ? soloLoQueEntra(r.id) : undefined,
    });
  }

  // El botón de respuesta rápida de una PLANTILLA no llega como `interactive`
  // sino como `type: "button"`, con el payload que se aprobó en la plantilla.
  if (m?.type === "button" && m?.button) {
    return mensaje({
      tipo: "boton",
      texto: soloLoQueEntra(m.button.text),
      payload: m.button.payload ? soloLoQueEntra(m.button.payload) : undefined,
    });
  }

  const tipoMedia = TIPOS_MEDIA[String(m?.type ?? "")];
  if (tipoMedia) {
    const obj = m?.[m.type] ?? {};
    const kapso = m?.kapso ?? {};
    const datosMedia = kapso.media_data ?? {};
    const url = kapso.media_url ?? datosMedia.url;
    const mimeType = obj.mime_type ?? datosMedia.content_type;
    const nombreArchivo = obj.filename ?? datosMedia.filename;
    return mensaje({
      tipo: tipoMedia,
      texto: soloLoQueEntra(obj.caption ?? kapso.message_type_data?.caption ?? ""),
      media: {
        id: String(obj.id ?? ""),
        ...(mimeType ? { mimeType: String(mimeType) } : {}),
        ...(nombreArchivo ? { nombreArchivo: String(nombreArchivo) } : {}),
        ...(url ? { url: String(url) } : {}),
      },
    });
  }

  if (m?.type === "location") {
    const lat = Number(m.location?.latitude);
    const lng = Number(m.location?.longitude);
    // Una ubicación sin coordenadas no ubica nada: mejor `otro` que "NaN,NaN".
    if (m.location?.latitude != null && m.location?.longitude != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      return mensaje({ tipo: "ubicacion", texto: `${lat},${lng}` });
    }
    return mensaje({ tipo: "otro", texto: "" });
  }

  const texto = m?.text?.body ?? m?.body;
  return mensaje({ tipo: texto ? "texto" : "otro", texto: texto ? soloLoQueEntra(texto) : "" });
}

/**
 * Por qué falló un mensaje. Meta lo deja en el ÚLTIMO elemento de
 * `message.kapso.statuses` (el historial crudo de estados), en `errors[0]`.
 */
function ultimoEstado(datos: any): any {
  const estados = datos?.message?.kapso?.statuses;
  return Array.isArray(estados) && estados.length ? estados[estados.length - 1] : undefined;
}

function errorDeEstado(datos: any): ErrorDeEstado | undefined {
  const ultimo = ultimoEstado(datos);
  const crudo = ultimo?.errors?.[0] ?? datos?.message?.errors?.[0] ?? datos?.errors?.[0];
  if (!crudo || typeof crudo !== "object") return undefined;
  const error: ErrorDeEstado = {
    ...(typeof crudo.code === "number" ? { codigo: crudo.code } : {}),
    ...(crudo.title ? { titulo: String(crudo.title) } : {}),
    ...(crudo.message ?? crudo.error_data?.details
      ? { mensaje: String(crudo.message ?? crudo.error_data.details) }
      : {}),
  };
  return Object.keys(error).length ? error : undefined;
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
  cred: CredencialesPlataforma,
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
  const datos = leerJson(texto);

  if (rta.ok) return { ok: true, datos };

  return {
    ok: false,
    categoria: categoriaDe(rta.status, texto),
    error: detalleDe(datos, texto, rta.status),
    estado: rta.status,
  };
}

/**
 * Baja bytes de una URL que ya trae su autenticación (el `download_url` de
 * Kapso): **sin** `X-API-Key`, que no hace falta y no tiene por qué viajar. El
 * corte por tiempo cubre también la lectura del cuerpo, que es lo que tarda en
 * un archivo grande.
 */
async function bajarBytes(
  cred: { fetch?: FetchLike; timeoutMs?: number },
  url: string
): Promise<{ ok: true; bytes: Uint8Array; tipo?: string } | RespuestaMal> {
  const hacerFetch = cred.fetch ?? globalThis.fetch;
  if (!hacerFetch) return { ok: false, categoria: "red", error: "no hay fetch disponible" };

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), cred.timeoutMs ?? 15_000);
  try {
    const rta = await hacerFetch(url, { method: "GET", signal: control.signal });
    if (!rta.ok) {
      const texto = await rta.text().catch(() => "");
      return {
        ok: false,
        categoria: categoriaDe(rta.status, texto),
        error: detalleDe(leerJson(texto), texto, rta.status),
        estado: rta.status,
      };
    }
    const bytes = new Uint8Array(await rta.arrayBuffer());
    return { ok: true, bytes, tipo: rta.headers?.get("content-type") ?? undefined };
  } catch (e) {
    return { ok: false, categoria: "red", error: mensajeDe(e) };
  } finally {
    clearTimeout(corte);
  }
}

function leerJson(texto: string): unknown {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
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
