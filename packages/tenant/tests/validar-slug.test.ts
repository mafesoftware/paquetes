import { describe, expect, it } from "vitest";
import { validarSlug } from "../src/validar-slug.js";

describe("validarSlug: casos válidos", () => {
  it("acepta un slug simple", () => {
    expect(validarSlug("demo")).toEqual({ ok: true, slug: "demo" });
  });

  it("acepta números y guiones internos", () => {
    expect(validarSlug("torres-del-parque-2")).toEqual({ ok: true, slug: "torres-del-parque-2" });
  });

  it("acepta el largo mínimo (3) y el máximo (40)", () => {
    expect(validarSlug("abc")).toEqual({ ok: true, slug: "abc" });
    const cuarenta = "a".repeat(40);
    expect(validarSlug(cuarenta)).toEqual({ ok: true, slug: cuarenta });
  });
});

describe("validarSlug: casos inválidos (uno por motivo, de la tarea)", () => {
  it('"Admin" cuenta como reservado (comparación case-insensitive)', () => {
    expect(validarSlug("Admin")).toEqual({ ok: false, motivo: "reservado" });
  });

  it('"-demo-" tiene guion al borde', () => {
    expect(validarSlug("-demo-")).toEqual({ ok: false, motivo: "guion_borde", sugerencia: "demo" });
  });

  it('"a" es muy corto', () => {
    expect(validarSlug("a")).toEqual({ ok: false, motivo: "longitud" });
  });

  it("64 caracteres es muy largo, y sugiere el candidato truncado a 40", () => {
    const largo = "a".repeat(64);
    const resultado = validarSlug(largo);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toBe("longitud");
      expect(resultado.sugerencia).toBe("a".repeat(40));
    }
  });

  it("doble guion", () => {
    expect(validarSlug("mi--tenant")).toEqual({ ok: false, motivo: "guion_doble", sugerencia: "mi-tenant" });
  });

  it("no ASCII (acentos) da no_ascii, con sugerencia sin acentos", () => {
    expect(validarSlug("Construcción")).toEqual({ ok: false, motivo: "no_ascii", sugerencia: "construccion" });
  });
});

describe("validarSlug: sugerencia (valores de la tarea, copiados textual)", () => {
  it('"Mi Constructora" -> "mi-constructora"', () => {
    const resultado = validarSlug("Mi Constructora");
    expect(resultado).toEqual({
      ok: false,
      motivo: "caracteres_invalidos",
      sugerencia: "mi-constructora",
    });
  });

  it('"Construcción" -> "construccion"', () => {
    const resultado = validarSlug("Construcción");
    expect(resultado).toEqual({ ok: false, motivo: "no_ascii", sugerencia: "construccion" });
  });
});

describe("validarSlug: otros casos", () => {
  it("mayúsculas sueltas dan caracteres_invalidos (no reservado, no ASCII)", () => {
    expect(validarSlug("MiTienda")).toEqual({
      ok: false,
      motivo: "caracteres_invalidos",
      sugerencia: "mitienda",
    });
  });

  it("espacios dan caracteres_invalidos", () => {
    const resultado = validarSlug("mi tienda");
    expect(resultado).toEqual({ ok: false, motivo: "caracteres_invalidos", sugerencia: "mi-tienda" });
  });

  it("nunca sugiere un slug reservado", () => {
    // "WWW" en minúsculas es "www", reservado -> motivo reservado, sin sugerencia.
    expect(validarSlug("WWW")).toEqual({ ok: false, motivo: "reservado" });
  });

  it("sin sugerencia razonable cuando el candidato normalizado queda vacío", () => {
    // "---" pasa el patrón de caracteres (los guiones están permitidos) pero
    // tiene guion al borde; normalizado queda vacío (nada más que guiones
    // que colapsan y se recortan), así que no hay sugerencia.
    expect(validarSlug("---")).toEqual({ ok: false, motivo: "guion_borde" });
  });

  it("acepta una lista de reservados propia en vez de RESERVADOS", () => {
    const propios = new Set(["mitienda"]);
    expect(validarSlug("mitienda", propios)).toEqual({ ok: false, motivo: "reservado" });
    // "admin" no está en la lista propia, así que con reservados custom pasa:
    expect(validarSlug("admin", propios)).toEqual({ ok: true, slug: "admin" });
  });

  it("una lista de reservados propia con mayúsculas se normaliza sola (case-insensitive igual)", () => {
    const propiosConMayusculas = new Set(["Facturacion", "SOPORTE-TECNICO"]);
    expect(validarSlug("facturacion", propiosConMayusculas)).toEqual({ ok: false, motivo: "reservado" });
    expect(validarSlug("soporte-tecnico", propiosConMayusculas)).toEqual({ ok: false, motivo: "reservado" });
    // algo que no está en la lista (con o sin mayúsculas) sigue pasando:
    expect(validarSlug("otra-cosa", propiosConMayusculas)).toEqual({ ok: true, slug: "otra-cosa" });
  });
});
