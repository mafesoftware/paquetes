import { describe, expect, it } from "vitest";
import { transicionCheque } from "../src/estados.js";

describe("transicionCheque — tercero", () => {
  it("en_cartera + depositar → depositado", () => {
    expect(transicionCheque("tercero", "en_cartera", "depositar")).toBe("depositado");
  });

  it("depositado + acreditar → acreditado", () => {
    expect(transicionCheque("tercero", "depositado", "acreditar")).toBe("acreditado");
  });

  it("depositado + rechazar → rechazado", () => {
    expect(transicionCheque("tercero", "depositado", "rechazar")).toBe("rechazado");
  });

  it("en_cartera + endosar → endosado", () => {
    expect(transicionCheque("tercero", "en_cartera", "endosar")).toBe("endosado");
  });

  it("endosado + devolver_por_rechazo → rechazado", () => {
    expect(transicionCheque("tercero", "endosado", "devolver_por_rechazo")).toBe("rechazado");
  });

  it("en_cartera + descontar → descontado", () => {
    expect(transicionCheque("tercero", "en_cartera", "descontar")).toBe("descontado");
  });

  it("en_cartera ↔ custodia", () => {
    expect(transicionCheque("tercero", "en_cartera", "enviar_custodia")).toBe("custodia");
    expect(transicionCheque("tercero", "custodia", "retirar_custodia")).toBe("en_cartera");
  });

  it("acreditado + rechazar → error", () => {
    expect(transicionCheque("tercero", "acreditado", "rechazar")).toBeInstanceOf(Error);
  });

  it("endosado + depositar → error", () => {
    expect(transicionCheque("tercero", "endosado", "depositar")).toBeInstanceOf(Error);
  });
});

describe("transicionCheque — propio", () => {
  it("en_blanco + emitir → emitido", () => {
    expect(transicionCheque("propio", "en_blanco", "emitir")).toBe("emitido");
  });

  it("emitido + debitar → debitado", () => {
    expect(transicionCheque("propio", "emitido", "debitar")).toBe("debitado");
  });

  it("en_blanco + anular → anulado", () => {
    expect(transicionCheque("propio", "en_blanco", "anular")).toBe("anulado");
  });

  it("debitado + anular → error", () => {
    expect(transicionCheque("propio", "debitado", "anular")).toBeInstanceOf(Error);
  });
});
