import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, descifrar } from "../src/cifrado.js";
import { ErrorSeguridad } from "../src/errores.js";

const CLAVE = randomBytes(32).toString("base64");

/** Descompone "v1:<iv>:<tag>:<datos>" en sus 4 segmentos, para adulterar uno a la vez en los tests. */
function partesDe(guardado: string) {
  const [version, iv, tag, datos] = guardado.split(":");
  return { version: version!, iv: iv!, tag: tag!, datos: datos! };
}

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

  describe("fix round 1 (C1): tag/IV con largo exacto, sin warning DEP0182", () => {
    it("un tag truncado (15/12/8/4 bytes) NO se acepta: formato_invalido, no descifra", () => {
      const guardado = cifrar("dato sensible", CLAVE);
      const { version, iv, tag, datos } = partesDe(guardado);
      const tagBytes = Buffer.from(tag, "base64");
      for (const largo of [15, 12, 8, 4]) {
        const tagTruncado = tagBytes.subarray(0, largo).toString("base64");
        const adulterado = [version, iv, tagTruncado, datos].join(":");
        expect(() => descifrar(adulterado, CLAVE)).toThrow(ErrorSeguridad);
        try {
          descifrar(adulterado, CLAVE);
        } catch (error) {
          expect((error as ErrorSeguridad).codigo).toBe("formato_invalido");
        }
      }
    });

    it("un IV de largo incorrecto (1 o 64 bytes) NO se acepta: formato_invalido", () => {
      const guardado = cifrar("dato sensible", CLAVE);
      const { version, tag, datos } = partesDe(guardado);
      for (const largoIv of [1, 64]) {
        const ivRaro = randomBytes(largoIv).toString("base64");
        const adulterado = [version, ivRaro, tag, datos].join(":");
        expect(() => descifrar(adulterado, CLAVE)).toThrow(ErrorSeguridad);
        try {
          descifrar(adulterado, CLAVE);
        } catch (error) {
          expect((error as ErrorSeguridad).codigo).toBe("formato_invalido");
        }
      }
    });

    it("no emite el warning DEP0182 de Node (tag truncado, cifrar/descifrar normal)", () => {
      const warnings: string[] = [];
      const onWarning = (w: Error & { code?: string }) => {
        if (w.code) warnings.push(w.code);
      };
      process.on("warning", onWarning);
      try {
        const guardado = cifrar("texto", CLAVE);
        descifrar(guardado, CLAVE);
        const { version, iv, tag, datos } = partesDe(guardado);
        const tagTruncado = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
        try {
          descifrar([version, iv, tagTruncado, datos].join(":"), CLAVE);
        } catch {
          // se espera que tire ErrorSeguridad — lo que se está midiendo es el warning, no esto.
        }
      } finally {
        process.off("warning", onWarning);
      }
      expect(warnings).not.toContain("DEP0182");
    });
  });

  describe("fix round 1 (M8): base64 estricto para la clave y para iv/tag/datos", () => {
    it("una clave en base64url (con '-'/'_') se rechaza: clave_invalida", () => {
      const claveEstandar = randomBytes(32).toString("base64");
      // Si la clave tuviera "+"/"/" para poder convertir a base64url; si no
      // (raro pero posible), el test igual prueba el camino con guiones/underscores
      // agregados a mano, que nunca son base64 estándar válido.
      const claveUrlSafe = `${claveEstandar.replace(/=+$/, "")}--__`;
      expect(() => cifrar("x", claveUrlSafe)).toThrow(ErrorSeguridad);
    });

    it("una clave con basura (espacios, símbolos) se rechaza: clave_invalida", () => {
      expect(() => cifrar("x", "no es base64 en absoluto!!")).toThrow(ErrorSeguridad);
    });

    it("una clave con relleno '=' en una posición no válida se rechaza", () => {
      // 32 'A' + "=" en el medio: charset ok pero estructura de relleno inválida.
      const claveConPaddingRoto = `${"A".repeat(16)}=${"A".repeat(15)}`;
      expect(() => cifrar("x", claveConPaddingRoto)).toThrow(ErrorSeguridad);
    });

    it("una clave con bits de relleno NO nulos se rechaza (mismo charset y estructura, no re-codifica igual)", () => {
      // "/x==" tiene el charset y la estructura de un base64 válido de 1
      // byte con relleno, y Node lo decodifica igual que "/w==" (mismo byte,
      // 0xFF) — pero los 2 bits de relleno de la "x" no son cero, así que
      // re-codificar el byte decodificado da "/w==", no "/x==". Eso es
      // exactamente lo que NO es "canónico": dos strings de entrada
      // distintos decodificando al mismo valor.
      expect(Buffer.from("/x==", "base64").equals(Buffer.from("/w==", "base64"))).toBe(true);
      expect(() => cifrar("x", "/x==")).toThrow(ErrorSeguridad);
      try {
        cifrar("x", "/x==");
      } catch (error) {
        expect((error as ErrorSeguridad).codigo).toBe("clave_invalida");
      }
    });

    it("un segmento iv/tag/datos con caracteres base64url se rechaza: formato_invalido", () => {
      const guardado = cifrar("dato", CLAVE);
      const { version, iv, tag, datos } = partesDe(guardado);
      // "-" y "_" no son base64 estándar.
      const ivUrlSafe = `${iv.replace(/=+$/, "").slice(0, -1)}-`;
      const adulterado = [version, ivUrlSafe, tag, datos].join(":");
      expect(() => descifrar(adulterado, CLAVE)).toThrow(ErrorSeguridad);
      try {
        descifrar(adulterado, CLAVE);
      } catch (error) {
        expect((error as ErrorSeguridad).codigo).toBe("formato_invalido");
      }
    });

    it("un segmento con basura tipo '!!' pegada se rechaza: formato_invalido (caso del reviewer)", () => {
      const guardado = cifrar("dato", CLAVE);
      const { version, iv, tag, datos } = partesDe(guardado);
      const adulterado = [version, `${iv}!!`, tag, datos].join(":");
      expect(() => descifrar(adulterado, CLAVE)).toThrow(ErrorSeguridad);
    });
  });
});
