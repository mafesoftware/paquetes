import { describe, expect, it } from "vitest";
import { exclusionVigente } from "../src/exclusiones.js";
import type { Exclusion } from "../src/tipos.js";

const EXCLUSION_100_JUL_DIC_2026: Exclusion = {
  regimen: "iva",
  porcentaje: "100",
  desde: "2026-07-01",
  hasta: "2026-12-31",
  certificado: "AFIP-CERT-0001",
};

describe("exclusionVigente", () => {
  it("dentro del rango (01/07–31/12/2026) → la devuelve (brief)", () => {
    expect(exclusionVigente([EXCLUSION_100_JUL_DIC_2026], "iva", "2026-09-15")).toEqual(EXCLUSION_100_JUL_DIC_2026);
  });

  it("fuera del rango (2027-01-02) → null (brief)", () => {
    expect(exclusionVigente([EXCLUSION_100_JUL_DIC_2026], "iva", "2027-01-02")).toBeNull();
  });

  it("otro régimen, misma fecha → null (no cruza regímenes)", () => {
    expect(exclusionVigente([EXCLUSION_100_JUL_DIC_2026], "ganancias", "2026-09-15")).toBeNull();
  });

  it("bordes inclusive: primer y último día vigentes", () => {
    expect(exclusionVigente([EXCLUSION_100_JUL_DIC_2026], "iva", "2026-07-01")).toEqual(EXCLUSION_100_JUL_DIC_2026);
    expect(exclusionVigente([EXCLUSION_100_JUL_DIC_2026], "iva", "2026-12-31")).toEqual(EXCLUSION_100_JUL_DIC_2026);
  });
});
