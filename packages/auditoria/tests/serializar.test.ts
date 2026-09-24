import { describe, expect, it } from "vitest";
import { serializarParaAuditoria } from "../src/serializar.js";

describe("serializarParaAuditoria", () => {
  it("bigint se convierte a string con sufijo \"n\"", () => {
    expect(serializarParaAuditoria(123n)).toBe("123n");
    expect(serializarParaAuditoria({ saldo: 100n })).toEqual({ saldo: "100n" });
  });

  it("Date se convierte a ISO string", () => {
    const fecha = new Date("2026-01-01T00:00:00.000Z");
    expect(serializarParaAuditoria(fecha)).toBe("2026-01-01T00:00:00.000Z");
    expect(serializarParaAuditoria({ vence: fecha })).toEqual({ vence: "2026-01-01T00:00:00.000Z" });
  });

  it("una Date inválida no tira: se serializa a un marcador", () => {
    expect(() => serializarParaAuditoria(new Date("no es una fecha"))).not.toThrow();
    expect(serializarParaAuditoria(new Date("no es una fecha"))).toBe("[fecha-invalida]");
  });

  it("undefined se descarta de un objeto (la clave desaparece)", () => {
    expect(serializarParaAuditoria({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("undefined en un arreglo se convierte a null (no se saca el índice)", () => {
    expect(serializarParaAuditoria([1n, undefined, 3n])).toEqual(["1n", null, "3n"]);
  });

  it("undefined top-level se devuelve tal cual (no hay contenedor del que sacarlo)", () => {
    expect(serializarParaAuditoria(undefined)).toBeUndefined();
  });

  it("recorre objetos y arreglos anidados aplicando las mismas reglas", () => {
    expect(
      serializarParaAuditoria({
        items: [{ id: 1n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined }],
      }),
    ).toEqual({ items: [{ id: "1n", vence: "2026-01-01T00:00:00.000Z" }] });
  });

  it("valores ya JSON-safe pasan sin cambios", () => {
    expect(serializarParaAuditoria({ a: 1, b: "x", c: true, d: null })).toEqual({ a: 1, b: "x", c: true, d: null });
  });

  it("un objeto sin prototipo (Object.create(null)) se serializa igual que uno plano normal", () => {
    const obj = Object.create(null) as Record<string, unknown>;
    obj.saldo = 100n;
    expect(serializarParaAuditoria(obj)).toEqual({ saldo: "100n" });
  });

  it("nunca tira con una referencia circular", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    let resultado: unknown;
    expect(() => {
      resultado = serializarParaAuditoria(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).a).toBe(1);
    expect((resultado as Record<string, unknown>).self).toBe("[ciclo]");
  });

  it("una referencia circular en un arreglo tampoco tira", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => serializarParaAuditoria(arr)).not.toThrow();
    expect(serializarParaAuditoria(arr)).toEqual([1, "[ciclo]"]);
  });

  it("funciones y symbols no tiran: se convierten a string en vez de dejarse tal cual", () => {
    const conFuncion = serializarParaAuditoria({ f: () => 1 }) as Record<string, unknown>;
    expect(conFuncion.f).toBe("[funcion]");

    const sym = Symbol("x");
    expect(serializarParaAuditoria(sym)).toBe(sym.toString());
  });

  it("I3: una instancia de clase propia se serializa por sus campos de instancia (bigint incluido)", () => {
    class Factura {
      total: bigint;
      constructor(total: bigint) {
        this.total = total;
      }
    }
    expect(serializarParaAuditoria(new Factura(1000n))).toEqual({ total: "1000n" });
  });

  it("N4/I3: un Map se convierte a un ARREGLO de pares [clave, valor] (no un objeto), con bigint/Date serializados", () => {
    const m = new Map<string, unknown>([
      ["total", 1000n],
      ["vence", new Date("2026-01-01T00:00:00.000Z")],
    ]);
    expect(serializarParaAuditoria(m)).toEqual([
      ["total", "1000n"],
      ["vence", "2026-01-01T00:00:00.000Z"],
    ]);
  });

  it("N4: dos claves de Map que colisionarían como propiedad de objeto (1 número y \"1\" string) NO se pisan en el arreglo de pares", () => {
    const m = new Map<unknown, unknown>([
      [1, "numerica"],
      ["1", "string"],
    ]);
    expect(serializarParaAuditoria(m)).toEqual([
      ["1", "numerica"],
      ["1", "string"],
    ]);
  });

  it("I3: un Set se convierte a un arreglo, con bigint serializado", () => {
    const s = new Set<unknown>([1n, 2n]);
    expect(serializarParaAuditoria(s)).toEqual(["1n", "2n"]);
  });

  it("I3: un Map cíclico (se referencia a sí mismo como valor) no tira, esa rama queda \"[ciclo]\"", () => {
    const m = new Map<string, unknown>();
    m.set("self", m);
    m.set("total", 1000n);
    let resultado: unknown;
    expect(() => {
      resultado = serializarParaAuditoria(m);
    }).not.toThrow();
    expect(resultado).toEqual([
      ["self", "[ciclo]"],
      ["total", "1000n"],
    ]);
  });

  it("I3: un Map con un valor que serializa a undefined descarta ese PAR (igual que una clave de objeto)", () => {
    const m = new Map<string, unknown>([
      ["a", 1],
      ["b", undefined],
    ]);
    expect(serializarParaAuditoria(m)).toEqual([["a", 1]]);
  });

  it("I3: un Set que se contiene a sí mismo no tira, esa rama queda \"[ciclo]\"", () => {
    const s = new Set<unknown>();
    s.add(s);
    s.add(1n);
    let resultado: unknown;
    expect(() => {
      resultado = serializarParaAuditoria(s);
    }).not.toThrow();
    expect(resultado).toEqual(["[ciclo]", "1n"]);
  });

  it("I3: un Set con un elemento undefined lo convierte a null (igual que un arreglo)", () => {
    const s = new Set<unknown>([undefined, 1n]);
    expect(serializarParaAuditoria(s)).toEqual([null, "1n"]);
  });

  it("M10: una clave con un getter que tira no propaga la excepción, queda como \"[error]\"", () => {
    const obj = {
      a: 1,
      get roto(): string {
        throw new Error("getter roto a propósito");
      },
    };
    let resultado: unknown;
    expect(() => {
      resultado = serializarParaAuditoria(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).a).toBe(1);
    expect((resultado as Record<string, unknown>).roto).toBe("[error]");
  });

  describe("N2: tipos especiales", () => {
    it("un decimal.js-like (clase con toJSON) se llama y su resultado se serializa", () => {
      class Decimal {
        constructor(private valor: string) {}
        toJSON(): string {
          return this.valor;
        }
      }
      expect(serializarParaAuditoria({ precio: new Decimal("12.50") })).toEqual({ precio: "12.50" });
    });

    it("un objeto cuyo toJSON tira da \"[error]\", no propaga la excepción", () => {
      const roto = { toJSON: () => { throw new Error("toJSON roto"); } };
      expect(() => serializarParaAuditoria(roto)).not.toThrow();
      expect(serializarParaAuditoria(roto)).toBe("[error]");
    });

    it("un objeto cuyo toJSON devuelve this (cíclico patológico) no tira: queda \"[ciclo]\"", () => {
      const obj: { toJSON?: () => unknown } = {};
      obj.toJSON = () => obj;
      expect(() => serializarParaAuditoria(obj)).not.toThrow();
      expect(serializarParaAuditoria(obj)).toBe("[ciclo]");
    });

    it("una URL: solo origin+pathname, sin query ni hash (pueden traer secretos)", () => {
      const url = new URL("https://api.com/perfil?token=SECRETO123#fragmento");
      expect(serializarParaAuditoria(url)).toBe("https://api.com/perfil");
      expect(JSON.stringify(serializarParaAuditoria(url))).not.toContain("SECRETO123");
    });

    it("un Error: solo { name }, nunca .message", () => {
      const error = new Error("contiene secreto123");
      const resultado = serializarParaAuditoria(error);
      expect(resultado).toEqual({ name: "Error" });
      expect(JSON.stringify(resultado)).not.toContain("secreto123");
    });

    it("un Buffer de 1 MB da \"[binario 1048576 bytes]\"", () => {
      const buffer = Buffer.alloc(1024 * 1024, 1);
      expect(serializarParaAuditoria(buffer)).toBe("[binario 1048576 bytes]");
    });

    it("un RegExp se convierte a su representación con barras", () => {
      expect(serializarParaAuditoria(/abc/gi)).toBe("/abc/gi");
    });
  });

  describe("N3: nunca tira por una clave/objeto roto", () => {
    it("una clave de Map sin prototipo no tira: queda \"[clave]\"", () => {
      const claveRota = Object.create(null) as object;
      const m = new Map<unknown, unknown>([[claveRota, "valor"]]);
      expect(() => serializarParaAuditoria(m)).not.toThrow();
      expect(serializarParaAuditoria(m)).toEqual([["[clave]", "valor"]]);
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
        resultado = serializarParaAuditoria({ x: proxy });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });
  });
});
