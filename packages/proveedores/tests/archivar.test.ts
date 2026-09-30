import { describe, expect, it } from "vitest";
import { decidirArchivarProveedor } from "../src/archivar.js";

/** "archivar con saldo → confirmación explícita requerida". */
describe("decidirArchivarProveedor", () => {
  it("sin saldo pendiente → ok, aunque no venga confirmado", () => {
    expect(decidirArchivarProveedor({ tieneSaldoPendiente: false, confirmado: false })).toEqual({ ok: true });
  });

  it("con saldo pendiente y SIN confirmar → ok: false, pide confirmación explícita", () => {
    expect(decidirArchivarProveedor({ tieneSaldoPendiente: true, confirmado: false })).toEqual({
      ok: false,
      error: expect.any(String),
      requiereConfirmacion: true,
    });
  });

  it("con saldo pendiente y CONFIRMADO → ok: true", () => {
    expect(decidirArchivarProveedor({ tieneSaldoPendiente: true, confirmado: true })).toEqual({ ok: true });
  });
});
