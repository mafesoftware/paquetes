import { describe, expect, it } from "vitest";
import { normalizarParaDiff } from "../src/normalizar-para-diff.js";

describe("normalizarParaDiff", () => {
  it("bigint se convierte a string con sufijo \"n\"", () => {
    expect(normalizarParaDiff(123n)).toBe("123n");
    expect(normalizarParaDiff({ saldo: 100n })).toEqual({ saldo: "100n" });
  });

  it("Date se convierte a ISO string", () => {
    const fecha = new Date("2026-01-01T00:00:00.000Z");
    expect(normalizarParaDiff(fecha)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("una Date inválida da \"[fecha-invalida]\", no tira", () => {
    expect(() => normalizarParaDiff(new Date("no es una fecha"))).not.toThrow();
    expect(normalizarParaDiff(new Date("no es una fecha"))).toBe("[fecha-invalida]");
  });

  it("RegExp se convierte a String(re)", () => {
    expect(normalizarParaDiff(/abc/gi)).toBe("/abc/gi");
  });

  it("URL se convierte a origin+pathname, sin query ni hash", () => {
    expect(normalizarParaDiff(new URL("https://api.com/x?token=SECRETO#frag"))).toBe("https://api.com/x");
  });

  it("Error se convierte a { name } únicamente", () => {
    expect(normalizarParaDiff(new Error("mensaje con datos"))).toEqual({ name: "Error" });
  });

  it("un Buffer da \"[binario N bytes]\"", () => {
    expect(normalizarParaDiff(Buffer.alloc(10))).toBe("[binario 10 bytes]");
  });

  it("un objeto con toJSON propio (instancia de clase) llama a toJSON y normaliza el resultado", () => {
    class Decimal {
      constructor(private texto: string) {}
      toJSON(): string {
        return this.texto;
      }
    }
    expect(normalizarParaDiff(new Decimal("12.50"))).toBe("12.50");
  });

  it("un objeto PLANO con toJSON propio TAMBIÉN llama a toJSON (no solo instancias de clase)", () => {
    const d = { dni: "20111111119", toJSON: () => ({ dniEnmascarado: "***1119" }) };
    expect(normalizarParaDiff(d)).toEqual({ dniEnmascarado: "***1119" });
  });

  it("un objeto cuyo toJSON tira da \"[error]\"", () => {
    const roto = { toJSON: () => { throw new Error("toJSON roto"); } };
    expect(() => normalizarParaDiff(roto)).not.toThrow();
    expect(normalizarParaDiff(roto)).toBe("[error]");
  });

  it("ronda 5: Map se convierte a un OBJETO plano con la clave como texto", () => {
    expect(normalizarParaDiff(new Map([["a", 1n], ["b", 2n]]))).toEqual({ a: "1n", b: "2n" });
  });

  it("ronda 5: claves de Map que colisionan como texto (1 y \"1\") no se pisan: la segunda lleva el sufijo \" (2)\", en orden de inserción", () => {
    const m = new Map<unknown, unknown>([[1, "numerica"], ["1", "string"], [{ toString: () => "1" }, "objeto"]]);
    expect(normalizarParaDiff(m)).toEqual({ "1": "numerica", "1 (2)": "string", "1 (3)": "objeto" });
  });

  it("ronda 5: nunca redacta tampoco adentro de un Map (una clave \"password\" queda con su valor)", () => {
    expect(normalizarParaDiff(new Map([["password", "hunter2"]]))).toEqual({ password: "hunter2" });
  });

  it("Set se convierte a un arreglo", () => {
    expect(normalizarParaDiff(new Set([1n, 2n]))).toEqual(["1n", "2n"]);
  });

  it("una instancia de clase sin toJSON se recorre por sus campos propios (queda un objeto plano)", () => {
    class Usuario {
      constructor(
        public nombre: string,
        public activo: boolean,
      ) {}
    }
    expect(normalizarParaDiff(new Usuario("Ana", true))).toEqual({ nombre: "Ana", activo: true });
  });

  it("undefined se descarta de un objeto (la clave desaparece), pasa tal cual en la raíz", () => {
    expect(normalizarParaDiff({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(normalizarParaDiff(undefined)).toBeUndefined();
  });

  it("null pasa tal cual en cualquier posición (no rompe el manejo de \"lado ausente\" de loQueCambio)", () => {
    expect(normalizarParaDiff(null)).toBeNull();
    expect(normalizarParaDiff({ a: null })).toEqual({ a: null });
  });

  it("nunca tira con una referencia circular: esa rama queda \"[ciclo]\"", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    let resultado: unknown;
    expect(() => {
      resultado = normalizarParaDiff(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).a).toBe(1);
    expect((resultado as Record<string, unknown>).self).toBe("[ciclo]");
  });

  it("nunca redacta nada (a diferencia de redactar): una clave llamada \"password\" queda con su valor real", () => {
    expect(normalizarParaDiff({ password: "hunter2" })).toEqual({ password: "hunter2" });
  });

  it("una función da \"[funcion]\"; un symbol da su toString()", () => {
    expect(normalizarParaDiff(() => 1)).toBe("[funcion]");
    const sym = Symbol("x");
    expect(normalizarParaDiff(sym)).toBe(sym.toString());
  });

  it("un arreglo cíclico (se contiene a sí mismo) no tira: esa posición queda \"[ciclo]\"", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => normalizarParaDiff(arr)).not.toThrow();
    expect(normalizarParaDiff(arr)).toEqual([1, "[ciclo]"]);
  });

  it("un elemento undefined adentro de un arreglo se convierte a null", () => {
    expect(normalizarParaDiff([1, undefined, 3])).toEqual([1, null, 3]);
  });

  it("un objeto cuyo toJSON devuelve this (cíclico patológico) no tira: queda \"[ciclo]\"", () => {
    const obj: { toJSON?: () => unknown } = {};
    obj.toJSON = () => obj;
    expect(() => normalizarParaDiff(obj)).not.toThrow();
    expect(normalizarParaDiff(obj)).toBe("[ciclo]");
  });

  it("un Map cíclico (se referencia a sí mismo como valor) no tira: esa entrada queda \"[ciclo]\"", () => {
    const m = new Map<string, unknown>();
    m.set("self", m);
    m.set("a", 1n);
    expect(() => normalizarParaDiff(m)).not.toThrow();
    expect(normalizarParaDiff(m)).toEqual({ self: "[ciclo]", a: "1n" });
  });

  it("un Set que se contiene a sí mismo no tira: esa posición queda \"[ciclo]\"", () => {
    const s = new Set<unknown>();
    s.add(s);
    s.add(1n);
    expect(() => normalizarParaDiff(s)).not.toThrow();
    expect(normalizarParaDiff(s)).toEqual(["[ciclo]", "1n"]);
  });

  it("una clave con un getter que tira no propaga la excepción, queda como \"[error]\"", () => {
    const obj = {
      a: 1,
      get roto(): string {
        throw new Error("getter roto a propósito");
      },
    };
    let resultado: unknown;
    expect(() => {
      resultado = normalizarParaDiff(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).a).toBe(1);
    expect((resultado as Record<string, unknown>).roto).toBe("[error]");
  });

  describe("M-b: nunca tira por un dato roto", () => {
    it("un Proxy cuyas trampas getPrototypeOf/get tiran no tira: el nodo entero queda \"[error]\"", () => {
      const proxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("getPrototypeOf roto a propósito");
          },
          get() {
            throw new Error("get roto a propósito");
          },
        },
      );
      let resultado: unknown;
      expect(() => {
        resultado = normalizarParaDiff({ x: proxy });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });

    it("un objeto con \"get toJSON(){throw}\" no tira: el nodo entero queda \"[error]\"", () => {
      const roto = {};
      Object.defineProperty(roto, "toJSON", {
        get() {
          throw new Error("getter de toJSON roto a propósito");
        },
        enumerable: true,
      });
      let resultado: unknown;
      expect(() => {
        resultado = normalizarParaDiff({ x: roto });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });

    it("un Error con un getter de \"name\" que tira no tira: el nodo entero queda \"[error]\"", () => {
      class ErrorRoto extends Error {
        get name(): string {
          throw new Error("getter de name roto a propósito");
        }
      }
      const errorRoto = new ErrorRoto("mensaje");
      let resultado: unknown;
      expect(() => {
        resultado = normalizarParaDiff({ x: errorRoto });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });

    it("una clave de Map sin prototipo no tira: queda \"[clave]\"", () => {
      const claveRota = Object.create(null) as object;
      const m = new Map<unknown, unknown>([[claveRota, "valor"]]);
      expect(() => normalizarParaDiff(m)).not.toThrow();
      expect(normalizarParaDiff(m)).toEqual({ "[clave]": "valor" });
    });

    it("un Proxy cuya trampa ownKeys tira no tira: el objeto entero queda \"[error]\"", () => {
      const proxy = new Proxy(
        { a: 1 },
        {
          ownKeys() {
            throw new Error("ownKeys roto a propósito");
          },
        },
      );
      let resultado: unknown;
      expect(() => {
        resultado = normalizarParaDiff({ x: proxy });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });
  });
});
