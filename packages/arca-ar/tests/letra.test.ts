/**
 * La letra del comprobante: la tabla que todo el mundo se sabe de memoria
 * MAL. Acá está entera, para que la discusión sea con el test y no en el
 * mostrador.
 */

import { describe, expect, it } from "vitest";
import {
  ALICUOTAS_IVA,
  alicuotaPorId,
  CONDICION_IVA_ID,
  letraPara,
  tipoComprobante,
} from "../src/letra.js";

describe("letraPara", () => {
  it("inscripto a inscripto: A", () => {
    expect(letraPara("responsable_inscripto", "responsable_inscripto")).toBe("A");
  });

  it("inscripto a consumidor final, exento o monotributo: B", () => {
    expect(letraPara("responsable_inscripto", "consumidor_final")).toBe("B");
    expect(letraPara("responsable_inscripto", "exento")).toBe("B");
    expect(letraPara("responsable_inscripto", "monotributo")).toBe("B");
  });

  it("monotributista o exento: C siempre, hasta a un inscripto", () => {
    expect(letraPara("monotributo", "responsable_inscripto")).toBe("C");
    expect(letraPara("monotributo", "consumidor_final")).toBe("C");
    expect(letraPara("exento", "responsable_inscripto")).toBe("C");
  });

  it("un consumidor final no emite: los datos del emisor están mal", () => {
    expect(() => letraPara("consumidor_final", "consumidor_final")).toThrow();
  });
});

describe("tipoComprobante", () => {
  it("los códigos de ARCA por letra y clase", () => {
    expect(tipoComprobante("responsable_inscripto", "responsable_inscripto")).toEqual({
      letra: "A",
      codigo: 1,
    });
    expect(
      tipoComprobante("responsable_inscripto", "consumidor_final", "nota_credito")
    ).toEqual({ letra: "B", codigo: 8 });
    expect(tipoComprobante("monotributo", "consumidor_final")).toEqual({
      letra: "C",
      codigo: 11,
    });
    expect(tipoComprobante("monotributo", "consumidor_final", "nota_debito")).toEqual({
      letra: "C",
      codigo: 12,
    });
  });
});

describe("las tablas", () => {
  it("la condición de IVA del receptor tiene los ids de la RG 5616", () => {
    expect(CONDICION_IVA_ID.responsable_inscripto).toBe(1);
    expect(CONDICION_IVA_ID.consumidor_final).toBe(5);
    expect(CONDICION_IVA_ID.monotributo).toBe(6);
  });

  it("el 21% es el id 5 y la tasa va en puntos básicos", () => {
    expect(alicuotaPorId(5)).toEqual({ id: 5, nombre: "21%", puntosBasicos: 2100 });
    expect(alicuotaPorId(999)).toBeNull();
  });

  it("no hay ids de alícuota repetidos", () => {
    const ids = ALICUOTAS_IVA.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
