import { describe, expect, it } from "vitest";
import { agruparPorAging, promesaPendienteVencida } from "../src/cobranza.js";

describe("agruparPorAging", () => {
  it("agrupa cantidad y deuda vencida Σ por moneda, banda por banda", () => {
    const filas = [
      { aging: "0-30" as const, deudaVencida: { ARS: 100_00n } },
      { aging: "0-30" as const, deudaVencida: { ARS: 200_00n } },
      { aging: "31-60" as const, deudaVencida: { USD: 50_00n } },
      { aging: "90+" as const, deudaVencida: { ARS: 10_00n, USD: 5_00n } },
    ];

    const resumen = agruparPorAging(filas);

    expect(resumen["0-30"]).toEqual({ cantidad: 2, deudaVencida: { ARS: 300_00n } });
    expect(resumen["31-60"]).toEqual({ cantidad: 1, deudaVencida: { USD: 50_00n } });
    expect(resumen["61-90"]).toEqual({ cantidad: 0, deudaVencida: {} });
    expect(resumen["90+"]).toEqual({ cantidad: 1, deudaVencida: { ARS: 10_00n, USD: 5_00n } });
  });

  it("sin filas: las 4 bandas en cero", () => {
    const resumen = agruparPorAging([]);
    expect(Object.keys(resumen)).toHaveLength(4);
    expect(resumen["0-30"]).toEqual({ cantidad: 0, deudaVencida: {} });
  });
});

describe("promesaPendienteVencida", () => {
  const HOY = "2026-03-15"; // reloj fijo

  it("promesa con fecha ANTERIOR a hoy → vencida", () => {
    const gestiones = [{ tipo: "promesa_pago" as const, fechaPromesa: "2026-03-01", creadoEn: "2026-02-20" }];
    expect(promesaPendienteVencida(gestiones, HOY)).toBe(true);
  });

  it("promesa con fecha FUTURA → no vencida todavía", () => {
    const gestiones = [{ tipo: "promesa_pago" as const, fechaPromesa: "2026-04-01", creadoEn: "2026-02-20" }];
    expect(promesaPendienteVencida(gestiones, HOY)).toBe(false);
  });

  it("sin ninguna promesa_pago (solo llamadas/notas) → no hay alerta", () => {
    const gestiones = [
      { tipo: "llamada" as const, fechaPromesa: null, creadoEn: "2026-02-20" },
      { tipo: "nota" as const, fechaPromesa: null, creadoEn: "2026-03-01" },
    ];
    expect(promesaPendienteVencida(gestiones, HOY)).toBe(false);
  });

  it("dos promesas: cuenta la MÁS RECIENTE por creadoEn, no la primera del array", () => {
    const gestiones = [
      { tipo: "promesa_pago" as const, fechaPromesa: "2026-02-01", creadoEn: "2026-01-10" }, // vieja, ya vencida, pero reemplazada
      { tipo: "promesa_pago" as const, fechaPromesa: "2026-04-01", creadoEn: "2026-03-05" }, // la vigente: futura
    ];
    expect(promesaPendienteVencida(gestiones, HOY)).toBe(false);
  });

  it("la MÁS RECIENTE viene PRIMERO en el array: no la reemplaza una posterior más vieja", () => {
    const gestiones = [
      { tipo: "promesa_pago" as const, fechaPromesa: "2026-04-01", creadoEn: "2026-03-05" }, // la vigente: futura
      { tipo: "promesa_pago" as const, fechaPromesa: "2026-02-01", creadoEn: "2026-01-10" }, // vieja, aparece después pero no reemplaza
    ];
    expect(promesaPendienteVencida(gestiones, HOY)).toBe(false);
  });
});
