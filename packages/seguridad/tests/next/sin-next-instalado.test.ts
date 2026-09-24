import { describe, expect, it, vi } from "vitest";

/**
 * Fix round 1 (M10), complemento en runtime del test estático
 * `sin-next-estatico.test.ts`: en vez de leer el código fuente, esto hace
 * que CARGAR `next/navigation.js` explote — como pasaría si `next` no
 * estuviera instalado — y comprueba que `politicaCsp`, `generarNonce`,
 * `cabecerasSeguridad`, `autorizarCron` e `ipDe` (todo lo de `/next` menos
 * `guard`) se importan y se usan igual, porque ninguno de sus módulos toca
 * `next/navigation` para nada.
 */
vi.mock("next/navigation.js", () => {
  throw new Error("next/navigation.js no debería cargarse para esto — si esto se ejecuta, el test debe fallar");
});

describe("las exportaciones de /next que no son guard funcionan sin que next/navigation se resuelva", () => {
  it("politicaCsp / generarNonce", async () => {
    const { politicaCsp, generarNonce } = await import("../../src/next/csp.js");
    const nonce = generarNonce();
    expect(typeof nonce).toBe("string");
    expect(politicaCsp(nonce)).toContain("default-src 'self'");
  });

  it("cabecerasSeguridad", async () => {
    const { cabecerasSeguridad } = await import("../../src/next/cabeceras.js");
    expect(cabecerasSeguridad()["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("autorizarCron", async () => {
    const { autorizarCron } = await import("../../src/next/cron.js");
    const req = new Request("https://example.com", { headers: { authorization: "Bearer s" } });
    expect(autorizarCron(req, "s")).toBe(true);
  });

  it("ipDe", async () => {
    const { ipDe } = await import("../../src/next/ip.js");
    expect(ipDe(new Headers({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("el barrel de /next completo (incluido guard, sin invocarlo) se importa sin que next/navigation se cargue", async () => {
    // Importar el módulo `guard.ts` no dispara el import dinámico: ese vive
    // DENTRO del catch, en el cuerpo de la función devuelta por `guard(fn)`.
    // Si el import de más abajo no tira, es porque nada de esto tocó
    // next/navigation.js todavía.
    const modulo = await import("../../src/next/index.js");
    expect(typeof modulo.guard).toBe("function");
    expect(typeof modulo.politicaCsp).toBe("function");
  });
});
