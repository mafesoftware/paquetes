import { describe, expect, it } from "vitest";
import { ErrorPeriodoCerrado, exigirPeriodoAbierto, periodosMensualesDe, primerDiaDelMes } from "../src/periodos.js";

describe("primerDiaDelMes", () => {
  it("devuelve el primer día del mes de cualquier fecha", () => {
    expect(primerDiaDelMes("2026-08-31")).toBe("2026-08-01");
    expect(primerDiaDelMes("2026-08-01")).toBe("2026-08-01");
  });
});

describe("periodosMensualesDe", () => {
  it("arma los 12 períodos mensuales desde el mes de inicio", () => {
    expect(periodosMensualesDe("2026-01-15")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ]);
  });

  it("cruza el año cuando el ejercicio no arranca en enero", () => {
    const periodos = periodosMensualesDe("2026-07-01");
    expect(periodos[0]).toBe("2026-07-01");
    expect(periodos[5]).toBe("2026-12-01");
    expect(periodos[6]).toBe("2027-01-01");
    expect(periodos[11]).toBe("2027-06-01");
  });
});

describe("exigirPeriodoAbierto", () => {
  it("no tira con estado abierto", () => {
    expect(() => exigirPeriodoAbierto("abierto", "2026-08-15")).not.toThrow();
  });

  it("tira ErrorPeriodoCerrado con estado cerrado", () => {
    expect(() => exigirPeriodoAbierto("cerrado", "2026-08-15")).toThrow(ErrorPeriodoCerrado);
  });

  it("el error trae el primer día del mes y el código de negocio en el mensaje", () => {
    let capturado: ErrorPeriodoCerrado | null = null;
    try {
      exigirPeriodoAbierto("cerrado", "2026-08-15");
    } catch (e) {
      capturado = e as ErrorPeriodoCerrado;
    }
    expect(capturado).toBeInstanceOf(ErrorPeriodoCerrado);
    expect(capturado?.periodo).toBe("2026-08-01");
    expect(capturado?.message).toBe("periodo_cerrado");
  });
});
