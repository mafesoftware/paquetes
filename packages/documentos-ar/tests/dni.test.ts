import { describe, expect, it } from "vitest";
import { validarDni } from "../src/dni.ts";

describe("validarDni", () => {
  it("valida un DNI de 8 dígitos", () => {
    expect(validarDni("12345678")).toEqual({ ok: true, normalizado: "12345678" });
  });

  it("valida un DNI de 7 dígitos", () => {
    expect(validarDni("1234567")).toEqual({ ok: true, normalizado: "1234567" });
  });

  it("acepta puntos de miles", () => {
    expect(validarDni("12.345.678")).toEqual({ ok: true, normalizado: "12345678" });
  });

  it("acepta espacios sueltos", () => {
    expect(validarDni(" 1.234.567 ")).toEqual({ ok: true, normalizado: "1234567" });
  });

  it("rechaza menos de 7 dígitos", () => {
    const r = validarDni("123456");
    expect(r).toEqual({
      ok: false,
      motivo: "Un DNI tiene 7 u 8 dígitos (tiene 6).",
      codigo: "longitud_invalida",
    });
  });

  it("rechaza más de 8 dígitos", () => {
    const r = validarDni("123456789");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("longitud_invalida");
  });

  it("rechaza el valor 0", () => {
    const r = validarDni("0000000");
    expect(r).toEqual({ ok: false, motivo: "Un DNI no empieza con 0.", codigo: "cero_invalido" });
  });

  it("rechaza cualquier DNI con cero a la izquierda", () => {
    const r = validarDni("01234567");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("cero_invalido");
  });
});
