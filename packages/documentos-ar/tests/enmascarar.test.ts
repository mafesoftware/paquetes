import { describe, expect, it } from "vitest";
import { enmascarar } from "../src/enmascarar.ts";

describe("enmascarar", () => {
  it("el ejemplo del brief: CBU con 4 visibles por defecto", () => {
    expect(enmascarar("2850590940090418135201")).toBe("******************5201");
  });

  it("acepta un `visibles` explícito", () => {
    expect(enmascarar("12345678", 2)).toBe("******78");
  });

  it("devuelve el valor tal cual si no llega a `visibles`", () => {
    expect(enmascarar("123", 4)).toBe("123");
  });

  it("devuelve el valor tal cual si mide exactamente `visibles`", () => {
    expect(enmascarar("1234", 4)).toBe("1234");
  });

  it("enmascara entero con visibles <= 0", () => {
    expect(enmascarar("1234", 0)).toBe("****");
    expect(enmascarar("1234", -1)).toBe("****");
  });

  it("con string vacío devuelve string vacío", () => {
    expect(enmascarar("", 4)).toBe("");
  });
});
