import { describe, expect, it } from "vitest";
import { ajustePorRT6, coeficienteRT6 } from "../src/rt6.js";

describe("coeficienteRT6", () => {
  it("IPC ene-2026 100 → dic-2026 130: coeficiente 1,3", () => {
    expect(coeficienteRT6("100", "130")).toBe("1.3");
  });

  it("IPC dic-2025 97 → dic-2026 130: coeficiente 1,34020619 (caso del brief)", () => {
    expect(coeficienteRT6("97", "130")).toBe("1.34020619");
  });
});

describe("ajustePorRT6", () => {
  it("bien de uso 1.000.000 (ene, IPC 100) + capital 1.000.000 (dic-2025, IPC 97), cierre dic-2026 IPC 130 → D 1.2.1 300.000, D 5.7 40.206,19 / H 3.1.2 340.206,19 (caso del brief)", () => {
    const resultado = ajustePorRT6(
      [
        { cuentaId: "1.2.1", esPatrimonioNeto: false, valorHistorico: 1_000_000_00n, indiceOrigen: "100", indiceCierre: "130" },
        { cuentaId: "3.1.2", esPatrimonioNeto: true, valorHistorico: 1_000_000_00n, indiceOrigen: "97", indiceCierre: "130" },
      ],
      "5.7"
    );

    expect(resultado.detalle).toEqual([
      { cuentaId: "1.2.1", coeficiente: "1.3", ajuste: 300_000_00n },
      { cuentaId: "3.1.2", coeficiente: "1.34020619", ajuste: 340_206_19n },
    ]);

    expect(resultado.lineas).toEqual([
      { cuentaId: "1.2.1", debe: 300_000_00n, haber: 0n, detalle: "RT 6 — reexpresión por inflación" },
      { cuentaId: "3.1.2", debe: 0n, haber: 340_206_19n, detalle: "RT 6 — reexpresión por inflación" },
      { cuentaId: "5.7", debe: 40_206_19n, haber: 0n, detalle: "RT 6 — resultado por exposición a la inflación (REI)" },
    ]);

    const debe = resultado.lineas.reduce((a, l) => a + l.debe, 0n);
    const haber = resultado.lineas.reduce((a, l) => a + l.haber, 0n);
    expect(debe).toBe(haber);
  });

  it("índice sin variación (coeficiente 1) → ajuste 0, sin línea para ese rubro", () => {
    const resultado = ajustePorRT6([{ cuentaId: "1.2.1", esPatrimonioNeto: false, valorHistorico: 1_000_000_00n, indiceOrigen: "100", indiceCierre: "100" }], "5.7");
    expect(resultado.detalle).toEqual([{ cuentaId: "1.2.1", coeficiente: "1", ajuste: 0n }]);
    expect(resultado.lineas).toEqual([]);
  });

  it("un solo rubro de activo ajustado, sin PN → el REI absorbe todo el ajuste (balancea)", () => {
    const resultado = ajustePorRT6([{ cuentaId: "1.2.1", esPatrimonioNeto: false, valorHistorico: 500_000_00n, indiceOrigen: "100", indiceCierre: "120" }], "5.7");
    expect(resultado.lineas).toEqual([
      { cuentaId: "1.2.1", debe: 100_000_00n, haber: 0n, detalle: "RT 6 — reexpresión por inflación" },
      { cuentaId: "5.7", debe: 0n, haber: 100_000_00n, detalle: "RT 6 — resultado por exposición a la inflación (REI)" },
    ]);
    const debe = resultado.lineas.reduce((a, l) => a + l.debe, 0n);
    const haber = resultado.lineas.reduce((a, l) => a + l.haber, 0n);
    expect(debe).toBe(haber);
  });
});
