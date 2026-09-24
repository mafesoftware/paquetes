import { describe, expect, it } from "vitest";
import { loQueCambio, normalizarParaDiff, PROFUNDIDAD_MAXIMA, redactar, redactarCambios, serializarParaAuditoria } from "../src/index.js";

/**
 * Tarea P.10b, ronda de fix 3.
 * P1: un tope EXPLÍCITO de profundidad (`PROFUNDIDAD_MAXIMA`), así las
 * funciones públicas "nunca tiran" también con datos muy anidados (antes
 * reventaban el stack de Node alrededor de 1650–2600 niveles).
 * P5: un Proxy revocado / con ownKeys roto / con un getter roto, el MISMO de
 * los dos lados, no hace tirar a nadie.
 */
const NIVELES = 5000;

function objetoHondo(secreto: string): Record<string, unknown> {
  let v: Record<string, unknown> = { nota: secreto };
  for (let i = 0; i < NIVELES; i++) v = { n: v };
  return v;
}

function arregloHondo(secreto: string): unknown {
  let v: unknown = [secreto];
  for (let i = 0; i < NIVELES; i++) v = [v];
  return v;
}

function mapHondo(secreto: string): unknown {
  let v: unknown = new Map([["nota", secreto]]);
  for (let i = 0; i < NIVELES; i++) v = new Map([["n", v]]);
  return v;
}

/** Recorre SIN recursión (el resultado puede tener 500 niveles) y junta todo en un texto. */
function texto(v: unknown): string {
  return JSON.stringify(v) ?? "";
}

describe("P1 — PROFUNDIDAD_MAXIMA", () => {
  it("se exporta y vale 500", () => {
    expect(PROFUNDIDAD_MAXIMA).toBe(500);
  });

  for (const [nombre, armar] of [["objeto", objetoHondo], ["arreglo", arregloHondo], ["Map", mapHondo]] as const) {
    for (const [fn, f] of [["redactar", (v: unknown) => redactar(v)], ["serializarParaAuditoria", serializarParaAuditoria], ["normalizarParaDiff", normalizarParaDiff]] as const) {
      it(`${fn} con un ${nombre} de ${NIVELES} niveles: no tira, deja [profundidad], no filtra el secreto de abajo`, () => {
        let r: unknown;
        expect(() => {
          r = f(armar("SECRETO-HONDO"));
        }).not.toThrow();
        const t = texto(r);
        expect(t).toContain("[profundidad]");
        expect(t).not.toContain("SECRETO-HONDO");
      });
    }
  }

  it("el corte es exacto: un nodo en la profundidad 500 se conserva; el contenedor en la 501 queda [profundidad]", () => {
    const armar = (niveles: number) => {
      let v: unknown = { hoja: 1 };
      for (let i = 0; i < niveles; i++) v = { n: v };
      return v;
    };
    // { hoja: 1 } a profundidad 499 → su "hoja" (primitivo) a profundidad 500: se ve.
    expect(texto(normalizarParaDiff(armar(PROFUNDIDAD_MAXIMA - 1)))).toContain('"hoja":1');
    // { hoja: 1 } a profundidad 500: se recorre, "hoja" (501) es primitivo y se ve.
    expect(texto(normalizarParaDiff(armar(PROFUNDIDAD_MAXIMA)))).toContain('"hoja":1');
    // { hoja: 1 } a profundidad 501: el contenedor queda [profundidad].
    const cortado = texto(normalizarParaDiff(armar(PROFUNDIDAD_MAXIMA + 1)));
    expect(cortado).not.toContain("hoja");
    expect(cortado).toContain('"n":"[profundidad]"');
  });

  it("redactar, serializarParaAuditoria y normalizarParaDiff cortan en el MISMO lugar", () => {
    const v = objetoHondo("x");
    const a = texto(redactar(v));
    expect(texto(serializarParaAuditoria(v))).toBe(a);
    expect(texto(normalizarParaDiff(v))).toBe(a);
  });

  it("loQueCambio con 5000 niveles contra {} : no tira, reporta [profundidad], no filtra el secreto", () => {
    let r: unknown;
    expect(() => {
      r = loQueCambio(objetoHondo("LQC-SECRETO"), {});
    }).not.toThrow();
    expect(texto(r)).toContain("[profundidad]");
    expect(texto(r)).not.toContain("LQC-SECRETO");
  });

  it("loQueCambio con dos objetos de 5000 niveles distintos SOLO abajo del corte: sin cambio (los dos quedan cortados)", () => {
    const r = loQueCambio(objetoHondo("LQC-A"), objetoHondo("LQC-B"));
    expect(r).toEqual([]);
  });

  it("loQueCambio con una hoja arreglo de 5000 niveles: el valor devuelto va cortado, sin el secreto", () => {
    let r: unknown;
    expect(() => {
      r = loQueCambio({ l: arregloHondo("LQC-ARR") }, { l: 1 });
    }).not.toThrow();
    expect(texto(r)).toContain("[profundidad]");
    expect(texto(r)).not.toContain("LQC-ARR");
    // Dos arreglos hondos distintos solo abajo del corte: iguales hasta donde se mira.
    expect(loQueCambio({ l: arregloHondo("A") }, { l: arregloHondo("B") })).toEqual([]);
  });

  it("redactarCambios con hojas de 5000 niveles: no tira, deja [profundidad], no filtra", () => {
    let r: unknown;
    expect(() => {
      r = redactarCambios([{ campo: "x", antes: objetoHondo("RC-A"), despues: arregloHondo("RC-B") }]);
    }).not.toThrow();
    expect(texto(r)).toContain("[profundidad]");
    expect(texto(r)).not.toContain("RC-");
  });

  it("un toJSON que devuelve otro objeto con toJSON, sin fin: queda cortado en vez de reventar", () => {
    const infinito = (): { toJSON: () => unknown } => ({ toJSON: () => infinito() });
    for (const f of [(v: unknown) => redactar(v), serializarParaAuditoria, normalizarParaDiff]) {
      expect(texto(f({ x: infinito() }))).toContain("[profundidad]");
    }
  });
});

describe("P2 — la raíz verdadera se marca aparte, no por el texto de campo", () => {
  it('loQueCambio marca la raíz; una clave real "(raiz)" no lleva la marca', async () => {
    const { esCambioDeRaiz } = await import("../src/lo-que-cambio.js");
    const [raiz] = loQueCambio(null, [1]);
    const [clave] = loQueCambio({ "(raiz)": 1 }, { "(raiz)": 2 });
    expect(raiz!.campo).toBe("(raiz)");
    expect(clave!.campo).toBe("(raiz)");
    expect(esCambioDeRaiz(raiz!)).toBe(true);
    expect(esCambioDeRaiz(clave!)).toBe(false);
    // La marca no es enumerable: no cambia la forma visible ni lo que se serializa.
    expect(Object.keys(raiz!)).toEqual(["campo", "antes", "despues"]);
  });

  it('redactarCambios: ["(raiz)"] tapa la clave real, y un cambio de raíz no suma el segmento', () => {
    expect(redactarCambios(loQueCambio({ "(raiz)": "A" }, { "(raiz)": "B" }), ["(raiz)"])).toEqual([{ campo: "(raiz)", antes: "[redactado]", despues: "[redactado]" }]);
    expect(redactarCambios(loQueCambio(1, 2), ["(raiz)"])).toEqual([{ campo: "(raiz)", antes: 1, despues: 2 }]);
  });
});

describe("P5 — el mismo dato roto de los dos lados no hace tirar", () => {
  const { proxy: revocado, revoke } = Proxy.revocable({}, {});
  revoke();
  const ownKeysRoto = new Proxy({}, { ownKeys: () => { throw new Error("OK"); } });
  const getterRoto = { get x(): never { throw new Error("G"); } };
  const casos: [string, unknown][] = [["revocado", revocado], ["ownKeys", ownKeysRoto], ["getter", getterRoto]];

  for (const [nombre, roto] of casos) {
    it(`${nombre}: loQueCambio(x, x) es [] y el caso anidado no tira`, () => {
      expect(loQueCambio(roto, roto)).toEqual([]);
      expect(() => loQueCambio({ k: roto, a: [roto] }, { k: roto, a: [roto, 1] })).not.toThrow();
      expect(loQueCambio({ k: roto, a: [roto] }, { k: roto, a: [roto, 1] }).map((c) => c.campo)).toEqual(["a"]);
    });

    it(`${nombre}: redactar/serializar/normalizar y la salida de loQueCambio redactada no tiran`, () => {
      for (const f of [(v: unknown) => redactar(v), serializarParaAuditoria, normalizarParaDiff]) {
        expect(() => JSON.stringify(f({ a: [roto], b: roto }))).not.toThrow();
      }
      const cambios = redactarCambios(loQueCambio({ a: [roto] }, { a: [roto, 1] }));
      expect(() => JSON.stringify(serializarParaAuditoria(cambios))).not.toThrow();
    });
  }

  it('un Proxy revocado queda "[error]" (antes Array.isArray tiraba en redactar/serializar/normalizar)', () => {
    expect(redactar({ b: revocado })).toEqual({ b: "[error]" });
    expect(serializarParaAuditoria({ b: revocado })).toEqual({ b: "[error]" });
    expect(normalizarParaDiff({ b: revocado })).toEqual({ b: "[error]" });
  });
});

describe("P1 — la copia cortada de una hoja de loQueCambio", () => {
  it("corta solo lo hondo y deja el resto: primitivos, ciclos, instancias, Proxys rotos y objetos adentro de arreglos", () => {
    const ciclo: unknown[] = [];
    ciclo.push(ciclo);
    const { proxy: revocado, revoke } = Proxy.revocable({}, {});
    revoke();
    const ownKeysRoto = new Proxy({}, { ownKeys: () => { throw new Error("OK"); } });
    const mapa = new Map([["a", 1]]);
    const fecha = new Date(0);
    const hoja = [1, "texto", ciclo, mapa, fecha, revocado, ownKeysRoto, { x: objetoHondo("COPIA-OBJ") }, arregloHondo("COPIA-ARR")];
    const [cambio] = loQueCambio({ l: hoja }, { l: 1 });
    const antes = cambio!.antes as unknown[];
    expect(antes).not.toBe(hoja); // se copió porque algo pasa el tope
    expect(antes[0]).toBe(1);
    expect(antes[1]).toBe("texto");
    expect(antes[2]).toEqual(["[ciclo]"]);
    expect(antes[3]).toBe(mapa); // una instancia es una hoja: va tal cual
    expect(antes[4]).toBe(fecha);
    expect(antes[5]).toBe(revocado);
    expect(antes[6]).toBe(ownKeysRoto);
    const t = JSON.stringify([antes[0], antes[1], antes[2], antes[7], antes[8]]);
    expect(t).toContain("[profundidad]");
    expect(t).not.toContain("COPIA-");
  });

  it("una hoja que no pasa el tope se devuelve TAL CUAL (misma referencia)", () => {
    const hoja = [{ a: 1 }, [2]];
    const [cambio] = loQueCambio({ l: hoja }, { l: 1 });
    expect(cambio!.antes).toBe(hoja);
  });

  it("en el nivel 501 un primitivo se compara por valor y un contenedor como [profundidad]; más abajo no se mira", () => {
    const armar = (niveles: number, hoja: unknown) => {
      let v: unknown = hoja;
      for (let i = 0; i < niveles; i++) v = { n: v };
      return v;
    };
    const tope = PROFUNDIDAD_MAXIMA + 1;
    expect(loQueCambio(armar(tope, 1), armar(tope, 2))).toMatchObject([{ antes: 1, despues: 2 }]);
    expect(loQueCambio(armar(tope, 1), armar(tope, { b: 1 }))).toMatchObject([{ antes: 1, despues: "[profundidad]" }]);
    expect(loQueCambio(armar(tope, { a: 1 }), armar(tope, { b: 2 }))).toEqual([]);
    expect(loQueCambio(armar(tope + 5, 1), armar(tope + 5, 2))).toEqual([]);
  });
});
