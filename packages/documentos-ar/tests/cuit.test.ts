import { describe, expect, it } from "vitest";
import { formatearCuit, validarCuit } from "../src/cuit.ts";

describe("validarCuit", () => {
  it("valida un CUIT correcto sin separadores", () => {
    const r = validarCuit("20123456786");
    expect(r).toEqual({ ok: true, normalizado: "20123456786", tipo: "persona" });
  });

  it("valida el mismo CUIT con guiones", () => {
    const r = validarCuit("20-12345678-6");
    expect(r).toEqual({ ok: true, normalizado: "20123456786", tipo: "persona" });
  });

  it("valida con puntos y espacios sueltos", () => {
    const r = validarCuit(" 20.123.456.78-6 ");
    expect(r).toEqual({ ok: true, normalizado: "20123456786", tipo: "persona" });
  });

  it("rechaza un dígito verificador incorrecto", () => {
    const r = validarCuit("20-12345678-7");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza una longitud incorrecta", () => {
    const corto = validarCuit("2012345678");
    const largo = validarCuit("201234567860");
    expect(corto).toEqual({
      ok: false,
      motivo: "Un CUIT/CUIL tiene 11 dígitos (tiene 10).",
      codigo: "longitud_invalida",
    });
    expect(largo.ok).toBe(false);
    if (!largo.ok) expect(largo.codigo).toBe("longitud_invalida");
  });

  it.each([
    ["20", "persona"],
    ["23", "persona"],
    ["24", "persona"],
    ["27", "persona"],
    ["30", "empresa"],
    ["33", "empresa"],
    ["34", "empresa"],
  ] as const)("acepta el prefijo %s como %s, con su DV correcto", (prefijo, tipo) => {
    // DV calculado independientemente para "12345678" con pesos 5,4,3,2,7,6,5,4,3,2 (mod 11).
    const dv: Record<string, number> = {
      "20": 6,
      "23": 5,
      "24": 1,
      "27": 0,
      "30": 1,
      "33": 0,
      "34": 7,
    };
    const r = validarCuit(`${prefijo}12345678${dv[prefijo]}`);
    expect(r).toEqual({ ok: true, normalizado: `${prefijo}12345678${dv[prefijo]}`, tipo });
  });

  it.each(["00", "10", "21", "25", "40", "99"])("rechaza el prefijo inválido %s", (prefijo) => {
    const r = validarCuit(`${prefijo}123456780`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("prefijo_invalido");
  });

  it("caso DV=10 (regla 23/33): prefijo natural inválido, 23 con el DV correcto sí vale", () => {
    // DNI 20000009: con prefijo 20 el algoritmo da DV=10 -> ningún último
    // dígito (0-9) puede cerrarlo, así que el CUIT no existe con ese
    // prefijo. Con 23 el mismo DNI da DV=9 (verificado independientemente).
    for (let ultimo = 0; ultimo <= 9; ultimo++) {
      const r = validarCuit(`2020000009${ultimo}`);
      expect(r.ok, `2020000009${ultimo} no debería validar`).toBe(false);
    }

    const con23 = validarCuit("23200000099");
    expect(con23).toEqual({ ok: true, normalizado: "23200000099", tipo: "persona" });
  });

  it("caso DV=10 (regla 23/33), mujer: 27 inválido, 23 con DV=4 sí vale", () => {
    // DNI 20000006: con prefijo 27 el algoritmo da DV=10 (inválido); con 23
    // da DV=4 (verificado independientemente).
    const con27 = validarCuit("27200000069"); // cualquier último dígito da inválido
    expect(con27.ok).toBe(false);

    const con23 = validarCuit("23200000064");
    expect(con23).toEqual({ ok: true, normalizado: "23200000064", tipo: "persona" });
  });
});

describe("formatearCuit", () => {
  it("formatea un CUIT sin separadores", () => {
    expect(formatearCuit("20123456786")).toBe("20-12345678-6");
  });

  it("formatea un CUIT que ya tiene guiones (idempotente)", () => {
    expect(formatearCuit("20-12345678-6")).toBe("20-12345678-6");
  });

  it("devuelve los dígitos tal cual cuando no llegan a 11", () => {
    expect(formatearCuit("123")).toBe("123");
  });
});
