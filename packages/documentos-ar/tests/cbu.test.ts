import { describe, expect, it } from "vitest";
import { validarCbu, validarCvu } from "../src/cbu.ts";

/**
 * Reimplementación INDEPENDIENTE del algoritmo de dígito verificador de
 * CBU/CVU, escrita en el test y no importada de `src/cbu.ts`: si el código
 * de producción tuviera un bug sistemático, un test que reusara la misma
 * función nunca lo vería. Sirve para armar fixtures válidas de 22 dígitos
 * (sintéticas, no CBU de una persona real) y, alterando un dígito, fixtures
 * inválidas con un motivo conocido.
 */
function dvBloque(digitos: string, pesos: readonly number[]): number {
  let suma = 0;
  for (let i = 0; i < pesos.length; i++) suma += Number(digitos.charAt(i)) * pesos[i]!;
  return (10 - (suma % 10)) % 10;
}

function armarCbu(banco: string, sucursal: string, cuenta: string): string {
  const bloque1sinDv = banco + sucursal; // 7 dígitos
  const dv1 = dvBloque(bloque1sinDv, [7, 1, 3, 9, 7, 1, 3]);
  const dv2 = dvBloque(cuenta, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]); // cuenta: 13 dígitos
  return `${bloque1sinDv}${dv1}${cuenta}${dv2}`;
}

function alterar(s: string, indice: number): string {
  const actual = s.charAt(indice);
  const nuevo = actual === "1" ? "2" : "1";
  return s.slice(0, indice) + nuevo + s.slice(indice + 1);
}

describe("validarCbu", () => {
  const cbu = armarCbu("007", "0445", "0000003100094");

  it("arma una fixture de 22 dígitos que no empieza con 000 (para no confundirla con CVU)", () => {
    expect(cbu).toHaveLength(22);
    expect(cbu.slice(0, 3)).not.toBe("000");
  });

  it("valida un CBU correcto", () => {
    const r = validarCbu(cbu);
    expect(r).toEqual({ ok: true, normalizado: cbu, banco: "007" });
  });

  it("valida el mismo CBU con espacios y guiones", () => {
    const conSeparadores = `${cbu.slice(0, 3)}-${cbu.slice(3, 7)}-${cbu.slice(7)}`;
    expect(validarCbu(conSeparadores)).toEqual({ ok: true, normalizado: cbu, banco: "007" });
  });

  it("rechaza una longitud incorrecta", () => {
    const r = validarCbu(cbu.slice(0, 21));
    expect(r).toEqual({
      ok: false,
      motivo: "Un CBU tiene 22 dígitos (tiene 21).",
      codigo: "longitud_invalida",
    });
  });

  it("rechaza alterando un dígito del bloque 1 (banco/sucursal)", () => {
    const r = validarCbu(alterar(cbu, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza alterando el DV1 (dígito 8)", () => {
    const r = validarCbu(alterar(cbu, 7));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza alterando un dígito de la cuenta (bloque 2)", () => {
    const r = validarCbu(alterar(cbu, 12));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza alterando el DV2 (dígito 22)", () => {
    const r = validarCbu(alterar(cbu, 21));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza un CVU (prefijo 000) con un motivo que apunta a validarCvu", () => {
    const cvu = armarCbu("000", "0031", "0000000012345");
    const r = validarCbu(cvu);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("es_cvu");
      expect(r.motivo).toMatch(/CVU/);
    }
  });
});

describe("validarCvu", () => {
  const cvu = armarCbu("000", "0031", "0000000012345");

  it("arma una fixture de 22 dígitos que empieza con 000", () => {
    expect(cvu).toHaveLength(22);
    expect(cvu.slice(0, 3)).toBe("000");
  });

  it("valida un CVU correcto", () => {
    expect(validarCvu(cvu)).toEqual({ ok: true, normalizado: cvu });
  });

  it("rechaza alterando un dígito de la cuenta", () => {
    const r = validarCvu(alterar(cvu, 15));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("digito_verificador_invalido");
  });

  it("rechaza un CBU (sin prefijo 000) con un motivo que apunta a validarCbu", () => {
    const cbu = armarCbu("007", "0445", "0000003100094");
    const r = validarCvu(cbu);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("no_es_cvu");
      expect(r.motivo).toMatch(/CBU/);
    }
  });

  it("rechaza una longitud incorrecta", () => {
    const r = validarCvu(cvu + "0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("longitud_invalida");
  });
});
