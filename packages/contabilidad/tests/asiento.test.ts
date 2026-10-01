import { describe, expect, it } from "vitest";
import { balancea, espejo, type Asiento, type LineaAsiento } from "../src/asiento.js";

function linea(p: Partial<LineaAsiento> & { cuentaId: string }): LineaAsiento {
  return {
    debe: 0n,
    haber: 0n,
    moneda: "ARS",
    importeOriginal: 0n,
    tc: null,
    proyectoId: null,
    centroCostoId: null,
    detalle: "",
    ...p,
  };
}

function asiento(lineas: LineaAsiento[], extra?: Partial<Asiento>): Asiento {
  return {
    fecha: "2026-10-01",
    libro: "A",
    tipo: "manual",
    origen: null,
    leyenda: "Test",
    lineas,
    ...extra,
  };
}

describe("balancea", () => {
  it("true cuando Σ debe === Σ haber", () => {
    const a = asiento([linea({ cuentaId: "caja", debe: 1000n }), linea({ cuentaId: "ventas", haber: 1000n })]);
    expect(balancea(a)).toBe(true);
  });

  it("false cuando no coinciden", () => {
    const a = asiento([linea({ cuentaId: "caja", debe: 1000n }), linea({ cuentaId: "ventas", haber: 999n })]);
    expect(balancea(a)).toBe(false);
  });

  it("true para un asiento sin líneas (0 === 0)", () => {
    expect(balancea(asiento([]))).toBe(true);
  });

  it("suma varias líneas del mismo lado", () => {
    const a = asiento([
      linea({ cuentaId: "caja", debe: 600n }),
      linea({ cuentaId: "banco", debe: 400n }),
      linea({ cuentaId: "ventas", haber: 1000n }),
    ]);
    expect(balancea(a)).toBe(true);
  });
});

describe("espejo", () => {
  it("invierte debe y haber de cada línea", () => {
    const original = asiento([linea({ cuentaId: "caja", debe: 1000n }), linea({ cuentaId: "ventas", haber: 1000n })], {
      leyenda: "Cobro factura 1",
    });
    const anulacion = espejo(original, "2026-10-15", { tipo: "cobro_anulado", id: "doc-1" });

    expect(anulacion.lineas).toEqual([
      expect.objectContaining({ cuentaId: "caja", debe: 0n, haber: 1000n }),
      expect.objectContaining({ cuentaId: "ventas", debe: 1000n, haber: 0n }),
    ]);
    expect(anulacion.fecha).toBe("2026-10-15");
    expect(anulacion.origen).toEqual({ tipo: "cobro_anulado", id: "doc-1" });
    expect(anulacion.leyenda).toBe("Anulación — Cobro factura 1");
    expect(anulacion.tipo).toBe("automatico");
    expect(balancea(anulacion)).toBe(true);
  });

  it("preserva libro, moneda e importe original de cada línea", () => {
    const original = asiento([linea({ cuentaId: "caja-usd", debe: 1300n, moneda: "USD", importeOriginal: 10n, tc: "130" })], {
      libro: "B",
    });
    const anulacion = espejo(original, "2026-10-15", { tipo: "x", id: "1" });
    expect(anulacion.libro).toBe("B");
    expect(anulacion.lineas[0]).toMatchObject({ moneda: "USD", importeOriginal: 10n, tc: "130" });
  });
});
