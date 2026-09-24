import { describe, expect, it, vi } from "vitest";
import { ErrorMP } from "../src/errores.js";
import {
  canjearCodigo,
  necesitaRefresco,
  refrescarToken,
  urlDeAutorizacion,
} from "../src/oauth.js";

const APP = { clientId: "CLIENT", clientSecret: "SECRET" };

const RESPUESTA_TOKEN = {
  access_token: "AT",
  refresh_token: "RT",
  public_key: "PK",
  user_id: 987,
  expires_in: 21600,
};

function fetchQueDevuelve(estado: number, cuerpo: unknown) {
  const llamadas: { url: string; body: string }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, llamadas };
}

describe("urlDeAutorizacion", () => {
  it("arma la URL con todo lo que MP espera", () => {
    const url = new URL(
      urlDeAutorizacion({
        clientId: "CLIENT",
        redirectUri: "https://tienda.com/api/mercadopago/callback",
        state: "bestie:nonce123",
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://auth.mercadopago.com.ar/authorization"
    );
    expect(url.searchParams.get("client_id")).toBe("CLIENT");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("platform_id")).toBe("mp");
    expect(url.searchParams.get("state")).toBe("bestie:nonce123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://tienda.com/api/mercadopago/callback"
    );
  });
});

describe("canjearCodigo", () => {
  it("cambia el code por tokens y calcula el vencimiento", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00Z"));
    const { fn, llamadas } = fetchQueDevuelve(200, RESPUESTA_TOKEN);

    const tokens = await canjearCodigo({
      code: "CODE",
      redirectUri: "https://tienda.com/cb",
      app: APP,
      fetch: fn,
    });

    expect(llamadas[0]!.url).toBe("https://api.mercadopago.com/oauth/token");
    expect(llamadas[0]!.body).toContain("grant_type=authorization_code");
    expect(llamadas[0]!.body).toContain("code=CODE");
    expect(llamadas[0]!.body).toContain("client_secret=SECRET");
    expect(tokens.accessToken).toBe("AT");
    expect(tokens.refreshToken).toBe("RT");
    expect(tokens.publicKey).toBe("PK");
    expect(tokens.usuarioMp).toBe("987");
    expect(tokens.expiraEn).toEqual(new Date("2026-08-13T16:00:00Z"));
    vi.useRealTimers();
  });

  it("si MP no manda expires_in, no inventa un vencimiento", async () => {
    const { fn } = fetchQueDevuelve(200, { access_token: "AT" });
    const tokens = await canjearCodigo({
      code: "C",
      redirectUri: "https://x/cb",
      app: APP,
      fetch: fn,
    });
    expect(tokens.expiraEn).toBeNull();
    expect(tokens.refreshToken).toBeNull();
  });

  it("un code vencido o ya usado explota como error de credenciales", async () => {
    const { fn } = fetchQueDevuelve(400, { message: "invalid_grant" });
    const error = await canjearCodigo({
      code: "VIEJO",
      redirectUri: "https://x/cb",
      app: APP,
      fetch: fn,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
    expect((error as ErrorMP).categoria).toBe("credenciales");
  });

  it("un error que no es 'rechazado' (por ejemplo, de red) se propaga tal cual", async () => {
    const { fn } = fetchQueDevuelve(500, { message: "boom" });
    const error = await canjearCodigo({
      code: "X",
      redirectUri: "https://x/cb",
      app: APP,
      fetch: fn,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
    // No se reescribe a "credenciales": el 500 ya viene categorizado como "red".
    expect((error as ErrorMP).categoria).toBe("red");
  });

  it("una respuesta 200 sin access_token no se hace pasar por exito", async () => {
    const { fn } = fetchQueDevuelve(200, { token_type: "bearer" });
    const error = await canjearCodigo({
      code: "X",
      redirectUri: "https://x/cb",
      app: APP,
      fetch: fn,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
    expect((error as ErrorMP).categoria).toBe("credenciales");
  });
});

describe("refrescarToken", () => {
  it("usa grant_type refresh_token", async () => {
    const { fn, llamadas } = fetchQueDevuelve(200, RESPUESTA_TOKEN);
    const tokens = await refrescarToken({ refreshToken: "RT", app: APP, fetch: fn });
    expect(llamadas[0]!.body).toContain("grant_type=refresh_token");
    expect(llamadas[0]!.body).toContain("refresh_token=RT");
    expect(tokens.accessToken).toBe("AT");
  });

  it("si MP no devuelve refresh_token nuevo, conserva el que teniamos", async () => {
    const { fn } = fetchQueDevuelve(200, { access_token: "AT2", expires_in: 100 });
    const tokens = await refrescarToken({
      refreshToken: "EL-VIEJO",
      app: APP,
      fetch: fn,
    });
    expect(tokens.refreshToken).toBe("EL-VIEJO");
  });
});

describe("necesitaRefresco", () => {
  const ahora = new Date("2026-08-13T10:00:00Z");

  it("es true cuando ya vencio", () => {
    expect(necesitaRefresco(new Date("2026-08-13T09:00:00Z"), ahora)).toBe(true);
  });

  it("es true dentro de los 5 minutos previos, para no cortar a mitad de un cobro", () => {
    expect(necesitaRefresco(new Date("2026-08-13T10:03:00Z"), ahora)).toBe(true);
  });

  it("es false cuando falta tiempo de sobra", () => {
    expect(necesitaRefresco(new Date("2026-08-13T15:00:00Z"), ahora)).toBe(false);
  });

  it("sin fecha de vencimiento no refresca: el token no vence", () => {
    expect(necesitaRefresco(null, ahora)).toBe(false);
  });
});
