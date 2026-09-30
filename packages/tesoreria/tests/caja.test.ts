import { describe, expect, it } from "vitest";
import { decidirEgreso, fechaBloqueadaPorCierre } from "../src/caja.js";

describe("decidirEgreso", () => {
  it("caja que NO permite negativo, egreso mayor al saldo → error con saldo disponible", () => {
    const resultado = decidirEgreso(10_000n, 15_000n, false);
    expect(resultado).toEqual({ ok: false, error: expect.any(String), saldoDisponible: 10_000n });
  });

  it("caja que NO permite negativo, egreso igual al saldo → ok (queda en cero, no negativo)", () => {
    expect(decidirEgreso(10_000n, 10_000n, false)).toEqual({ ok: true });
  });

  it("caja que permite negativo → ok aunque el egreso supere el saldo", () => {
    expect(decidirEgreso(10_000n, 50_000n, true)).toEqual({ ok: true });
  });
});

describe("fechaBloqueadaPorCierre", () => {
  it("fecha anterior al último cierre → bloqueada", () => {
    expect(fechaBloqueadaPorCierre("2026-08-31", "2026-09-15")).toBe(true);
  });

  it("fecha igual al cierre → bloqueada (el cierre incluye ese día)", () => {
    expect(fechaBloqueadaPorCierre("2026-09-15", "2026-09-15")).toBe(true);
  });

  it("fecha posterior al cierre → no bloqueada", () => {
    expect(fechaBloqueadaPorCierre("2026-09-16", "2026-09-15")).toBe(false);
  });

  it("caja nunca cerrada (null) → nunca bloqueada", () => {
    expect(fechaBloqueadaPorCierre("2020-01-01", null)).toBe(false);
  });
});
