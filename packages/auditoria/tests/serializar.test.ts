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
});
