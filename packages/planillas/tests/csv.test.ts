import { describe, expect, it } from "vitest";
import { filasACsv } from "../src/csv.js";

describe("filasACsv", () => {
  it("separa con ';' y antepone el BOM UTF-8 por default", () => {
    const csv = filasACsv(["Código", "Nombre"], [["1", "Cemento"]]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Código;Nombre\n1;Cemento");
  });

  it("bom: false no antepone nada", () => {
    const csv = filasACsv(["a"], [["1"]], { bom: false });

    expect(csv.startsWith("﻿")).toBe(false);
    expect(csv).toBe("a\n1");
  });

  it("envuelve entre comillas una celda con ';', comillas o salto de línea (RFC 4180)", () => {
    const csv = filasACsv(["a"], [["uno;dos"], ['con "comillas"'], ["con\nsalto"]], { bom: false });

    expect(csv).toBe('a\n"uno;dos"\n"con ""comillas"""\n"con\nsalto"');
  });

  it("una celda numérica normal no se toca ni se envuelve", () => {
    const csv = filasACsv(["monto"], [[1500]], { bom: false });

    expect(csv).toBe("monto\n1500");
  });

  describe("anti-inyección de fórmulas (default: activada)", () => {
    it.each(["=CMD()", "+1+1", "-1+1", "@SUM(A1)"])("antepone un apóstrofo a un texto que arranca con '%s'", (texto) => {
      const csv = filasACsv(["detalle"], [[texto]], { bom: false });

      expect(csv).toBe(`detalle\n'${texto}`);
    });

    it("NO toca un número negativo (no es una fórmula, aunque String(-5) empiece con '-')", () => {
      const csv = filasACsv(["monto"], [[-5]], { bom: false });

      expect(csv).toBe("monto\n-5");
    });

    it("un texto que no arranca con un carácter peligroso queda intacto", () => {
      const csv = filasACsv(["detalle"], [["Constructora SA"]], { bom: false });

      expect(csv).toBe("detalle\nConstructora SA");
    });

    it("antiInyeccion: false deja pasar la fórmula tal cual", () => {
      const csv = filasACsv(["detalle"], [["=CMD()"]], { bom: false, antiInyeccion: false });

      expect(csv).toBe("detalle\n=CMD()");
    });

    it("un apóstrofo antepuesto todavía respeta el escapado RFC 4180 si además tiene ';'", () => {
      const csv = filasACsv(["detalle"], [["=A;B"]], { bom: false });

      expect(csv).toBe('detalle\n"\'=A;B"');
    });
  });

  it("sin filas, arma solo la línea de encabezado", () => {
    const csv = filasACsv(["a", "b"], [], { bom: false });

    expect(csv).toBe("a;b");
  });
});
