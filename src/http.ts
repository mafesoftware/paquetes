import { ErrorMP } from "./errores.js";

export type Fetch = typeof globalThis.fetch;

export const URL_API_MP = "https://api.mercadopago.com";
export const URL_AUTH_MP = "https://auth.mercadopago.com.ar";

/**
 * La única puerta de salida del paquete hacia Mercado Pago.
 *
 * Existe para que la traducción "respuesta HTTP → ErrorMP con categoría" esté
 * en un solo lugar: es lo que después decide si el webhook responde 200 o 500.
 *
 * Devuelve `null` SOLO en 404 — que para MP no es un error sino "ese pago no
 * existe todavía", algo que pasa de verdad cuando un aviso llega adelantado.
 */
export async function pedirAMercadoPago<T>(opciones: {
  ruta: string;
  metodo?: "GET" | "POST";
  accessToken?: string;
  cuerpoJson?: unknown;
  cuerpoForm?: Record<string, string>;
  fetch?: Fetch;
}): Promise<T | null> {
  const hacerPedido = opciones.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opciones.accessToken) {
    headers.authorization = `Bearer ${opciones.accessToken}`;
  }

  let body: string | undefined;
  if (opciones.cuerpoForm) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opciones.cuerpoForm).toString();
  } else if (opciones.cuerpoJson !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opciones.cuerpoJson);
  }

  let respuesta: Response;
  try {
    respuesta = await hacerPedido(`${URL_API_MP}${opciones.ruta}`, {
      method: opciones.metodo ?? (body ? "POST" : "GET"),
      headers,
      body,
    });
  } catch (causa) {
    // No llegamos a hablar con MP: DNS, corte, timeout. Siempre reintentable.
    throw new ErrorMP("red", `No se pudo llegar a Mercado Pago (${opciones.ruta})`, {
      cause: causa,
    });
  }

  if (respuesta.status === 404) return null;

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new ErrorMP(
      categoriaDeEstado(respuesta.status),
      mensajeDeError(respuesta.status, opciones.ruta),
      { estadoHttp: respuesta.status, detalle }
    );
  }

  return (await respuesta.json()) as T;
}

function categoriaDeEstado(estado: number) {
  if (estado === 401 || estado === 403) return "credenciales" as const;
  if (estado >= 500) return "red" as const;
  return "rechazado" as const;
}

function mensajeDeError(estado: number, ruta: string) {
  if (estado === 401 || estado === 403) {
    return `Mercado Pago rechazó las credenciales en ${ruta}`;
  }
  if (estado >= 500) return `Mercado Pago falló (${estado}) en ${ruta}`;
  return `Mercado Pago rechazó el pedido (${estado}) en ${ruta}`;
}
