import { describe, expect, it } from "vitest";
import { ErrorFecha } from "@mafesoftware/fechas-ar";
import { ErrorIndices } from "../src/errores.js";
import { periodoReferencia } from "../src/periodo-referencia.js";

describe("periodoReferencia", () => {
  it("caso del brief: desfase de 2 meses desde 2026-09-10 -> 2026-07", () => {
    expect(periodoReferencia("2026-09-10", { tipo: "desfase", meses: 2 }, null)).toBe("2026-07");
  });

  it("desfase de 0 meses: el mismo período del vencimiento", () => {
    expect(periodoReferencia("2026-09-10", { tipo: "desfase", meses: 0 }, null)).toBe("2026-09");
  });

  it("desfase que cruza el año", () => {
    expect(periodoReferencia("2026-01-15", { tipo: "desfase", meses: 2 }, null)).toBe("2025-11");
  });

  it("ultimo_publicado sin nada publicado todavía: null", () => {
    expect(periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, null)).toBeNull();
  });

  it("ultimo_publicado con algo publicado: devuelve ese período tal cual, sin tocar el vencimiento", () => {
    expect(periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, "2026-08")).toBe("2026-08");
  });

  it("meses negativo tira ErrorIndices (regla_invalida)", () => {
    expect(() => periodoReferencia("2026-09-10", { tipo: "desfase", meses: -1 }, null)).toThrow(ErrorIndices);
    try {
      periodoReferencia("2026-09-10", { tipo: "desfase", meses: -1 }, null);
    } catch (e) {
      expect((e as ErrorIndices).codigo).toBe("regla_invalida");
    }
  });

  it("meses no entero tira ErrorIndices (regla_invalida)", () => {
    expect(() => periodoReferencia("2026-09-10", { tipo: "desfase", meses: 1.5 }, null)).toThrow(ErrorIndices);
  });

  it("vencimiento con formato roto propaga ErrorFecha", () => {
    expect(() => periodoReferencia("2026-13-01", { tipo: "desfase", meses: 1 }, null)).toThrow(ErrorFecha);
  });
});
