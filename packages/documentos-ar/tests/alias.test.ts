import { describe, expect, it } from "vitest";
import { validarAlias } from "../src/alias.ts";

describe("validarAlias", () => {
  it("valida un alias de 6 caracteres (mínimo)", () => {
    expect(validarAlias("ab.c-1")).toEqual({ ok: true, normalizado: "ab.c-1" });
  });

  it("valida un alias de 20 caracteres (máximo)", () => {
    const alias = "a".repeat(20);
    expect(validarAlias(alias)).toEqual({ ok: true, normalizado: alias });
  });

  it("normaliza a minúsculas", () => {
    expect(validarAlias("JUAN.PEREZ.MP")).toEqual({ ok: true, normalizado: "juan.perez.mp" });
  });

  it("rechaza menos de 6 caracteres", () => {
    const r = validarAlias("ab.c1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("formato_invalido");
  });

  it("rechaza más de 20 caracteres", () => {
    const r = validarAlias("a".repeat(21));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("formato_invalido");
  });

  it("rechaza caracteres fuera de [a-z0-9.-]", () => {
    const r = validarAlias("juan perez!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("formato_invalido");
  });
});
