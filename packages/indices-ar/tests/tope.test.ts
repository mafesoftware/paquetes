import { describe, expect, it } from "vitest";
import { ErrorIndices } from "../src/errores.js";
import { diferenciaDeAjuste } from "../src/diferencia.js";
import { ajusteConTope, diferenciaDeAjusteConTope } from "../src/tope.js";

const MONTO_BASE = 10_000_000n; // $100.000
const VALOR_BASE = "100";
const TOPE = "15"; // 15% de 10_000_000 = 1_500_000

describe("ajusteConTope", () => {
  it("ajuste por debajo del tope: pasa entero, sin absorción", () => {
    const r = ajusteConTope({ montoBase: MONTO_BASE, valorBase: VALOR_BASE, valorRef: "105", topePct: TOPE });
    expect(r.factor).toBe("1.05");
    expect(r.ajusteSinTope).toBe(500_000n);
    expect(r.ajusteAplicado).toBe(500_000n);
    expect(r.absorbido).toBe(0n);
  });

  it("ajuste que supera el tope: se capa a exactamente el tope, el resto queda absorbido", () => {
    const r = ajusteConTope({ montoBase: MONTO_BASE, valorBase: VALOR_BASE, valorRef: "120", topePct: TOPE });
    // +20% sin tope = 2_000_000; tope 15% = 1_500_000
    expect(r.ajusteSinTope).toBe(2_000_000n);
    expect(r.ajusteAplicado).toBe(1_500_000n);
    expect(r.absorbido).toBe(500_000n);
  });

  it("ajuste negativo (deflación): pasa entero, el tope solo limita hacia arriba", () => {
    const r = ajusteConTope({ montoBase: MONTO_BASE, valorBase: VALOR_BASE, valorRef: "90", topePct: TOPE });
    expect(r.ajusteSinTope).toBe(-1_000_000n);
    expect(r.ajusteAplicado).toBe(-1_000_000n);
    expect(r.absorbido).toBe(0n);
  });

  it("soloPositivo con índice negativo: el ajuste se capa a 0 (piso), no a un crédito", () => {
    const r = ajusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorRef: "90",
      topePct: TOPE,
      soloPositivo: true,
    });
    expect(r.ajusteSinTope).toBe(-1_000_000n);
    expect(r.ajusteAplicado).toBe(0n);
    // absorbido negativo: es el piso (soloPositivo) el que actuó, no el tope de arriba.
    expect(r.absorbido).toBe(-1_000_000n);
  });

  it("topePct inválido tira ErrorIndices (valor_invalido)", () => {
    expect(() =>
      ajusteConTope({ montoBase: MONTO_BASE, valorBase: VALOR_BASE, valorRef: "105", topePct: "no-es-numero" }),
    ).toThrow(ErrorIndices);
  });
});

describe("diferenciaDeAjusteConTope", () => {
  it("caso del brief: provisorio +20% (capado a 15%) y definitivo +18% (también capado a 15%) -> diferencia 0, no un crédito", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "120",
      valorDefinitivo: "118",
      topePct: TOPE,
    });
    expect(diferencia).toBe(0n);

    // El bug que reemplaza esta función: la diferencia SIN tope sí daba negativo,
    // y aplicarTope() (el viejo, ya no existe) devolvía ese negativo tal cual —
    // un crédito de $2.000 que el cliente no debía recibir.
    const diferenciaSinTope = diferenciaDeAjuste(MONTO_BASE, VALOR_BASE, "120", "118");
    expect(diferenciaSinTope).toBe(-200_000n);
  });

  it("corrección hacia arriba, ambos valores por debajo del tope: da la diferencia completa (igual que sin tope)", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "105",
      valorDefinitivo: "108",
      topePct: TOPE,
    });
    const sinTope = diferenciaDeAjuste(MONTO_BASE, VALOR_BASE, "105", "108");
    expect(diferencia).toBe(sinTope);
    expect(diferencia).toBe(300_000n);
  });

  it("corrección hacia arriba que cruza el tope: da solo hasta el tope, no la diferencia completa", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "105", // ajuste 500_000, por debajo del tope: pasa entero
      valorDefinitivo: "120", // ajuste 2_000_000, capado a 1_500_000
      topePct: TOPE,
    });
    // 1_500_000 (capado) - 500_000 (sin capar) = 1_000_000
    expect(diferencia).toBe(1_000_000n);
    const sinTope = diferenciaDeAjuste(MONTO_BASE, VALOR_BASE, "105", "120");
    expect(diferencia).toBeLessThan(sinTope);
  });

  it("corrección hacia abajo mientras se sigue por encima del tope: diferencia 0", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "130", // ajuste 3_000_000, capado a 1_500_000
      valorDefinitivo: "120", // ajuste 2_000_000, capado a 1_500_000
      topePct: TOPE,
    });
    expect(diferencia).toBe(0n);
  });

  it("corrección hacia abajo que baja del tope: da el crédito parcial correcto", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "130", // ajuste 3_000_000, capado a 1_500_000
      valorDefinitivo: "105", // ajuste 500_000, por debajo del tope: pasa entero
      topePct: TOPE,
    });
    // 500_000 (sin capar) - 1_500_000 (capado) = -1_000_000: crédito real
    expect(diferencia).toBe(-1_000_000n);
  });

  it("soloPositivo con índice definitivo negativo: no genera crédito", () => {
    const diferencia = diferenciaDeAjusteConTope({
      montoBase: MONTO_BASE,
      valorBase: VALOR_BASE,
      valorUsado: "105",
      valorDefinitivo: "90",
      topePct: TOPE,
      soloPositivo: true,
    });
    // usado: 500_000 aplicado; definitivo: -1_000_000 sin tope, pero soloPositivo lo capa a 0
    expect(diferencia).toBe(0n - 500_000n);
  });
});
