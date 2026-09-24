import { describe, expect, it } from "vitest";
import { ErrorMP, esTransitorio } from "../src/errores.js";
import { pedirAMercadoPago } from "../src/http.js";

/** Un `fetch` de mentira que devuelve lo que le digamos y anota cómo lo llamaron. */
function fetchFalso(respuesta: {
  estado: number;
  cuerpo?: unknown;
  texto?: string;
}) {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    const texto = respuesta.texto ?? JSON.stringify(respuesta.cuerpo ?? {});
    return new Response(texto, {
      status: respuesta.estado,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, llamadas };
}

describe("pedirAMercadoPago", () => {
  it("manda el token como Bearer y devuelve el JSON", async () => {
    const { fn, llamadas } = fetchFalso({ estado: 200, cuerpo: { id: 42 } });
    const r = await pedirAMercadoPago<{ id: number }>({
      ruta: "/v1/payments/42",
      accessToken: "TOKEN",
      fetch: fn,
    });
    expect(r).toEqual({ id: 42 });
    expect(llamadas[0]!.url).toBe("https://api.mercadopago.com/v1/payments/42");
    const headers = new Headers(llamadas[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer TOKEN");
  });

  it("manda el cuerpo como form cuando se lo pide (OAuth)", async () => {
    const { fn, llamadas } = fetchFalso({ estado: 200, cuerpo: {} });
    await pedirAMercadoPago({
      ruta: "/oauth/token",
      metodo: "POST",
      cuerpoForm: { grant_type: "refresh_token", client_id: "1" },
      fetch: fn,
    });
    const headers = new Headers(llamadas[0]!.init?.headers);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(String(llamadas[0]!.init?.body)).toContain("grant_type=refresh_token");
  });

  it("devuelve null en 404, que no es un error", async () => {
    const { fn } = fetchFalso({ estado: 404, cuerpo: { message: "not found" } });
    expect(
      await pedirAMercadoPago({ ruta: "/v1/payments/9", accessToken: "T", fetch: fn })
    ).toBeNull();
  });

  it("un 401 es de credenciales y NO es transitorio", async () => {
    const { fn } = fetchFalso({ estado: 401, cuerpo: { message: "invalid token" } });
    const error = await pedirAMercadoPago({ ruta: "/x", fetch: fn }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
    expect((error as ErrorMP).categoria).toBe("credenciales");
    expect(esTransitorio(error)).toBe(false);
  });

  it("un 400 es rechazo de MP y NO es transitorio", async () => {
    const { fn } = fetchFalso({ estado: 400, cuerpo: { message: "bad request" } });
    const error = await pedirAMercadoPago({ ruta: "/x", fetch: fn }).catch((e) => e);
    expect((error as ErrorMP).categoria).toBe("rechazado");
    expect(esTransitorio(error)).toBe(false);
  });

  it("un 500 de MP es de red y SI es transitorio", async () => {
    const { fn } = fetchFalso({ estado: 500, texto: "boom" });
    const error = await pedirAMercadoPago({ ruta: "/x", fetch: fn }).catch((e) => e);
    expect((error as ErrorMP).categoria).toBe("red");
    expect(esTransitorio(error)).toBe(true);
  });

  it("con un cuerpo JSON y sin metodo explicito, infiere POST", async () => {
    const { fn, llamadas } = fetchFalso({ estado: 200, cuerpo: {} });
    await pedirAMercadoPago({ ruta: "/v1/preferences", cuerpoJson: { items: [] }, fetch: fn });
    expect(llamadas[0]!.init?.method).toBe("POST");
    const headers = new Headers(llamadas[0]!.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("sin cuerpo y sin metodo explicito, infiere GET", async () => {
    const { fn, llamadas } = fetchFalso({ estado: 200, cuerpo: {} });
    await pedirAMercadoPago({ ruta: "/v1/payments/1", fetch: fn });
    expect(llamadas[0]!.init?.method).toBe("GET");
  });

  it("sin fetch inyectado, usa el fetch global", async () => {
    const original = globalThis.fetch;
    let llamado = false;
    globalThis.fetch = (async () => {
      llamado = true;
      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await pedirAMercadoPago<{ id: number }>({ ruta: "/v1/payments/1" });
      expect(llamado).toBe(true);
      expect(r).toEqual({ id: 1 });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("una respuesta de error cuyo .text() revienta no hace caer al pedido", async () => {
    const fn = (async () =>
      ({ ok: false, status: 400, text: () => Promise.reject(new Error("stream cortado")) }) as unknown as Response
    ) as typeof fetch;
    const error = await pedirAMercadoPago({ ruta: "/x", fetch: fn }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
    expect((error as ErrorMP).detalle).toBe("");
  });

  it("si el fetch explota, es de red y transitorio", async () => {
    const fn = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const error = await pedirAMercadoPago({ ruta: "/x", fetch: fn }).catch((e) => e);
    expect((error as ErrorMP).categoria).toBe("red");
    expect(esTransitorio(error)).toBe(true);
  });
});
