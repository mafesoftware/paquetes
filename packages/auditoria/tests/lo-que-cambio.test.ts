import { describe, expect, it } from "vitest";
import { loQueCambio } from "../src/lo-que-cambio.js";

describe("loQueCambio", () => {
  it("sin diferencias: []", () => {
    expect(loQueCambio({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("antes y despues ausentes (undefined): []", () => {
    expect(loQueCambio(undefined, undefined)).toEqual([]);
  });

  it("un campo simple que cambió", () => {
    expect(loQueCambio({ nombre: "Ana" }, { nombre: "Beto" })).toEqual([
      { campo: "nombre", antes: "Ana", despues: "Beto" },
    ]);
  });

  it("objetos anidados: la ruta usa puntos", () => {
    const antes = { direccion: { calle: "Corrientes 1", ciudad: "CABA" } };
    const despues = { direccion: { calle: "Corrientes 2", ciudad: "CABA" } };
    expect(loQueCambio(antes, despues)).toEqual([{ campo: "direccion.calle", antes: "Corrientes 1", despues: "Corrientes 2" }]);
  });

  it("anidamiento de más de un nivel", () => {
    const antes = { a: { b: { c: 1 } } };
    const despues = { a: { b: { c: 2 } } };
    expect(loQueCambio(antes, despues)).toEqual([{ campo: "a.b.c", antes: 1, despues: 2 }]);
  });

  it("salida ordenada por campo, sin importar el orden de las claves de entrada", () => {
    const antes = { zeta: 1, alfa: 1, medio: 1 };
    const despues = { zeta: 2, alfa: 2, medio: 2 };
    expect(loQueCambio(antes, despues).map((c) => c.campo)).toEqual(["alfa", "medio", "zeta"]);
  });

  it("bigint: se compara por valor, no por referencia de caja", () => {
    expect(loQueCambio({ saldo: 100n }, { saldo: 100n })).toEqual([]);
    expect(loQueCambio({ saldo: 100n }, { saldo: 150n })).toEqual([{ campo: "saldo", antes: 100n, despues: 150n }]);
  });

  it("Date: se compara por tiempo (getTime), dos instancias distintas del mismo instante son iguales", () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-01-01T00:00:00.000Z");
    expect(a).not.toBe(b);
    expect(loQueCambio({ vence: a }, { vence: b })).toEqual([]);

    const c = new Date("2026-02-01T00:00:00.000Z");
    expect(loQueCambio({ vence: a }, { vence: c })).toEqual([{ campo: "vence", antes: a, despues: c }]);
  });

  it("null vs undefined: nunca son iguales (undefined = clave ausente)", () => {
    expect(loQueCambio({ nota: null }, {})).toEqual([{ campo: "nota", antes: null, despues: undefined }]);
    expect(loQueCambio({}, { nota: null })).toEqual([{ campo: "nota", antes: undefined, despues: null }]);
    expect(loQueCambio({ nota: null }, { nota: null })).toEqual([]);
  });

  it("clave agregada", () => {
    expect(loQueCambio({ a: 1 }, { a: 1, b: 2 })).toEqual([{ campo: "b", antes: undefined, despues: 2 }]);
  });

  it("clave quitada", () => {
    expect(loQueCambio({ a: 1, b: 2 }, { a: 1 })).toEqual([{ campo: "b", antes: 2, despues: undefined }]);
  });

  it("arreglos: se comparan como valor ENTERO, no elemento a elemento", () => {
    const antes = { tags: ["a", "b"] };
    const despues = { tags: ["a", "c"] };
    // Un solo cambio en "tags" con los dos arreglos completos, NO un cambio
    // en "tags.1" — este paquete documenta explícitamente que no diffea
    // arreglos por índice.
    expect(loQueCambio(antes, despues)).toEqual([{ campo: "tags", antes: ["a", "b"], despues: ["a", "c"] }]);
  });

  it("arreglos iguales (mismo contenido, misma posición): sin cambio", () => {
    expect(loQueCambio({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toEqual([]);
  });

  it("arreglos con distinto largo: cambio", () => {
    expect(loQueCambio({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual([
      { campo: "tags", antes: ["a"], despues: ["a", "b"] },
    ]);
  });

  it("arreglo de objetos: comparación profunda del arreglo entero (no por índice)", () => {
    const antes = { items: [{ id: 1 }, { id: 2 }] };
    const despues = { items: [{ id: 1 }, { id: 2 }] };
    expect(loQueCambio(antes, despues)).toEqual([]);

    const despuesDistinto = { items: [{ id: 1 }, { id: 3 }] };
    expect(loQueCambio(antes, despuesDistinto)).toEqual([
      { campo: "items", antes: [{ id: 1 }, { id: 2 }], despues: [{ id: 1 }, { id: 3 }] },
    ]);
  });

  it("nunca tira con una referencia circular en antes: la reporta como \"[ciclo]\"", () => {
    const antes: Record<string, unknown> = { a: 1 };
    antes.self = antes;
    const despues = { a: 1, self: {} };

    let resultado: ReturnType<typeof loQueCambio> = [];
    expect(() => {
      resultado = loQueCambio(antes, despues);
    }).not.toThrow();
    expect(resultado.some((c) => c.campo === "self" && c.antes === "[ciclo]")).toBe(true);
  });

  it("nunca tira con una referencia circular en despues", () => {
    const antes = { a: 1, self: {} };
    const despues: Record<string, unknown> = { a: 1 };
    despues.self = despues;

    expect(() => loQueCambio(antes, despues)).not.toThrow();
  });

  it("M12: loQueCambio(o, o) con o autoreferencial da [] (misma referencia = sin cambio), no \"[ciclo]\"", () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(() => loQueCambio(o, o)).not.toThrow();
    expect(loQueCambio(o, o)).toEqual([]);
  });

  it("M12: loQueCambio(o, o) con un ciclo más profundo (o.a.b = o) también da []", () => {
    const o: Record<string, unknown> = { a: { b: null } };
    (o.a as Record<string, unknown>).b = o;
    expect(() => loQueCambio(o, o)).not.toThrow();
    expect(loQueCambio(o, o)).toEqual([]);
  });

  it("M12: dos objetos autoreferenciales DISTINTOS (no la misma referencia) siguen reportando \"[ciclo]\" — el fix de M12 es solo para la MISMA referencia", () => {
    const objA: Record<string, unknown> = { a: 1 };
    objA.self = objA;
    const objB: Record<string, unknown> = { a: 1 };
    objB.self = objB;
    const resultado = loQueCambio(objA, objB);
    expect(resultado.some((c) => c.campo === "self" && c.antes === "[ciclo]" && c.despues === "[ciclo]")).toBe(true);
  });

  it("no confunde un valor compartido (mismo objeto referenciado dos veces, sin ciclo) con un ciclo", () => {
    const compartido = { x: 1 };
    const antes = { a: compartido, b: compartido };
    const despues = { a: compartido, b: { x: 2 } };
    expect(loQueCambio(antes, despues)).toEqual([{ campo: "b.x", antes: 1, despues: 2 }]);
  });

  it('"antes" ausente (undefined) contra un objeto plano en "despues": se expande CAMPO A CAMPO, no un solo cambio en "(raiz)" (caso típico: auditar una entidad recién creada)', () => {
    expect(loQueCambio(undefined, { nombre: "Silla", precio: 100 })).toEqual([
      { campo: "nombre", antes: undefined, despues: "Silla" },
      { campo: "precio", antes: undefined, despues: 100 },
    ]);
  });

  it('"despues" ausente contra un objeto plano en "antes": mismo criterio, al revés (caso típico: entidad borrada)', () => {
    expect(loQueCambio({ nombre: "Silla", precio: 100 }, undefined)).toEqual([
      { campo: "nombre", antes: "Silla", despues: undefined },
      { campo: "precio", antes: 100, despues: undefined },
    ]);
  });

  it('un lado ausente contra un objeto plano se expande también DENTRO de objetos anidados', () => {
    const antes = { a: 1 };
    const despues = { a: 1, direccion: { calle: "X", ciudad: "Y" } };
    expect(loQueCambio(antes, despues)).toEqual([
      { campo: "direccion.calle", antes: undefined, despues: "X" },
      { campo: "direccion.ciudad", antes: undefined, despues: "Y" },
    ]);
  });

  it('M11: "null" cuenta como ausente igual que "undefined" — loQueCambio(null, objeto) se expande campo a campo', () => {
    expect(loQueCambio(null, { nombre: "Silla", precio: 100 })).toEqual([
      { campo: "nombre", antes: undefined, despues: "Silla" },
      { campo: "precio", antes: undefined, despues: 100 },
    ]);
  });

  it('M11: al revés, loQueCambio(objeto, null) también se expande campo a campo', () => {
    expect(loQueCambio({ nombre: "Silla", precio: 100 }, null)).toEqual([
      { campo: "nombre", antes: "Silla", despues: undefined },
      { campo: "precio", antes: 100, despues: undefined },
    ]);
  });

  it('M11: null se expande también DENTRO de objetos anidados (mismo criterio que undefined)', () => {
    const antes = { a: 1, direccion: null };
    const despues = { a: 1, direccion: { calle: "X" } };
    expect(loQueCambio(antes, despues)).toEqual([{ campo: "direccion.calle", antes: undefined, despues: "X" }]);
  });

  it('M11 NO cambia que null y undefined sigan siendo valores DISTINTOS entre sí en una comparación directa', () => {
    expect(loQueCambio(null, undefined)).toEqual([{ campo: "(raiz)", antes: null, despues: undefined }]);
    expect(loQueCambio({ nota: null }, {})).toEqual([{ campo: "nota", antes: null, despues: undefined }]);
    expect(loQueCambio(null, null)).toEqual([]); // misma "referencia" (M12): sin cambio
  });

  it('un lado ausente contra algo que NO es un objeto plano (string, arreglo, Date) sigue siendo un solo cambio de valor entero', () => {
    expect(loQueCambio(undefined, "texto")).toEqual([{ campo: "(raiz)", antes: undefined, despues: "texto" }]);
    expect(loQueCambio(undefined, ["a", "b"])).toEqual([{ campo: "(raiz)", antes: undefined, despues: ["a", "b"] }]);
  });

  it("un objeto sin prototipo (Object.create(null)) se trata como plano, no como valor hoja", () => {
    const antes = Object.create(null) as Record<string, unknown>;
    antes.a = 1;
    const despues = Object.create(null) as Record<string, unknown>;
    despues.a = 2;
    expect(loQueCambio({ x: antes }, { x: despues })).toEqual([{ campo: "x.a", antes: 1, despues: 2 }]);
  });

  it("dos arreglos cíclicos DISTINTOS (no la misma referencia) se comparan sin loop infinito y dan un cambio", () => {
    const arrA: unknown[] = [1];
    arrA.push(arrA);
    const arrB: unknown[] = [1];
    arrB.push(arrB);
    expect(() => loQueCambio({ tags: arrA }, { tags: arrB })).not.toThrow();
    expect(loQueCambio({ tags: arrA }, { tags: arrB })).toEqual([{ campo: "tags", antes: arrA, despues: arrB }]);
  });

  it("arreglo de objetos con referencias circulares (distintas) adentro: sin loop infinito, se reporta como cambio", () => {
    const objA: Record<string, unknown> = {};
    objA.self = objA;
    const objB: Record<string, unknown> = {};
    objB.self = objB;
    expect(() => loQueCambio({ items: [objA] }, { items: [objB] })).not.toThrow();
    expect(loQueCambio({ items: [objA] }, { items: [objB] })).toEqual([
      { campo: "items", antes: [objA], despues: [objB] },
    ]);
  });

  it("arreglo de objetos con distinta cantidad de claves: no son iguales", () => {
    expect(loQueCambio({ items: [{ a: 1 }] }, { items: [{ a: 1, b: 2 }] })).toEqual([
      { campo: "items", antes: [{ a: 1 }], despues: [{ a: 1, b: 2 }] },
    ]);
  });

  it("orden estable cuando dos rutas coinciden por colisión de nombre (una clave literal con punto vs. un objeto anidado)", () => {
    // "x.b" (clave literal) y "x": { b } (anidado) producen la MISMA ruta
    // con puntos — un caso de ambigüedad inherente a aplanar con puntos, no
    // un bug: acá sirve además para ejercitar el comparador de `sort` con
    // dos entradas de "campo" IGUAL (ni menor ni mayor entre sí).
    const antes = { x: { b: 1 }, "x.b": 5 };
    const despues = { x: { b: 2 }, "x.b": 6 };
    const resultado = loQueCambio(antes, despues);
    expect(resultado).toHaveLength(2);
    expect(resultado.every((c) => c.campo === "x.b")).toBe(true);
  });

  it("un objeto reemplazado por un valor no-objeto QUE NO ES null/undefined (ej. un string) se reporta entero, sin recursar", () => {
    expect(loQueCambio({ direccion: { calle: "X" } }, { direccion: "mudado" })).toEqual([
      { campo: "direccion", antes: { calle: "X" }, despues: "mudado" },
    ]);
  });

  it("un objeto reemplazado por null (M11: null cuenta como ausente) SÍ se expande campo a campo, igual que undefined", () => {
    expect(loQueCambio({ direccion: { calle: "X", ciudad: "Y" } }, { direccion: null })).toEqual([
      { campo: "direccion.calle", antes: "X", despues: undefined },
      { campo: "direccion.ciudad", antes: "Y", despues: undefined },
    ]);
  });
});
