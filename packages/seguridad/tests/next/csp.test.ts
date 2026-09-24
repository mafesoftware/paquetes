import { describe, expect, it } from "vitest";
import { generarNonce, politicaCsp } from "../../src/next/csp.js";

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
