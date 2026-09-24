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

  it("Date se copia por valor, no se recorre como objeto plano", () => {
    const fecha = new Date("2026-01-01T00:00:00.000Z");
    const copia = redactar({ vence: fecha }) as { vence: Date };
    expect(copia.vence).toEqual(fecha);
    expect(copia.vence).not.toBe(fecha);
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

  it("I3: un Map se convierte a un objeto de entradas (clave String(clave)) y se redacta igual", () => {
    const m = new Map<string, unknown>([
      ["usuario", "ana"],
      ["contrasena", "hunter2"],
    ]);
    expect(redactar(m)).toEqual({ usuario: "ana", contrasena: "[redactado]" });
  });

  it("I3: un Map con clave sensible en profundidad (Map de Map)", () => {
    const interno = new Map<string, unknown>([["password", "hunter2"]]);
    const externo = new Map<string, unknown>([["credenciales", interno]]);
    expect(redactar(externo)).toEqual({ credenciales: { password: "[redactado]" } });
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
    const r = resultado as Record<string, unknown>;
    expect(r.self).toBe("[ciclo]");
    expect(r.contrasena).toBe("[redactado]");
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
});
