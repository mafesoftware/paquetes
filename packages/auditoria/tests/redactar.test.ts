import { describe, expect, it } from "vitest";
import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "../src/redactar.js";

describe("redactar", () => {
  it("tapa una clave sensible de primer nivel", () => {
    expect(redactar({ usuario: "ana", contrasena: "hunter2" })).toEqual({
      usuario: "ana",
      contrasena: "[redactado]",
    });
  });

  it("tapa cbu/cvu (datos bancarios argentinos)", () => {
    expect(redactar({ cbu: "0000003100010000000001", alias: "mi.alias" })).toEqual({
      cbu: "[redactado]",
      alias: "mi.alias",
    });
    expect(redactar({ cvu: "0000007900010000000001" })).toEqual({ cvu: "[redactado]" });
  });

  it("tapa a cualquier profundidad", () => {
    expect(redactar({ pago: { datos: { cbu: "123", monto: 100 } } })).toEqual({
      pago: { datos: { cbu: "[redactado]", monto: 100 } },
    });
  });

  it("tapa adentro de un arreglo", () => {
    expect(redactar({ usuarios: [{ nombre: "A", password: "x" }, { nombre: "B", password: "y" }] })).toEqual({
      usuarios: [
        { nombre: "A", password: "[redactado]" },
        { nombre: "B", password: "[redactado]" },
      ],
    });
  });

  it("no distingue mayúsculas ni _/- : \"API-Key\" y \"apiKey\" matchean el mismo nombre normalizado", () => {
    expect(redactar({ "API-Key": "abc", apiKey: "def", api_key: "ghi" })).toEqual({
      "API-Key": "[redactado]",
      apiKey: "[redactado]",
      api_key: "[redactado]",
    });
  });

  it("regla de matching: IGUAL o TERMINA CON un término (no \"contiene\") — los 5 ejemplos que SÍ se redactan", () => {
    const obj = {
      passwordHash: "h1",
      password_hash: "h2",
      accessToken: "t1",
      refresh_token: "t2",
      clientSecret: "s1",
      "x-api-key": "k1",
    };
    expect(redactar(obj)).toEqual({
      passwordHash: "[redactado]",
      password_hash: "[redactado]",
      accessToken: "[redactado]",
      refresh_token: "[redactado]",
      clientSecret: "[redactado]",
      "x-api-key": "[redactado]",
    });
  });

  it("regla de matching: passwordHint y tokenizer NO se redactan (el término sensible es un PREFIJO, no un sufijo)", () => {
    expect(redactar({ passwordHint: "el nombre de tu mascota", tokenizer: "spacy" })).toEqual({
      passwordHint: "el nombre de tu mascota",
      tokenizer: "spacy",
    });
  });

  it("límite documentado: un secreto bajo una clave NO sensible no se detecta (matching por clave, no por valor)", () => {
    const obj = { notas: "la clave temporal es Xy9$zK" };
    expect(redactar(obj)).toEqual(obj); // "notas" no es sensible, así que no se toca aunque el VALOR "parezca" un secreto
  });

  it("una lista de campos sensibles propia reemplaza la default", () => {
    expect(redactar({ token: "t1", extra: "visible" }, ["token"])).toEqual({ token: "[redactado]", extra: "visible" });
    // "extra" no está en la lista propia, así que no se toca aunque no sea
    // parte de la lista default tampoco.
  });

  it("CAMPOS_SENSIBLES_POR_DEFECTO tiene exactamente la lista de la spec", () => {
    expect(CAMPOS_SENSIBLES_POR_DEFECTO).toEqual([
      "contrasena",
      "password",
      "hash",
      "token",
      "secreto",
      "secret",
      "cbu",
      "cvu",
      "clave",
      "api_key",
      "apikey",
      "totp",
      "authorization",
    ]);
  });

  it("es una copia profunda: no muta el objeto original ni comparte referencias anidadas", () => {
    const original = { usuario: "ana", datos: { contrasena: "hunter2" } };
    const copia = redactar(original);
    expect(original.datos.contrasena).toBe("hunter2");
    expect(copia).not.toBe(original);
    expect((copia as typeof original).datos).not.toBe(original.datos);
  });

  it("N2: Date se convierte a ISO string (no se recorre como objeto plano, y ya no se copia como Date)", () => {
    const fecha = new Date("2026-01-01T00:00:00.000Z");
    const copia = redactar({ vence: fecha }) as { vence: string };
    expect(copia.vence).toBe("2026-01-01T00:00:00.000Z");
  });

  it("N2: una Date inválida da \"[fecha-invalida]\", no tira", () => {
    expect(() => redactar(new Date("no es una fecha"))).not.toThrow();
    expect(redactar(new Date("no es una fecha"))).toBe("[fecha-invalida]");
  });

  it("valores no-objeto (incluido undefined) se devuelven tal cual", () => {
    expect(redactar("texto" as unknown as Record<string, unknown>)).toBe("texto");
    expect(redactar(undefined as unknown as Record<string, unknown>)).toBeUndefined();
    expect(redactar(42 as unknown as Record<string, unknown>)).toBe(42);
  });

  it("un objeto sin prototipo (Object.create(null)) se trata como plano: sus claves sensibles se tapan igual", () => {
    const obj = Object.create(null) as Record<string, unknown>;
    obj.contrasena = "hunter2";
    obj.usuario = "ana";
    expect(redactar(obj)).toEqual({ contrasena: "[redactado]", usuario: "ana" });
  });

  it("nunca tira con un arreglo cíclico", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    let resultado: unknown;
    expect(() => {
      resultado = redactar(arr);
    }).not.toThrow();
    expect((resultado as unknown[])[0]).toBe(1);
    expect((resultado as unknown[])[1]).toBe("[ciclo]");
  });

  it("nunca tira con una referencia circular", () => {
    const obj: Record<string, unknown> = { contrasena: "x" };
    obj.self = obj;
    let resultado: unknown;
    expect(() => {
      resultado = redactar(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).contrasena).toBe("[redactado]");
    expect((resultado as Record<string, unknown>).self).toBe("[ciclo]");
  });

  it("I3: una instancia de clase propia se recorre por sus campos de instancia (this.password incluido)", () => {
    class Usuario {
      nombre: string;
      password: string;
      constructor(nombre: string, password: string) {
        this.nombre = nombre;
        this.password = password;
      }
      // Un método del prototipo NO es una clave propia enumerable: no
      // tiene que aparecer en el resultado (Object.keys de una instancia no
      // incluye métodos del prototipo).
      saludar(): string {
        return `Hola, ${this.nombre}`;
      }
    }
    const u = new Usuario("ana", "hunter2");
    expect(redactar(u)).toEqual({ nombre: "ana", password: "[redactado]" });
  });

  it("N4/I3: un Map se convierte a un ARREGLO de pares [clave, valor] (no un objeto) y se redacta por par", () => {
    const m = new Map<string, unknown>([
      ["usuario", "ana"],
      ["contrasena", "hunter2"],
    ]);
    expect(redactar(m)).toEqual([
      ["usuario", "ana"],
      ["contrasena", "[redactado]"],
    ]);
  });

  it("N4: dos claves de Map que colisionarían como propiedad de objeto (1 número y \"1\" string) NO se pisan en el arreglo de pares", () => {
    const m = new Map<unknown, unknown>([
      [1, "numerica"],
      ["1", "string"],
    ]);
    expect(redactar(m)).toEqual([
      ["1", "numerica"],
      ["1", "string"],
    ]);
  });

  it("I3: un Map con clave sensible en profundidad (Map de Map)", () => {
    const interno = new Map<string, unknown>([["password", "hunter2"]]);
    const externo = new Map<string, unknown>([["credenciales", interno]]);
    expect(redactar(externo)).toEqual([["credenciales", [["password", "[redactado]"]]]]);
  });

  it("I3: un Set se convierte a un arreglo (sin claves, así que sus elementos no se tapan por nombre, igual que un arreglo)", () => {
    const s = new Set(["a", "b", "c"]);
    expect(redactar(s)).toEqual(["a", "b", "c"]);
  });

  it("I3: un Set de objetos con clave sensible sí tapa esas claves (cada elemento se redacta)", () => {
    const s = new Set([{ password: "hunter2" }, { password: "hunter3" }]);
    expect(redactar(s)).toEqual([{ password: "[redactado]" }, { password: "[redactado]" }]);
  });

  it("I3: un Map cíclico (se referencia a sí mismo como valor) no tira, esa rama queda como \"[ciclo]\"", () => {
    const m = new Map<string, unknown>();
    m.set("self", m);
    m.set("contrasena", "hunter2");
    let resultado: unknown;
    expect(() => {
      resultado = redactar(m);
    }).not.toThrow();
    expect(resultado).toEqual([
      ["self", "[ciclo]"],
      ["contrasena", "[redactado]"],
    ]);
  });

  it("I3: un Set que se contiene a sí mismo no tira, esa rama queda como \"[ciclo]\"", () => {
    const s = new Set<unknown>();
    s.add(s);
    s.add("x");
    let resultado: unknown;
    expect(() => {
      resultado = redactar(s);
    }).not.toThrow();
    expect(resultado).toEqual(["[ciclo]", "x"]);
  });

  it("M10 (defensivo, redactar): una clave con un getter que tira no propaga la excepción, queda como \"[error]\"", () => {
    const obj = {
      contrasena: "hunter2",
      get roto(): string {
        throw new Error("getter roto a propósito");
      },
    };
    let resultado: unknown;
    expect(() => {
      resultado = redactar(obj);
    }).not.toThrow();
    expect((resultado as Record<string, unknown>).contrasena).toBe("[redactado]");
    expect((resultado as Record<string, unknown>).roto).toBe("[error]");
  });

  describe("N2: tipos especiales", () => {
    it("un decimal.js-like (clase con toJSON) se llama y su resultado se redacta/recorre", () => {
      class Decimal {
        constructor(private valor: string) {}
        toJSON(): string {
          return this.valor;
        }
      }
      expect(redactar({ precio: new Decimal("12.50") })).toEqual({ precio: "12.50" });
    });

    it("un objeto cuyo toJSON tira da \"[error]\", no propaga la excepción", () => {
      const roto = { toJSON: () => { throw new Error("toJSON roto"); } };
      expect(() => redactar(roto)).not.toThrow();
      expect(redactar(roto)).toBe("[error]");
    });

    it("un objeto cuyo toJSON devuelve this (cíclico patológico) no tira: queda \"[ciclo]\"", () => {
      const obj: { toJSON?: () => unknown } = {};
      obj.toJSON = () => obj;
      expect(() => redactar(obj)).not.toThrow();
      expect(redactar(obj)).toBe("[ciclo]");
    });

    it("una URL: solo origin+pathname, sin query ni hash (pueden traer secretos)", () => {
      const url = new URL("https://api.com/perfil?token=SECRETO123#fragmento");
      expect(redactar(url)).toBe("https://api.com/perfil");
      const crudo = JSON.stringify(redactar(url));
      expect(crudo).not.toContain("SECRETO123");
      expect(crudo).not.toContain("fragmento");
    });

    it("una URL se resuelve ANTES que el chequeo genérico de toJSON (URL.prototype.toJSON da el href completo, con query)", () => {
      const url = new URL("https://api.com/x?token=NUNCA-DEBERIA-APARECER");
      // Si el toJSON nativo de URL ganara, esto daría el href completo con el token.
      expect(redactar(url)).toBe("https://api.com/x");
    });

    it("un Error: solo { name }, nunca .message (puede traer el valor que causó el error)", () => {
      const error = new Error("contiene secreto123");
      const resultado = redactar(error) as { name: string; message?: string };
      expect(resultado).toEqual({ name: "Error" });
      expect(JSON.stringify(resultado)).not.toContain("secreto123");
    });

    it("un Buffer de 1 MB da \"[binario 1048576 bytes]\", nunca el contenido byte a byte", () => {
      const buffer = Buffer.alloc(1024 * 1024, 1);
      expect(redactar(buffer)).toBe("[binario 1048576 bytes]");
    });

    it("un TypedArray/ArrayBuffer/DataView también dan \"[binario N bytes]\"", () => {
      expect(redactar(new Uint8Array(10))).toBe("[binario 10 bytes]");
      expect(redactar(new ArrayBuffer(16))).toBe("[binario 16 bytes]");
      expect(redactar(new DataView(new ArrayBuffer(8)))).toBe("[binario 8 bytes]");
    });

    it("un RegExp se convierte a su representación con barras", () => {
      expect(redactar(/abc/gi)).toBe("/abc/gi");
    });
  });

  describe("N3: nunca tira por una clave/objeto roto", () => {
    it("una clave de Map sin prototipo (Object.create(null), sin toString) no tira: queda \"[clave]\"", () => {
      const claveRota = Object.create(null) as object;
      const m = new Map<unknown, unknown>([[claveRota, "valor"]]);
      let resultado: unknown;
      expect(() => {
        resultado = redactar(m);
      }).not.toThrow();
      expect(resultado).toEqual([["[clave]", "valor"]]);
    });

    it("una clave de Map cuyo toString tira no tira: queda \"[clave]\"", () => {
      const claveRota = { toString: () => { throw new Error("toString roto"); } };
      const m = new Map<unknown, unknown>([[claveRota, "valor"]]);
      expect(() => redactar(m)).not.toThrow();
      expect(redactar(m)).toEqual([["[clave]", "valor"]]);
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
        resultado = redactar({ x: proxy });
      }).not.toThrow();
      expect((resultado as Record<string, unknown>).x).toBe("[error]");
    });
  });
});
