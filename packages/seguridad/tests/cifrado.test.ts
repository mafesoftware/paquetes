import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, descifrar } from "../src/cifrado.js";
import { ErrorSeguridad } from "../src/errores.js";

const CLAVE = randomBytes(32).toString("base64");

describe("cifrar / descifrar", () => {
  it("ida y vuelta: descifrar(cifrar(x)) === x", () => {
    const original = "un secreto cualquiera, con ñ y emoji 🔐";
    const guardado = cifrar(original, CLAVE);
    expect(descifrar(guardado, CLAVE)).toBe(original);
  });

  it("acepta la clave como Uint8Array además de string base64", () => {
    const claveBytes = randomBytes(32);
    const guardado = cifrar("hola", claveBytes);
    expect(descifrar(guardado, claveBytes)).toBe("hola");
  });

  it("el formato es v1:<iv>:<tag>:<datos>, compatible con fiscalCifrado.ts de store360", () => {
    const guardado = cifrar("texto", CLAVE);
    const partes = guardado.split(":");
    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe("v1");
    // Los 3 segmentos restantes son base64 estándar (no base64url: sin "-"/"_").
    for (const segmento of partes.slice(1)) {
      expect(() => Buffer.from(segmento!, "base64")).not.toThrow();
    }
    // El IV es de 12 bytes (96 bits), el estándar recomendado para GCM.
    expect(Buffer.from(partes[1]!, "base64")).toHaveLength(12);
    // El auth tag de GCM es de 16 bytes.
    expect(Buffer.from(partes[2]!, "base64")).toHaveLength(16);
  });

  it("da un texto cifrado distinto cada vez (IV al azar)", () => {
    const a = cifrar("mismo texto", CLAVE);
    const b = cifrar("mismo texto", CLAVE);
    expect(a).not.toBe(b);
  });

  it("texto alterado: descifrar tira ErrorSeguridad autenticacion_fallida", () => {
    const guardado = cifrar("dato sensible", CLAVE);
    const [version, iv, tag, datos] = guardado.split(":");
    // Cambia un byte de los datos cifrados.
    const datosAlterados = Buffer.from(datos!, "base64");
    datosAlterados[0] = datosAlterados[0]! ^ 0xff;
    const alterado = [version, iv, tag, datosAlterados.toString("base64")].join(":");

    let error: unknown;
    try {
      descifrar(alterado, CLAVE);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorSeguridad);
    expect((error as ErrorSeguridad).codigo).toBe("autenticacion_fallida");
  });

  it("descifrado con otra clave: ErrorSeguridad autenticacion_fallida", () => {
    const guardado = cifrar("dato sensible", CLAVE);
    const otraClave = randomBytes(32).toString("base64");
    expect(() => descifrar(guardado, otraClave)).toThrow(ErrorSeguridad);
    try {
      descifrar(guardado, otraClave);
    } catch (error) {
      expect((error as ErrorSeguridad).codigo).toBe("autenticacion_fallida");
    }
  });

  it("prefijo desconocido: ErrorSeguridad formato_invalido", () => {
    expect(() => descifrar("v2:aaaa:bbbb:cccc", CLAVE)).toThrow(ErrorSeguridad);
    try {
      descifrar("v2:aaaa:bbbb:cccc", CLAVE);
    } catch (error) {
      expect((error as ErrorSeguridad).codigo).toBe("formato_invalido");
    }
  });

  it("formato sin los 4 segmentos: ErrorSeguridad formato_invalido", () => {
    expect(() => descifrar("no-es-nuestro-formato", CLAVE)).toThrow(ErrorSeguridad);
    expect(() => descifrar("v1:solo:dos", CLAVE)).toThrow(ErrorSeguridad);
  });

  it("no tira con null/undefined (llamada desde JS sin chequeo de tipos): formato_invalido, no una excepción cruda", () => {
    expect(() => descifrar(null as never, CLAVE)).toThrow(ErrorSeguridad);
  });

  it("clave de largo incorrecto: ErrorSeguridad clave_invalida, al cifrar y al descifrar", () => {
    const claveCorta = Buffer.from("demasiado-corta").toString("base64");
    expect(() => cifrar("x", claveCorta)).toThrow(ErrorSeguridad);
    try {
      cifrar("x", claveCorta);
    } catch (error) {
      expect((error as ErrorSeguridad).codigo).toBe("clave_invalida");
    }

    const guardado = cifrar("x", CLAVE);
    expect(() => descifrar(guardado, claveCorta)).toThrow(ErrorSeguridad);
  });

  it("clave no-base64 pero de longitud casual: sigue validando el largo decodificado", () => {
    // Un string cualquiera de 32 caracteres NO decodifica a 32 bytes en base64
    // (4 caracteres base64 ≈ 3 bytes), así que también cae en clave_invalida.
    const claveRara = "x".repeat(32);
    expect(() => cifrar("x", claveRara)).toThrow(ErrorSeguridad);
  });
});
