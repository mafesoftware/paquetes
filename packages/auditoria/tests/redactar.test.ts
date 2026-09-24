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
});
