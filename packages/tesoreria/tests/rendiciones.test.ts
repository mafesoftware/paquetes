import { describe, expect, it } from "vitest";
import { puedeAprobarRendicion, puedeRechazarRendicion, puedeReponerRendicion } from "../src/rendiciones.js";

describe("ciclo de una rendición (cargado → aprobado → repuesto)", () => {
  it("solo se aprueba desde cargado", () => {
    expect(puedeAprobarRendicion("cargado")).toBe(true);
    expect(puedeAprobarRendicion("aprobado")).toBe(false);
    expect(puedeAprobarRendicion("repuesto")).toBe(false);
  });

  it("se rechaza desde cargado o aprobado, no desde rechazado ni repuesto", () => {
    expect(puedeRechazarRendicion("cargado")).toBe(true);
    expect(puedeRechazarRendicion("aprobado")).toBe(true);
    expect(puedeRechazarRendicion("rechazado")).toBe(false);
    expect(puedeRechazarRendicion("repuesto")).toBe(false);
  });

  it("solo se repone desde aprobado", () => {
    expect(puedeReponerRendicion("aprobado")).toBe(true);
    expect(puedeReponerRendicion("cargado")).toBe(false);
    expect(puedeReponerRendicion("repuesto")).toBe(false);
  });
});
