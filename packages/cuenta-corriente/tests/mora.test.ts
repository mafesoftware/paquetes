import { describe, expect, it } from "vitest";
import { aging, interesMora } from "../src/mora.js";

describe("interesMora", () => {
  it("saldo $1.000.000, 36% anual, 30 días, gracia 0 → $29.589,04", () => {
    const saldo = 100_000_000n; // $1.000.000 en centavos
    const tramos = [{ desde: "2026-01-01", tasaAnual: "36" }];

    const interes = interesMora(saldo, "2026-01-01", "2026-01-31", tramos, 0);

    expect(interes).toBe(2_958_904n); // $29.589,04
  });

  it("gracia 5 días equivale a arrancar el período 5 días después (25 días de atraso)", () => {
    const saldo = 100_000_000n;
    const tramos = [{ desde: "2026-01-01", tasaAnual: "36" }];

    const conGracia = interesMora(saldo, "2026-01-01", "2026-01-31", tramos, 5);
    const sinGraciaDesdeMasCinco = interesMora(saldo, "2026-01-06", "2026-01-31", tramos, 0);

    expect(conGracia).toBe(sinGraciaDesdeMasCinco);
    // 25 días exactos (no 30).
    expect(conGracia).toBe(interesMora(saldo, "2026-01-01", "2026-01-26", tramos, 0));
  });

  it("gracia que cubre todo el período no genera interés", () => {
    const saldo = 100_000_000n;
    const tramos = [{ desde: "2026-01-01", tasaAnual: "36" }];

    expect(interesMora(saldo, "2026-01-01", "2026-01-10", tramos, 30)).toBe(0n);
  });

  it("cambio de tasa a mitad del período: el interés es la SUMA de cada tramo (36% 15 días + 48% 15 días)", () => {
    const saldo = 100_000_000n;
    const tramos = [
      { desde: "2026-01-01", tasaAnual: "36" },
      { desde: "2026-01-16", tasaAnual: "48" },
    ];

    const interes = interesMora(saldo, "2026-01-01", "2026-01-31", tramos, 0);

    // Fracción exacta calculada a mano, independiente de la implementación:
    // saldo × (36×15 + 48×15) / (100 × 365), redondeado una sola vez al final.
    // = 100_000_000 × 1260 / 36500 = 3.452.054,794... → $34.520,55
    expect(interes).toBe(3_452_055n);
  });

  it("período que cruza el 29 de febrero de 2028 (bisiesto): un día más de atraso que el mismo rango en un año no bisiesto", () => {
    const saldo = 100_000_000n;
    const tramos = [{ desde: "2028-01-01", tasaAnual: "36" }];

    const bisiesto = interesMora(saldo, "2028-01-16", "2028-03-16", tramos, 0); // 60 días (incluye el 29/2)
    const noBisiesto = interesMora(saldo, "2027-01-16", "2027-03-16", tramos, 0); // 59 días

    expect(bisiesto).toBe(5_917_808n);
    expect(bisiesto).toBeGreaterThan(noBisiesto);
  });

  it("saldo 0 o período sin días de atraso → 0", () => {
    const tramos = [{ desde: "2026-01-01", tasaAnual: "36" }];

    expect(interesMora(0n, "2026-01-01", "2026-01-31", tramos, 0)).toBe(0n);
    expect(interesMora(100_000_000n, "2026-01-31", "2026-01-31", tramos, 0)).toBe(0n);
  });

  it("sin tramos → 0, sin evaluar nada más", () => {
    expect(interesMora(100_000_000n, "2026-01-01", "2026-01-31", [], 0)).toBe(0n);
  });

  it("tasaAnual con formato inválido → tira Error", () => {
    const tramos = [{ desde: "2026-01-01", tasaAnual: "no-es-un-numero" }];
    expect(() => interesMora(100_000_000n, "2026-01-01", "2026-01-31", tramos, 0)).toThrow(/tasaAnual inválida/);
  });

  it("tasaAnual con más de 8 decimales → tira Error (formato inválido)", () => {
    const tramos = [{ desde: "2026-01-01", tasaAnual: "36.123456789" }];
    expect(() => interesMora(100_000_000n, "2026-01-01", "2026-01-31", tramos, 0)).toThrow(/tasaAnual inválida/);
  });

  it("ningún tramo empieza en o antes del período (tramos en orden ascendente): usa el MÁS ANTIGUO de todos", () => {
    const saldo = 100_000_000n;
    // Los dos tramos arrancan DESPUÉS del período consultado (caso que no
    // debería darse en la práctica, pero `tramoVigenteEn` no se queda sin
    // tasa: asume el más viejo en vez de un cero silencioso).
    const tramos = [
      { desde: "2026-02-01", tasaAnual: "36" },
      { desde: "2026-03-01", tasaAnual: "48" },
    ];

    const interes = interesMora(saldo, "2026-01-01", "2026-01-15", tramos, 0);

    // Debe coincidir con usar el tramo del 36% (el más antiguo) en todo el período.
    expect(interes).toBe(interesMora(saldo, "2026-01-01", "2026-01-15", [tramos[0]!], 0));
  });

  it("mismo caso con los tramos en orden DESCENDENTE: igual elige el más antiguo (36%), no el primero del array", () => {
    const saldo = 100_000_000n;
    const tramos = [
      { desde: "2026-03-01", tasaAnual: "48" },
      { desde: "2026-02-01", tasaAnual: "36" },
    ];

    const interes = interesMora(saldo, "2026-01-01", "2026-01-15", tramos, 0);

    expect(interes).toBe(interesMora(saldo, "2026-01-01", "2026-01-15", [{ desde: "2026-02-01", tasaAnual: "36" }], 0));
  });
});

describe("aging", () => {
  it.each([
    [0, "0-30"],
    [30, "0-30"],
    [31, "31-60"],
    [60, "31-60"],
    [61, "61-90"],
    [90, "61-90"],
    [91, "90+"],
  ] as const)("%i días de atraso → %s", (dias, esperado) => {
    expect(aging(dias)).toBe(esperado);
  });
});
