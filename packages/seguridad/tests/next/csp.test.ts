import { describe, expect, it } from "vitest";
import { generarNonce, politicaCsp } from "../../src/next/csp.js";
import { ErrorSeguridad } from "../../src/errores.js";

describe("politicaCsp", () => {
  it("arma las directivas base, con el nonce en script-src", () => {
    const csp = politicaCsp("abc123");
    expect(csp).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("un nonce distinto da un script-src distinto", () => {
    const a = politicaCsp("nonce-a");
    const b = politicaCsp("nonce-b");
    expect(a).not.toBe(b);
    expect(a).toContain("'nonce-nonce-a'");
    expect(b).toContain("'nonce-nonce-b'");
  });

  it("extras agrega fuentes a una directiva existente sin pisar la base", () => {
    const csp = politicaCsp("n", { "style-src": ["https://fonts.googleapis.com"] });
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });

  it("extras puede agregar una directiva nueva", () => {
    const csp = politicaCsp("n", { "worker-src": ["'self'", "blob:"] });
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it("extras no duplica una fuente que ya está en la base", () => {
    const csp = politicaCsp("n", { "default-src": ["'self'", "https://api.example.com"] });
    const directiva = csp.split("; ").find((d) => d.startsWith("default-src"));
    expect(directiva).toBe("default-src 'self' https://api.example.com");
  });

  describe("fix round 1 (I5): inyección de CSP", () => {
    it("un nonce con ';' tira ErrorSeguridad csp_invalida, no arma una CSP corrupta", () => {
      // Con la implementación vieja, esto cerraba script-src e inyectaba una
      // directiva nueva: politicaCsp("x'; script-src *; foo='") producía
      // "...script-src 'self' 'nonce-x'; script-src *; foo=''...".
      expect(() => politicaCsp("x'; script-src *; foo='")).toThrow(ErrorSeguridad);
      try {
        politicaCsp("x'; script-src *; foo='");
      } catch (error) {
        expect((error as ErrorSeguridad).codigo).toBe("csp_invalida");
      }
    });

    it("un nonce con espacios, comas o saltos de línea también se rechaza", () => {
      expect(() => politicaCsp("a b")).toThrow(ErrorSeguridad);
      expect(() => politicaCsp("a,b")).toThrow(ErrorSeguridad);
      expect(() => politicaCsp("a\nb")).toThrow(ErrorSeguridad);
      expect(() => politicaCsp("")).toThrow(ErrorSeguridad);
    });

    it("un nonce que SÍ es base64/base64url válido (con o sin relleno) no tira", () => {
      expect(() => politicaCsp(generarNonce())).not.toThrow();
      expect(() => politicaCsp("abc-DEF_123")).not.toThrow();
      expect(() => politicaCsp("YWJj")).not.toThrow();
    });

    it("un nombre de directiva en extras con ';' tira ErrorSeguridad, no inyecta una directiva nueva", () => {
      expect(() => politicaCsp("n", { "script-src'; foo": ["'self'"] })).toThrow(ErrorSeguridad);
    });

    it("una fuente con ';' en extras tira ErrorSeguridad, no cierra la directiva actual", () => {
      expect(() => politicaCsp("n", { "style-src": ["https://x.com; script-src *"] })).toThrow(ErrorSeguridad);
    });

    it("una fuente con ',' o con espacio en extras tira ErrorSeguridad", () => {
      expect(() => politicaCsp("n", { "style-src": ["https://x.com,https://y.com"] })).toThrow(ErrorSeguridad);
      expect(() => politicaCsp("n", { "style-src": ["https://x.com https://y.com"] })).toThrow(ErrorSeguridad);
    });

    it("una directiva en mayúsculas o con caracteres fuera de [a-z-] se rechaza", () => {
      expect(() => politicaCsp("n", { "Script-Src": ["'self'"] })).toThrow(ErrorSeguridad);
      expect(() => politicaCsp("n", { "script_src": ["'self'"] })).toThrow(ErrorSeguridad);
    });
  });
});

describe("generarNonce", () => {
  it("devuelve un string base64 de 16 bytes al azar", () => {
    const nonce = generarNonce();
    // 16 bytes en base64 estándar: 24 caracteres, con "==" de relleno al final.
    expect(nonce).toHaveLength(24);
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("da un valor distinto cada vez", () => {
    expect(generarNonce()).not.toBe(generarNonce());
  });
});
