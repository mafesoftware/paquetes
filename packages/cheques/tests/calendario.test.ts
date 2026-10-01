import { describe, expect, it } from "vitest";
import { proyeccionSaldoBancario } from "../src/calendario.js";

describe("proyeccionSaldoBancario", () => {
  it("banco hoy 5.000.000, tercero 2.000.000 al 15/10/2026, propio −500.000 al 30/11/2026", () => {
    const saldoHoy = 500_000_00n; // $5.000.000 en centavos
    const resultado = proyeccionSaldoBancario(
      saldoHoy,
      [
        { fecha: "2026-10-15", importe: 200_000_00n, tipo: "tercero_a_cobrar" },
        { fecha: "2026-11-30", importe: 50_000_00n, tipo: "propio_a_debitar" },
      ],
      "2026-12-31"
    );

    expect(resultado).toEqual([
      { fecha: "2026-10-15", saldo: 700_000_00n },
      { fecha: "2026-11-30", saldo: 650_000_00n },
    ]);
  });

  it("eventos posteriores a `hasta` no entran en la proyección", () => {
    const resultado = proyeccionSaldoBancario(
      1_000_00n,
      [{ fecha: "2027-01-01", importe: 500_00n, tipo: "tercero_a_cobrar" }],
      "2026-12-31"
    );
    expect(resultado).toEqual([]);
  });
});
