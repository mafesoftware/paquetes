import { describe, expect, it } from "vitest";
import { claveCuenta, claveIp } from "../src/claves.js";
import { ErrorLimiteIntentos } from "../src/errores.js";

describe("claveCuenta", () => {
  it("prefija con \"cuenta:\"", () => {
    expect(claveCuenta("ana@club.com")).toBe("cuenta:ana@club.com");
  });

  it("baja a minúsculas y recorta espacios", () => {
    expect(claveCuenta("  Ana@Club.com ")).toBe("cuenta:ana@club.com");
  });

  it("dos variantes de mayúsculas/espacios dan la MISMA clave", () => {
    expect(claveCuenta("Ana@Club.com")).toBe(claveCuenta("ana@club.com  "));
  });

  it('email vacío o solo espacios tira ErrorLimiteIntentos("opciones_invalidas")', () => {
    expect(() => claveCuenta("")).toThrow(ErrorLimiteIntentos);
    expect(() => claveCuenta("   ")).toThrow(ErrorLimiteIntentos);
    try {
      claveCuenta("");
    } catch (error) {
      expect(error).toMatchObject({ name: "ErrorLimiteIntentos", codigo: "opciones_invalidas" });
    }
  });
});

describe("claveIp", () => {
  it("prefija con \"ip:\"", () => {
    expect(claveIp("203.0.113.7")).toBe("ip:203.0.113.7");
  });

  it("recorta espacios pero NO cambia mayúsculas (una IPv6 en hex mantiene su forma)", () => {
    expect(claveIp("  2001:DB8::1  ")).toBe("ip:2001:DB8::1");
  });

  it('ip vacía o solo espacios tira ErrorLimiteIntentos("opciones_invalidas")', () => {
    expect(() => claveIp("")).toThrow(ErrorLimiteIntentos);
    expect(() => claveIp("   ")).toThrow(ErrorLimiteIntentos);
  });

  it("claveCuenta y claveIp del mismo texto dan claves DISTINTAS (espacios de nombres separados)", () => {
    expect(claveCuenta("203.0.113.7")).not.toBe(claveIp("203.0.113.7"));
  });
});
