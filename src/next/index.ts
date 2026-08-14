import { esTransitorio } from "../errores.js";
import { verificarFirmaWebhook } from "../firma.js";
import { leerNotificacion } from "../notificacion.js";
import { urlDeAutorizacion } from "../oauth.js";

const COOKIE_NONCE = "mp_oauth_nonce";
const COOKIE_VOLVER = "mp_oauth_volver";
const VIDA_COOKIE_SEGUNDOS = 600;

export type CookieAEscribir = {
  nombre: string;
  valor: string;
  opciones: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    maxAge: number;
    path: string;
  };
};

/**
 * El handler del webhook, entero.
 *
 * El código de respuesta no es cosmético: con 200 MP da el aviso por entregado
 * y no vuelve a mandarlo nunca; con 500 lo reintenta. Por eso:
 *
 * - **401** si la firma no valida (y no se procesa nada).
 * - **200** cuando reintentar no cambiaría nada: el aviso no es de un pago, o
 *   el error es definitivo (credenciales, rechazo de MP).
 * - **500** cuando el problema fue pasajero, para que MP reintente. Un error
 *   inesperado también cae acá: preferimos un reintento de más a perder el
 *   aviso de un pago que la clienta ya hizo.
 */
export function rutaWebhook(config: {
  secreto: string | null;
  permitirSinSecreto?: boolean;
  alRecibirPago: (pagoId: string, url: URL) => Promise<void>;
  alRecibirContracargo?: (pagoId: string, url: URL) => Promise<void>;
}) {
  return async function POST(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // El cuerpo puede no ser JSON: MP a veces avisa solo por query string.
    const cuerpo = await request.json().catch(() => ({}));
    const aviso = leerNotificacion({ url: request.url, cuerpo });

    const firmaOk = verificarFirmaWebhook({
      cabeceraFirma: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId: aviso.dataId,
      secreto: config.secreto,
      permitirSinSecreto: config.permitirSinSecreto,
    });
    if (!firmaOk) {
      return Response.json({ error: "firma_invalida" }, { status: 401 });
    }

    if (!aviso.dataId) return Response.json({ recibido: true });

    try {
      if (aviso.esPago) {
        await config.alRecibirPago(aviso.dataId, url);
      } else if (aviso.esContracargo && config.alRecibirContracargo) {
        await config.alRecibirContracargo(aviso.dataId, url);
      }
    } catch (error) {
      if (esTransitorio(error)) {
        console.error("Webhook de MP: fallo pasajero, pedimos reintento", error);
        return Response.json({ error: "reintentar" }, { status: 500 });
      }
      console.error("Webhook de MP: fallo definitivo, no reintentar", error);
      return Response.json({ recibido: true, procesado: false });
    }

    return Response.json({ recibido: true });
  };
}

/** ¿Es un path de nuestro propio sitio? Evita el open redirect al volver. */
export function esPathInterno(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return valor.startsWith("/") && !valor.startsWith("//");
}

/**
 * Arranca la vinculación: a dónde mandar a la vendedora y qué cookies dejar.
 *
 * El `nonce` entra por parámetro en vez de generarse acá para que la función
 * sea determinista y testeable; la app lo saca de `crypto.randomUUID()`.
 * Viaja en el `state` Y en una cookie httpOnly: el callback exige que
 * coincidan, y eso es lo que impide que alguien inyecte un `code` ajeno.
 */
export function iniciarVinculacion(opciones: {
  clientId: string;
  redirectUri: string;
  /** A quién se está vinculando (en store360, el tenant). Sin `:`. */
  objetivo: string;
  nonce: string;
  volverA?: string | null;
  seguro?: boolean;
  rutaCookie?: string;
}): { url: string; cookies: CookieAEscribir[] } {
  const opcionesCookie = {
    httpOnly: true as const,
    secure: opciones.seguro ?? true,
    sameSite: "lax" as const,
    maxAge: VIDA_COOKIE_SEGUNDOS,
    path: opciones.rutaCookie ?? "/",
  };

  const cookies: CookieAEscribir[] = [
    { nombre: COOKIE_NONCE, valor: opciones.nonce, opciones: opcionesCookie },
  ];

  const volverA = opciones.volverA;
  if (esPathInterno(volverA)) {
    cookies.push({
      nombre: COOKIE_VOLVER,
      valor: volverA as string,
      opciones: opcionesCookie,
    });
  }

  return {
    url: urlDeAutorizacion({
      clientId: opciones.clientId,
      redirectUri: opciones.redirectUri,
      state: `${opciones.objetivo}:${opciones.nonce}`,
    }),
    cookies,
  };
}

export type VinculacionResuelta =
  | { ok: true; objetivo: string; code: string; volverA: string | null }
  | { ok: false; motivo: "sin_code" | "state_invalido" | "nonce_no_coincide" };

/**
 * Valida el callback del OAuth. **No canjea el code**: eso lo hace la app
 * después de verificar que esta persona puede vincular esta tienda, que es
 * una decisión que el paquete no puede tomar.
 */
export function resolverVinculacion(opciones: {
  url: string;
  leerCookie: (nombre: string) => string | undefined;
}): VinculacionResuelta {
  const query = new URL(opciones.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");

  if (!code) return { ok: false, motivo: "sin_code" };
  if (!state) return { ok: false, motivo: "state_invalido" };

  const separador = state.lastIndexOf(":");
  if (separador <= 0) return { ok: false, motivo: "state_invalido" };

  const objetivo = state.slice(0, separador);
  const nonce = state.slice(separador + 1);
  if (!objetivo || !nonce) return { ok: false, motivo: "state_invalido" };

  const nonceEsperado = opciones.leerCookie(COOKIE_NONCE);
  if (!nonceEsperado || nonceEsperado !== nonce) {
    return { ok: false, motivo: "nonce_no_coincide" };
  }

  const volverACrudo = opciones.leerCookie(COOKIE_VOLVER);
  return {
    ok: true,
    objetivo,
    code,
    volverA: esPathInterno(volverACrudo) ? (volverACrudo as string) : null,
  };
}
