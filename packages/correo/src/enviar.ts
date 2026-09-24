/**
 * La única puerta de salida hacia Resend.
 *
 * **Nunca tira.** Un mail es un aviso, no una operación: si mandarlo pudiera
 * tumbar lo que lo dispara, un proveedor de correo caído dejaría a un comercio
 * sin poder vender. Todo error vuelve como resultado, con una categoría que le
 * dice a quien llama si reintentar tiene sentido.
 */

export type Fetch = typeof globalThis.fetch;

export const URL_API_RESEND = "https://api.resend.com";

/**
 * Por qué falló el envío. La categoría no es decoración: `red` y `limite` se
 * arreglan reintentando más tarde; `credenciales` y `rechazado`, no.
 */
export type CategoriaErrorCorreo =
  /** API key mala o revocada, dominio sin verificar. Reintentar no arregla. */
  | "credenciales"
  /** Resend entendió y dijo que no: destinatario inválido, cuerpo vacío. */
  | "rechazado"
  /** Demasiados envíos por segundo. Reintentar más tarde sí arregla. */
  | "limite"
  /** No se llegó a Resend, o Resend devolvió 5xx. Reintentar puede arreglar. */
  | "red";

export type Adjunto = {
  /** Con extensión: es lo que ve quien recibe ("factura-0001.pdf"). */
  nombre: string;
  /** Los bytes, o el base64 ya armado si viene de otro lado. */
  contenido: Uint8Array | string;
  /** MIME. Sin él, el cliente de correo adivina por la extensión. */
  tipo?: string;
};

export type ResultadoCorreo =
  | { ok: true; id: string }
  | { ok: false; categoria: CategoriaErrorCorreo; error: string };

export type OpcionesEnvio = {
  apiKey: string;
  /** El remitente completo: `Bestie K-Beauty <no-reply-bestie@store360.com.ar>`. */
  de: string;
  para: string | string[];
  asunto: string;
  html?: string;
  texto?: string;
  /** A dónde va la respuesta si quien recibe aprieta "responder". */
  responderA?: string;
  adjuntos?: Adjunto[];
  /**
   * Se manda como header `Idempotency-Key` a Resend. Con la MISMA clave,
   * un segundo POST (un reintento de red, o un caller que perdió la
   * respuesta del primero y no sabe si salió) no crea un segundo mail —
   * Resend devuelve el resultado del primero. Pensada para un caller que
   * reintenta un envío que ya pudo haber salido (ej.
   * `@mafesoftware/outbox`, cuyo `procesarOutbox` puede reintentar un
   * mensaje si el worker se cae ANTES de registrar que ya se mandó — ver
   * "Entrega al menos una vez" en su documentación). Sin esta clave (no se
   * pasa), cada llamada es un envío nuevo para Resend, como hasta ahora.
   */
  claveIdempotencia?: string;
  /** Inyectable para los tests: no salen a hablar con Resend de verdad. */
  fetch?: Fetch;
};

function categoriaDeEstado(estado: number): CategoriaErrorCorreo {
  if (estado === 401 || estado === 403) return "credenciales";
  if (estado === 429) return "limite";
  if (estado >= 500) return "red";
  return "rechazado";
}

function aBase64(contenido: Uint8Array | string): string {
  if (typeof contenido === "string") return contenido;
  return Buffer.from(contenido).toString("base64");
}

/** Una dirección con forma de mail. No valida el buzón: eso lo hace Resend. */
function esEmail(valor: string): boolean {
  const limpio = valor.trim();
  return limpio.includes("@") && !limpio.includes(" ") && limpio.length >= 5;
}

/**
 * Manda un mail por Resend. Devuelve el resultado, **nunca tira**.
 *
 * Los rechazos de validación salen ANTES de tocar la red y con la misma forma
 * que un rechazo de Resend: quien llama tiene un solo camino de error.
 */
export async function enviarCorreo(
  opciones: OpcionesEnvio
): Promise<ResultadoCorreo> {
  if (!opciones.apiKey.trim()) {
    return {
      ok: false,
      categoria: "credenciales",
      error: "Falta la API key de Resend.",
    };
  }

  const para = (
    Array.isArray(opciones.para) ? opciones.para : [opciones.para]
  )
    .map((direccion) => direccion.trim())
    .filter(Boolean);
  if (para.length === 0 || !para.every(esEmail)) {
    return {
      ok: false,
      categoria: "rechazado",
      error: "El destinatario no es una dirección de mail.",
    };
  }

  if (!opciones.asunto.trim()) {
    return { ok: false, categoria: "rechazado", error: "Falta el asunto." };
  }
  if (!opciones.html && !opciones.texto) {
    return {
      ok: false,
      categoria: "rechazado",
      error: "El mail no tiene cuerpo: falta html o texto.",
    };
  }

  const cuerpo: Record<string, unknown> = {
    from: opciones.de,
    to: para,
    subject: opciones.asunto,
  };
  if (opciones.html) cuerpo.html = opciones.html;
  if (opciones.texto) cuerpo.text = opciones.texto;
  if (opciones.responderA) cuerpo.reply_to = opciones.responderA;
  if (opciones.adjuntos && opciones.adjuntos.length > 0) {
    cuerpo.attachments = opciones.adjuntos.map((a) => ({
      filename: a.nombre,
      content: aBase64(a.contenido),
      ...(a.tipo ? { content_type: a.tipo } : {}),
    }));
  }

  const hacerPedido = opciones.fetch ?? globalThis.fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerPedido(`${URL_API_RESEND}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opciones.apiKey}`,
        "content-type": "application/json",
        ...(opciones.claveIdempotencia ? { "idempotency-key": opciones.claveIdempotencia } : {}),
      },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    return {
      ok: false,
      categoria: "red",
      error: "No se pudo llegar a Resend.",
    };
  }

  if (!respuesta.ok) {
    // Resend contesta { statusCode, name, message }; si el cuerpo no es JSON,
    // el estado HTTP alcanza para explicar.
    const detalle = (await respuesta.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      categoria: categoriaDeEstado(respuesta.status),
      error: detalle?.message || `Resend contestó ${respuesta.status}.`,
    };
  }

  const dato = (await respuesta.json().catch(() => null)) as {
    id?: string;
  } | null;
  return { ok: true, id: dato?.id ?? "" };
}
