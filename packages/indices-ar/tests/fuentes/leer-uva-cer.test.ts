import { describe, expect, it, vi } from "vitest";
import { leerUvaCer } from "../../src/fuentes/leer-uva-cer.js";
import type { Fetch } from "../../src/fuentes/tipos.js";

/** Una respuesta `Response`-like mínima, tal como la necesita `leerUvaCer`. */
function respuesta(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** Fixture: la forma real de `.../estadisticas/v4.0/monetarias/{id}` (BCRA), grabada de la API real. */
function fixtureBcra(idVariable: number, detalle: { fecha: string; valor: number }[]) {
  return { status: 200, metadata: { resultset: { count: detalle.length, offset: 0, limit: 1000 } }, results: [{ idVariable, detalle }] };
}

/** Fixture de UNA página de una serie paginada: `count` es el total de toda la serie, no el de esta página. */
function fixtureBcraPagina(
  idVariable: number,
  detalle: { fecha: string; valor: number }[],
  paginacion: { count: number; offset: number; limit: number },
) {
  return { status: 200, metadata: { resultset: paginacion }, results: [{ idVariable, detalle }] };
}

describe("leerUvaCer", () => {
  it("combina UVA (id 31) y CER (id 30), en ese orden, con fetch mockeado", async () => {
    const fetchMock = vi.fn<Fetch>();
    fetchMock
      .mockResolvedValueOnce(respuesta(fixtureBcra(31, [{ fecha: "2026-09-10", valor: 2113.2 }])))
      .mockResolvedValueOnce(respuesta(fixtureBcra(30, [{ fecha: "2026-09-10", valor: 785.44 }])));

    const r = await leerUvaCer({ fetch: fetchMock });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no debería fallar");
    expect(r.valores).toEqual([
      { indice: "UVA", fecha: "2026-09-10", valor: "2113.2" },
      { indice: "CER", fecha: "2026-09-10", valor: "785.44" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pasa desde/hasta como query params en la URL", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta(fixtureBcra(31, [])));
    await leerUvaCer({ fetch: fetchMock, desde: "2026-09-01", hasta: "2026-09-10" });

    const [urlUva] = fetchMock.mock.calls[0]!;
    expect(String(urlUva)).toContain("/monetarias/31?desde=2026-09-01&hasta=2026-09-10");
  });

  it("sin desde/hasta: URL sin query string", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta(fixtureBcra(31, [])));
    await leerUvaCer({ fetch: fetchMock });
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/31");
  });

  it("fetch que tira (red cortada): categoria red", async () => {
    const fetchMock = vi.fn<Fetch>().mockRejectedValue(new Error("network down"));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "red" });
  });

  it("status HTTP no-ok: categoria http", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({}, false, 500));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "http" });
  });

  it("cuerpo que no es JSON válido (json() tira): categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("cuerpo null: categoria formato", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta(null));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('"results[0]" no es un objeto (ej. null): categoria formato', async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ results: [null] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('"detalle" ausente o que no es un array: categoria formato', async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ results: [{ idVariable: 31 }] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('un elemento de "detalle" que no es un objeto (ej. null): categoria formato', async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ results: [{ idVariable: 31, detalle: [null] }] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('cuerpo sin "results": categoria formato', async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ status: 410, errorMessages: ["deprecado"] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('"results" vacío: categoria formato', async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ results: [] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it('"detalle" con un valor no numérico: categoria formato', async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValue(respuesta({ results: [{ idVariable: 31, detalle: [{ fecha: "2026-09-10", valor: "no-numero" }] }] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("valor <= 0: categoria formato (un índice nunca es 0 ni negativo)", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValue(respuesta({ results: [{ idVariable: 31, detalle: [{ fecha: "2026-09-10", valor: 0 }] }] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "formato" });
  });

  it("falla en la segunda llamada (CER) después de que la primera (UVA) salió bien: propaga esa falla, no llama una tercera vez", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(respuesta(fixtureBcra(31, [{ fecha: "2026-09-10", valor: 2113.2 }])))
      .mockResolvedValueOnce(respuesta({}, false, 500));

    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "http" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serie paginada (metadata.resultset): sigue las páginas y devuelve la serie completa combinada", async () => {
    const fetchMock = vi.fn<Fetch>();
    fetchMock
      // UVA, 2 páginas de 2 filas cada una (count=4).
      .mockResolvedValueOnce(
        respuesta(
          fixtureBcraPagina(
            31,
            [
              { fecha: "2026-09-01", valor: 2100 },
              { fecha: "2026-09-02", valor: 2101 },
            ],
            { count: 4, offset: 0, limit: 2 },
          ),
        ),
      )
      .mockResolvedValueOnce(
        respuesta(
          fixtureBcraPagina(
            31,
            [
              { fecha: "2026-09-03", valor: 2102 },
              { fecha: "2026-09-04", valor: 2103 },
            ],
            { count: 4, offset: 2, limit: 2 },
          ),
        ),
      )
      // CER, 1 sola página.
      .mockResolvedValueOnce(respuesta(fixtureBcra(30, [{ fecha: "2026-09-01", valor: 785 }])));

    const r = await leerUvaCer({ fetch: fetchMock });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no debería fallar");
    expect(r.valores).toEqual([
      { indice: "UVA", fecha: "2026-09-01", valor: "2100" },
      { indice: "UVA", fecha: "2026-09-02", valor: "2101" },
      { indice: "UVA", fecha: "2026-09-03", valor: "2102" },
      { indice: "UVA", fecha: "2026-09-04", valor: "2103" },
      { indice: "CER", fecha: "2026-09-01", valor: "785" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // La segunda página se pide con offset = offset anterior + limit.
    expect(String(fetchMock.mock.calls[1]![0])).toContain("offset=2");
    // La primera página no lleva "offset" (offset 0 se omite, igual que antes).
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("offset");
  });

  it("resultset sin más páginas (offset + limit >= count): no pide una página de más", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        respuesta(
          fixtureBcraPagina(31, [{ fecha: "2026-09-10", valor: 2113.2 }], { count: 1, offset: 0, limit: 1000 }),
        ),
      )
      .mockResolvedValueOnce(respuesta(fixtureBcra(30, [{ fecha: "2026-09-10", valor: 785.44 }])));

    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // una página por índice, no más.
  });

  it("cuerpo sin metadata.resultset (forma vieja de la API): toma la única página como serie completa, sin pedir otra", async () => {
    const fetchMock = vi.fn<Fetch>().mockResolvedValue(respuesta({ results: [{ idVariable: 31, detalle: [{ fecha: "2026-09-10", valor: 2113.2 }] }] }));
    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("no debería fallar");
    expect(r.valores.filter((v) => v.indice === "UVA")).toHaveLength(1);
  });

  it("falla en la segunda página (la primera salió bien): propaga esa falla", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        respuesta(
          fixtureBcraPagina(31, [{ fecha: "2026-09-01", valor: 2100 }], { count: 2, offset: 0, limit: 1 }),
        ),
      )
      .mockResolvedValueOnce(respuesta({}, false, 500));

    const r = await leerUvaCer({ fetch: fetchMock });
    expect(r).toEqual({ ok: false, categoria: "http" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
