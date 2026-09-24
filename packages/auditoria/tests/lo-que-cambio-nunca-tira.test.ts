import { describe, expect, it } from "vitest";
import { loQueCambio } from "../src/lo-que-cambio.js";

/**
 * Ronda 5 — M3: `loQueCambio` es pública y puede recibir cualquier cosa
 * directo (sin pasar por `normalizarParaDiff`). Nunca tiene que tirar: un
 * nodo que no se puede inspeccionar (un `Proxy` con trampas rotas, un
 * `Proxy` revocado, un `ownKeys` que tira, un getter que tira) queda
 * `"[error]"` en vez de propagar.
 */
const trampa = (): never => {
  throw new Error("trampa rota a propósito");
};

function revocado(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

describe("M3 (ronda 5) — loQueCambio nunca tira", () => {
  it("un getter que tira: ese campo queda \"[error]\"", () => {
    const roto = {
      get a(): number {
        return trampa();
      },
    };
    let r: unknown;
    expect(() => {
      r = loQueCambio(roto, { a: 1 });
    }).not.toThrow();
    expect(r).toEqual([{ campo: "a", antes: "[error]", despues: 1 }]);
  });

  it("un getter que tira ANIDADO: queda \"[error]\" en su ruta", () => {
    const roto = {
      d: {
        get b(): number {
          return trampa();
        },
      },
    };
    expect(loQueCambio({ d: { b: 2 } }, roto)).toEqual([{ campo: "d.b", antes: 2, despues: "[error]" }]);
  });

  it("un ownKeys que tira: el nodo entero queda \"[error]\"", () => {
    const proxy = new Proxy({ a: 1 }, { ownKeys: trampa });
    expect(() => loQueCambio({ x: proxy }, { x: { a: 1 } })).not.toThrow();
    expect(loQueCambio({ x: proxy }, { x: { a: 1 } })).toEqual([{ campo: "x", antes: "[error]", despues: { a: 1 } }]);
    expect(loQueCambio(proxy, { a: 1 })).toEqual([{ campo: "(raiz)", antes: "[error]", despues: { a: 1 } }]);
  });

  it("un Proxy con getPrototypeOf roto (instanceof tira) en la raíz y como hoja: \"[error]\"", () => {
    const proxy = new Proxy({}, { getPrototypeOf: trampa });
    expect(() => loQueCambio(proxy, 1)).not.toThrow();
    expect(loQueCambio(proxy, 1)).toEqual([{ campo: "(raiz)", antes: "[error]", despues: 1 }]);
    expect(loQueCambio({ x: 1 }, { x: proxy })).toEqual([{ campo: "x", antes: 1, despues: "[error]" }]);
  });

  it("un Proxy revocado (Array.isArray tira) en cualquier posición: \"[error]\"", () => {
    expect(() => loQueCambio(revocado(), { a: 1 })).not.toThrow();
    expect(loQueCambio(revocado(), { a: 1 })).toEqual([{ campo: "(raiz)", antes: "[error]", despues: { a: 1 } }]);
    expect(loQueCambio({ x: revocado() }, { x: 1 })).toEqual([{ campo: "x", antes: "[error]", despues: 1 }]);
    expect(loQueCambio(undefined, revocado())).toEqual([{ campo: "(raiz)", antes: undefined, despues: "[error]" }]);
  });

  it("sonIguales: arreglos con Proxies rotos adentro (instanceof, ownKeys, has, getter) no tiran; se reportan como cambio", () => {
    const conGetter = {
      get a(): number {
        return trampa();
      },
    };
    const variantes: unknown[] = [
      new Proxy({}, { getPrototypeOf: trampa }),
      new Proxy({ a: 1 }, { ownKeys: trampa }),
      new Proxy({ a: 1 }, { has: trampa }),
      conGetter,
      revocado(),
    ];
    for (const v of variantes) {
      let r: unknown;
      expect(() => {
        r = loQueCambio({ lista: [{ a: 1 }] }, { lista: [v] });
      }).not.toThrow();
      expect((r as unknown[]).length).toBe(1);
      expect((r as { campo: string }[])[0]!.campo).toBe("lista");
    }
  });

  it("los dos lados con el mismo nodo roto (distintas instancias): los dos quedan \"[error]\" y no hay cambio", () => {
    const a = new Proxy({ a: 1 }, { ownKeys: trampa });
    const b = new Proxy({ a: 1 }, { ownKeys: trampa });
    expect(loQueCambio({ x: a }, { x: b })).toEqual([]);
  });
});
