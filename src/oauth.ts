import { ErrorMP } from "./errores.js";
import { pedirAMercadoPago, URL_AUTH_MP, type Fetch } from "./http.js";

export type CredencialesApp = { clientId: string; clientSecret: string };

export type TokensMP = {
  accessToken: string;
  refreshToken: string | null;
  publicKey: string | null;
  /** El id de usuario de MP de la vendedora, útil para diagnosticar. */
  usuarioMp: string | null;
  expiraEn: Date | null;
};

/** Cinco minutos de colchón: no queremos que el token venza a mitad de un cobro. */
const COLCHON_MS = 5 * 60 * 1000;

/**
 * A dónde mandar a la vendedora para que autorice la aplicación.
 *
 * El `state` lo arma la app: tiene que llevar a quién se está vinculando y un
 * nonce anti-CSRF (ver `iniciarVinculacion` en la entrada `/next`).
 */
export function urlDeAutorizacion(opciones: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`${URL_AUTH_MP}/authorization`);
  url.searchParams.set("client_id", opciones.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("redirect_uri", opciones.redirectUri);
  url.searchParams.set("state", opciones.state);
  return url.toString();
}

type RespuestaToken = {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  user_id?: number | string;
  expires_in?: number;
};

async function pedirTokens(
  form: Record<string, string>,
  opciones: { fetch?: Fetch; refreshTokenPrevio?: string }
): Promise<TokensMP> {
  let respuesta: RespuestaToken | null;
  try {
    respuesta = await pedirAMercadoPago<RespuestaToken>({
      ruta: "/oauth/token",
      metodo: "POST",
      cuerpoForm: form,
      fetch: opciones.fetch,
    });
  } catch (error) {
    // Un 400 de /oauth/token casi siempre es el code vencido o ya usado, o el
    // secret mal: para quien llama es un problema de credenciales, no un
    // "rechazado" genérico.
    if (error instanceof ErrorMP && error.categoria === "rechazado") {
      throw new ErrorMP("credenciales", "Mercado Pago rechazó la autorización", {
        estadoHttp: error.estadoHttp,
        detalle: error.detalle,
        cause: error,
      });
    }
    throw error;
  }

  if (!respuesta?.access_token) {
    throw new ErrorMP("credenciales", "Mercado Pago no devolvió un access token");
  }

  return {
    accessToken: respuesta.access_token,
    // Si MP no manda uno nuevo, el anterior sigue siendo válido: perderlo deja
    // a la tienda desvinculada sin que nadie haya hecho nada.
    refreshToken: respuesta.refresh_token ?? opciones.refreshTokenPrevio ?? null,
    publicKey: respuesta.public_key ?? null,
    usuarioMp: respuesta.user_id != null ? String(respuesta.user_id) : null,
    expiraEn: respuesta.expires_in
      ? new Date(Date.now() + respuesta.expires_in * 1000)
      : null,
  };
}

/** Canjea el `code` del callback por los tokens de la vendedora. */
export async function canjearCodigo(opciones: {
  code: string;
  redirectUri: string;
  app: CredencialesApp;
  fetch?: Fetch;
}): Promise<TokensMP> {
  return pedirTokens(
    {
      grant_type: "authorization_code",
      client_id: opciones.app.clientId,
      client_secret: opciones.app.clientSecret,
      code: opciones.code,
      redirect_uri: opciones.redirectUri,
    },
    { fetch: opciones.fetch }
  );
}

/** Renueva el access token con el refresh token. */
export async function refrescarToken(opciones: {
  refreshToken: string;
  app: CredencialesApp;
  fetch?: Fetch;
}): Promise<TokensMP> {
  return pedirTokens(
    {
      grant_type: "refresh_token",
      client_id: opciones.app.clientId,
      client_secret: opciones.app.clientSecret,
      refresh_token: opciones.refreshToken,
    },
    { fetch: opciones.fetch, refreshTokenPrevio: opciones.refreshToken }
  );
}

/** ¿Hay que renovar antes de usarlo? */
export function necesitaRefresco(expiraEn: Date | null, ahora = new Date()): boolean {
  if (!expiraEn) return false;
  return expiraEn.getTime() - ahora.getTime() <= COLCHON_MS;
}
