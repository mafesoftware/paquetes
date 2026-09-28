import { describe, expect, it } from "vitest";
import { ErrorIndices } from "../src/errores.js";
import { aplicarTope, soloPositivo } from "../src/tope.js";

describe("aplicarTope", () => {
  it("caso del brief: tope 15% acumulado, ajuste que se pasa: informa el excedente", () => {
    const r = aplicarTope({
      ajusteAcumuladoPct: "12",
      topePct: "15",
      ajusteNuevo: 5_000_000n,
      montoBase: 100_000_000n,
    });
    // límite 15% = 15_000_000; ya aplicado 12% = 12_000_000; disponible 3_000_000
    expect(r.ajusteAplicado).toBe(3_000_000n);
    expect(r.excedenteAbsorbido).toBe(2_000_000n);
  });

  it("el ajuste nuevo entra entero dentro del tope: sin excedente", () => {
    const r = aplicarTope({ ajusteAcumuladoPct: "0", topePct: "15", ajusteNuevo: 5_000_000n, montoBase: 100_000_000n });
    expect(r.ajusteAplicado).toBe(5_000_000n);
    expect(r.excedenteAbsorbido).toBe(0n);
  });

  it("ya se agotó el tope: el nuevo ajuste se absorbe entero", () => {
    const r = aplicarTope({ ajusteAcumuladoPct: "15", topePct: "15", ajusteNuevo: 1_000_000n, montoBase: 100_000_000n });
    expect(r.ajusteAplicado).toBe(0n);
    expect(r.excedenteAbsorbido).toBe(1_000_000n);
  });

  it("ajuste negativo: el tope no lo toca, pasa entero (spec: solo limita hacia arriba)", () => {
    const r = aplicarTope({ ajusteAcumuladoPct: "0", topePct: "15", ajusteNuevo: -500_000n, montoBase: 100_000_000n });
    expect(r.ajusteAplicado).toBe(-500_000n);
    expect(r.excedenteAbsorbido).toBe(0n);
  });

  it("ajuste nuevo 0: pasa entero (rama <= 0), sin excedente", () => {
    const r = aplicarTope({ ajusteAcumuladoPct: "10", topePct: "15", ajusteNuevo: 0n, montoBase: 100_000_000n });
    expect(r.ajusteAplicado).toBe(0n);
    expect(r.excedenteAbsorbido).toBe(0n);
  });

  it("ajusteAcumuladoPct negativo (un acumulado neto deflacionario): agranda lo disponible", () => {
    const r = aplicarTope({ ajusteAcumuladoPct: "-5", topePct: "15", ajusteNuevo: 25_000_000n, montoBase: 100_000_000n });
    // límite 15% = 15_000_000; ya aplicado -5% = -5_000_000; disponible 20_000_000
    expect(r.ajusteAplicado).toBe(20_000_000n);
    expect(r.excedenteAbsorbido).toBe(5_000_000n);
  });

  it("pct inválido tira ErrorIndices (valor_invalido)", () => {
    expect(() =>
      aplicarTope({ ajusteAcumuladoPct: "no-es-numero", topePct: "15", ajusteNuevo: 1_000n, montoBase: 100_000n }),
    ).toThrow(ErrorIndices);
  });
});

describe("soloPositivo", () => {
  it("deja pasar un ajuste positivo", () => {
    expect(soloPositivo(50_000n)).toBe(50_000n);
  });

  it("convierte un ajuste negativo a 0", () => {
    expect(soloPositivo(-50_000n)).toBe(0n);
  });

  it("0 se mantiene en 0", () => {
    expect(soloPositivo(0n)).toBe(0n);
  });
});
