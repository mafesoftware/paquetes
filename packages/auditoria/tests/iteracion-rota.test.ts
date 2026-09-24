import { describe, expect, it } from "vitest";
import { redactar } from "../src/redactar.js";
import { serializarParaAuditoria } from "../src/serializar.js";
import { normalizarParaDiff } from "../src/normalizar-para-diff.js";

/**
 * Ronda 5 — M2: un `Map`/`Set` cuya ITERACIÓN tira (un `Proxy` sobre un
 * `Map`/`Set` — `instanceof` da `true`, pero `entries()`/`[Symbol.iterator]`
 * llamados con el Proxy como `this` tiran `TypeError: incompatible
 * receiver` —, o una subclase con `entries()`/`[Symbol.iterator]` que
 * tira) se escapaba de las tres funciones. Ahora ese nodo queda `"[error]"`.
 */
const trampa = (): never => {
  throw new Error("iteración rota a propósito");
};

class MapEntriesRoto<K, V> extends Map<K, V> {
  override entries(): MapIterator<[K, V]> {
    return trampa();
  }
}
class MapIteradorRoto<K, V> extends Map<K, V> {
  override [Symbol.iterator](): MapIterator<[K, V]> {
    return trampa();
  }
}
class SetIteradorRoto<T> extends Set<T> {
  override [Symbol.iterator](): SetIterator<T> {
    return trampa();
  }
}
class MapEntradaMalformada extends Map<unknown, unknown> {
  // Un iterador que da algo que no es un par [clave, valor].
  override *entries(): MapIterator<[unknown, unknown]> {
    yield 42 as unknown as [unknown, unknown];
  }
}

const casos: [string, () => unknown][] = [
  ["new Proxy(new Map(), {})", () => new Proxy(new Map([["password", "M2-SECRETO"]]), {})],
  ["new Proxy(new Set(), {})", () => new Proxy(new Set(["M2-SECRETO"]), {})],
  ["una subclase de Map con entries() que tira", () => new MapEntriesRoto([["password", "M2-SECRETO"]])],
  ["una subclase de Set con [Symbol.iterator] que tira", () => new SetIteradorRoto(["M2-SECRETO"])],
  ["una subclase de Map cuyo iterador da una entrada que no es un par", () => new MapEntradaMalformada()],
];

const funciones: [string, (v: unknown) => unknown][] = [
  ["redactar", (v) => redactar(v)],
  ["serializarParaAuditoria", serializarParaAuditoria],
  ["normalizarParaDiff", normalizarParaDiff],
];

describe("M2 (ronda 5) — un Map/Set cuya iteración tira queda \"[error]\", nunca se escapa", () => {
  for (const [nombreFuncion, fn] of funciones) {
    for (const [nombreCaso, crear] of casos) {
      it(`${nombreFuncion}: ${nombreCaso}`, () => {
        let resultado: unknown;
        expect(() => {
          resultado = fn({ x: crear() });
        }).not.toThrow();
        expect(resultado).toEqual({ x: "[error]" });
        expect(JSON.stringify(resultado)).not.toContain("M2-SECRETO");
      });
    }
  }
});

describe("M2 (ronda 5) — un Map que solo rompe [Symbol.iterator] se lee por entries(): no tira y sigue redactando", () => {
  it("redactar/serializarParaAuditoria/normalizarParaDiff no tiran; redactar tapa la clave sensible", () => {
    const m = new MapIteradorRoto([["password", "M2-SECRETO"]]);
    for (const [, fn] of funciones) expect(() => fn({ x: m })).not.toThrow();
    expect(redactar({ x: m })).toEqual({ x: { password: "[redactado]" } });
  });
});
