import { describe, expect, it } from "vitest";
import { subtotalItem, totalesDeItems, totalPercepciones, validarTotalDocumento } from "../src/totales.js";

describe("totalesDeItems", () => {
  it("dos ítems a distinta alícuota: Σ subtotal + Σ IVA", () => {
    const totales = totalesDeItems([
      { cantidad: "1", precioUnitarioCentavos: 100_000n, alicuotaIva: "21" }, // sub 100.000, iva 21.000
      { cantidad: "2", precioUnitarioCentavos: 25_000n, alicuotaIva: "10_5" }, // sub 50.000, iva 5.250
    ]);
    expect(totales).toEqual({ subtotal: 150_000n, iva: 26_250n });
  });

  it("cantidad no entera (2,5 × $100,00)", () => {
    expect(subtotalItem("2.5", 10_000n)).toBe(25_000n);
  });
});

describe("totalPercepciones", () => {
  it("suma percepciones de IVA + IIBB + otras (centavos en string)", () => {
    const total = totalPercepciones([
      { tipo: "iva", centavos: "5000" },
      { tipo: "iibb", centavos: "1200" },
      { tipo: "otras", centavos: "300" },
    ]);
    expect(total).toBe(6_500n);
  });
});

describe("validarTotalDocumento", () => {
  it("total informado igual al calculado → ok, ajuste 0", () => {
    expect(validarTotalDocumento(121_000n, 121_000n)).toEqual({ ok: true, ajuste: 0n });
  });

  it("diferencia de $0,50 (dentro de la tolerancia de $1) → ok, con el ajuste explícito", () => {
    expect(validarTotalDocumento(121_000n, 121_050n)).toEqual({ ok: true, ajuste: 50n });
  });

  it("diferencia de exactamente $1 → ok (límite inclusive)", () => {
    expect(validarTotalDocumento(121_000n, 121_100n)).toEqual({ ok: true, ajuste: 100n });
  });

  it("diferencia mayor a $1 → error, con la diferencia real", () => {
    expect(validarTotalDocumento(121_000n, 121_200n)).toEqual({ ok: false, diferencia: 200n });
  });

  it("diferencia negativa (informado por debajo del calculado) mayor a $1 → error", () => {
    expect(validarTotalDocumento(121_000n, 120_500n)).toEqual({ ok: false, diferencia: -500n });
  });
});
