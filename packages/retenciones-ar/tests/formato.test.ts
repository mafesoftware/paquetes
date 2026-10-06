import { describe, expect, it } from "vitest";
import {
  aBufferLatin1,
  alicuotaCorta,
  anchoFijo,
  armarContenido,
  cuitConGuiones,
  cuitSinGuiones,
  fechaBarras,
  fechaCompacta,
  filaDelimitada,
  importeConComa,
  importeSinComaAncho,
  numeroFijo,
  porcentajeConComa,
  soloDigitos,
} from "../src/formato.js";

describe("anchoFijo", () => {
  it("rellena a la derecha (izquierda por defecto) con espacios", () => {
    expect(anchoFijo("abc", 6)).toBe("abc   ");
  });

  it("alinear derecha, relleno custom", () => {
    expect(anchoFijo("abc", 6, { relleno: "0", alinear: "derecha" })).toBe("000abc");
  });

  it("corta si el valor es más largo que el ancho", () => {
    expect(anchoFijo("abcdefgh", 4)).toBe("abcd");
  });

  it("valor ya del ancho exacto → no agrega relleno (faltan === 0)", () => {
    expect(anchoFijo("abcd", 4)).toBe("abcd");
  });
});

describe("numeroFijo", () => {
  it("numérico alineado a la derecha con ceros", () => {
    expect(numeroFijo("42", 5)).toBe("00042");
  });
});

describe("soloDigitos", () => {
  it("descarta todo lo que no sea dígito", () => {
    expect(soloDigitos("20-30405060-7")).toBe("20304050607");
  });

  it("null/undefined → cadena vacía", () => {
    expect(soloDigitos(null)).toBe("");
    expect(soloDigitos(undefined)).toBe("");
  });
});

describe("cuitSinGuiones", () => {
  it("quita guiones y deja 11 dígitos", () => {
    expect(cuitSinGuiones("20-30405060-7")).toBe("20304050607");
  });

  it("null → 11 ceros (numeroFijo rellena)", () => {
    expect(cuitSinGuiones(null)).toBe("00000000000");
  });
});

describe("cuitConGuiones", () => {
  it("formatea 11 dígitos con guiones (brief)", () => {
    expect(cuitConGuiones("20304050607")).toBe("20-30405060-7");
  });

  it("idempotente si el cuit ya viene con guiones", () => {
    expect(cuitConGuiones("20-30405060-7")).toBe("20-30405060-7");
  });

  it("null → formato válido con ceros", () => {
    expect(cuitConGuiones(null)).toMatch(/^\d{2}-\d{8}-\d{1}$/);
  });
});

describe("fechaCompacta", () => {
  it("AAAA-MM-DD → AAAAMMDD", () => {
    expect(fechaCompacta("2026-09-15")).toBe("20260915");
  });
});

describe("fechaBarras", () => {
  it("AAAA-MM-DD → DD/MM/AAAA", () => {
    expect(fechaBarras("2026-09-15")).toBe("15/09/2026");
  });
});

describe("importeSinComaAncho", () => {
  it("centavos a dígitos con ancho fijo", () => {
    expect(importeSinComaAncho(100n, 10)).toBe("0000000100");
  });

  it("negativo → tira (un importe fiscal nunca es negativo)", () => {
    expect(() => importeSinComaAncho(-1n, 5)).toThrow(/negativo/);
  });
});

describe("importeConComa", () => {
  it("centavos a decimal con coma", () => {
    expect(importeConComa(123456n)).toBe("1234,56");
  });

  it("negativo → tira", () => {
    expect(() => importeConComa(-1n)).toThrow(/negativo/);
  });
});

describe("porcentajeConComa", () => {
  it("brief: \"60\" → \"060,00\"", () => {
    expect(porcentajeConComa("60")).toBe("060,00");
  });

  it("null/undefined → \"000,00\" (sin exclusión)", () => {
    expect(porcentajeConComa(null)).toBe("000,00");
    expect(porcentajeConComa(undefined)).toBe("000,00");
  });

  it("con decimales", () => {
    expect(porcentajeConComa("12.5")).toBe("012,50");
  });
});

describe("alicuotaCorta", () => {
  it("\"2.50\" → \"02,50\"", () => {
    expect(alicuotaCorta("2.50")).toBe("02,50");
  });

  it("dos dígitos enteros", () => {
    expect(alicuotaCorta("10.5")).toBe("10,50");
  });
});

describe("armarContenido", () => {
  it("une líneas con CRLF + CRLF final", () => {
    expect(armarContenido(["A", "B"])).toBe("A\r\nB\r\n");
  });

  it("sin líneas → cadena vacía", () => {
    expect(armarContenido([])).toBe("");
  });
});

describe("filaDelimitada", () => {
  it("une celdas con \";\"", () => {
    expect(filaDelimitada(["a", "b", "c"])).toBe("a;b;c");
  });
});

describe("aBufferLatin1", () => {
  it("codifica el contenido como latin1", () => {
    const buffer = aBufferLatin1("hola");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString("latin1")).toBe("hola");
  });
});
