import { describe, expect, it } from "vitest";
import { crearPlanDesdePlantilla, type DefinicionCuenta, esRubroNaturaleza, validarArbol } from "../src/plan-cuentas.js";

describe("esRubroNaturaleza", () => {
  it("acepta cada una de las naturalezas válidas", () => {
    expect(esRubroNaturaleza("activo")).toBe(true);
    expect(esRubroNaturaleza("pasivo")).toBe(true);
    expect(esRubroNaturaleza("pn")).toBe(true);
    expect(esRubroNaturaleza("resultado_positivo")).toBe(true);
    expect(esRubroNaturaleza("resultado_negativo")).toBe(true);
  });

  it("rechaza un string que no es una naturaleza y un valor que no es string", () => {
    expect(esRubroNaturaleza("otra_cosa")).toBe(false);
    expect(esRubroNaturaleza(123)).toBe(false);
    expect(esRubroNaturaleza(null)).toBe(false);
    expect(esRubroNaturaleza(undefined)).toBe(false);
  });
});

function cuenta(p: Partial<DefinicionCuenta> & { codigo: string; padreCodigo: string | null }): DefinicionCuenta {
  return {
    nombre: p.codigo,
    imputable: true,
    rubroNaturaleza: "activo",
    ...p,
  };
}

describe("validarArbol", () => {
  it("código duplicado en el plan → error", () => {
    const resultado = validarArbol([cuenta({ codigo: "1.1", padreCodigo: null }), cuenta({ codigo: "1.1", padreCodigo: null })]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.codigo === "1.1" && /duplicado/i.test(e.motivo))).toBe(true);
    }
  });

  it("cuenta imputable con hijas → error", () => {
    const resultado = validarArbol([
      cuenta({ codigo: "1", padreCodigo: null, imputable: true }),
      cuenta({ codigo: "1.1", padreCodigo: "1", imputable: true }),
    ]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.codigo === "1")).toBe(true);
    }
  });

  it("agrupación (no imputable) sin hijas se permite", () => {
    const resultado = validarArbol([cuenta({ codigo: "1", padreCodigo: null, imputable: false })]);
    expect(resultado.ok).toBe(true);
  });

  it("nivel de naturaleza heredado: hija de una raíz activo no puede ser pasivo", () => {
    const resultado = validarArbol([
      cuenta({ codigo: "1", padreCodigo: null, imputable: false, rubroNaturaleza: "activo" }),
      cuenta({ codigo: "1.1", padreCodigo: "1", imputable: true, rubroNaturaleza: "pasivo" }),
    ]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.codigo === "1.1" && /naturaleza/i.test(e.motivo))).toBe(true);
    }
  });

  it("un árbol válido de varios niveles con naturaleza consistente pasa", () => {
    const resultado = validarArbol([
      cuenta({ codigo: "1", padreCodigo: null, imputable: false, rubroNaturaleza: "activo" }),
      cuenta({ codigo: "1.1", padreCodigo: "1", imputable: false, rubroNaturaleza: "activo" }),
      cuenta({ codigo: "1.1.1", padreCodigo: "1.1", imputable: true, rubroNaturaleza: "activo" }),
    ]);
    expect(resultado.ok).toBe(true);
  });
});

describe("crearPlanDesdePlantilla", () => {
  const plantillas = {
    basica: [
      cuenta({ codigo: "1", padreCodigo: null, imputable: false, rubroNaturaleza: "activo" }),
      cuenta({ codigo: "1.1", padreCodigo: "1", imputable: true, rubroNaturaleza: "activo" }),
    ],
    vacia: [],
  };

  it("arma la definición del plan a partir de una plantilla válida", () => {
    const resultado = crearPlanDesdePlantilla("Plan 2026", "basica", plantillas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.cuentas).toHaveLength(2);
      expect(resultado.nombre).toBe("Plan 2026");
    }
  });

  it("una plantilla sin cuentas cargadas devuelve error", () => {
    const resultado = crearPlanDesdePlantilla("Plan 2026", "vacia", plantillas);
    expect(resultado.ok).toBe(false);
  });

  it("una plantilla inexistente devuelve error", () => {
    const resultado = crearPlanDesdePlantilla("Plan 2026", "no-existe", plantillas);
    expect(resultado.ok).toBe(false);
  });
});
