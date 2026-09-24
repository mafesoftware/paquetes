import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { esUuid, unaDe } from "../src/uuid.js";

describe("esUuid", () => {
  it("acepta un UUID v4 real (randomUUID)", () => {
    expect(esUuid(randomUUID())).toBe(true);
  });

  it("acepta UUID en mayúsculas", () => {
    expect(esUuid(randomUUID().toUpperCase())).toBe(true);
  });

  it("acepta cada versión de 1 a 8", () => {
    for (const version of "12345678") {
      const uuid = `aaaaaaaa-bbbb-${version}bbb-8bbb-bbbbbbbbbbbb`;
      expect(esUuid(uuid)).toBe(true);
    }
  });

  it("acepta el UUID nulo", () => {
    expect(esUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("rechaza version 0 o 9 (no definidas)", () => {
    expect(esUuid("aaaaaaaa-bbbb-0bbb-8bbb-bbbbbbbbbbbb")).toBe(false);
    expect(esUuid("aaaaaaaa-bbbb-9bbb-8bbb-bbbbbbbbbbbb")).toBe(false);
  });

  it("rechaza una variante fuera de 8/9/a/b", () => {
    expect(esUuid("aaaaaaaa-bbbb-4bbb-cbbb-bbbbbbbbbbbb")).toBe(false);
    expect(esUuid("aaaaaaaa-bbbb-4bbb-0bbb-bbbbbbbbbbbb")).toBe(false);
  });

  it("rechaza texto que no tiene forma de UUID", () => {
    expect(esUuid("no-es-un-uuid")).toBe(false);
    expect(esUuid("")).toBe(false);
    expect(esUuid("aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbb")).toBe(false); // un carácter de menos
  });

  it("rechaza valores que no son string", () => {
    expect(esUuid(undefined)).toBe(false);
    expect(esUuid(null)).toBe(false);
    expect(esUuid(42)).toBe(false);
    expect(esUuid({})).toBe(false);
  });
});

describe("unaDe", () => {
  const ESTADOS = ["borrador", "publicado", "archivado"] as const;

  it("devuelve el valor si está en la lista", () => {
    expect(unaDe("publicado", ESTADOS, "borrador")).toBe("publicado");
  });

  it("devuelve el valor por omisión si no está en la lista", () => {
    expect(unaDe("cualquier-cosa", ESTADOS, "borrador")).toBe("borrador");
  });

  it("recorta espacios antes de comparar", () => {
    expect(unaDe("  publicado  ", ESTADOS, "borrador")).toBe("publicado");
  });

  it("devuelve el valor por omisión para valores que no son string", () => {
    expect(unaDe(undefined, ESTADOS, "borrador")).toBe("borrador");
    expect(unaDe(42, ESTADOS, "borrador")).toBe("borrador");
  });
});
