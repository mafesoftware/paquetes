import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_PERMANENTES,
  CATEGORIAS_TRANSITORIAS,
  clasificarResultado,
} from "../src/clasificar-resultado.js";

describe("clasificarResultado", () => {
  it('ok: true -> "ok"', () => {
    expect(clasificarResultado({ ok: true })).toBe("ok");
    expect(clasificarResultado({ ok: true, idExterno: "msg_1" })).toBe("ok");
  });

  it.each([...CATEGORIAS_TRANSITORIAS])('categoria "%s" (@mafesoftware/correo y @mafesoftware/kapso-wa) -> "transitorio"', (categoria) => {
    expect(clasificarResultado({ ok: false, categoria })).toBe("transitorio");
  });

  it.each([...CATEGORIAS_PERMANENTES])('categoria "%s" (@mafesoftware/correo y/o @mafesoftware/kapso-wa) -> "permanente"', (categoria) => {
    expect(clasificarResultado({ ok: false, categoria })).toBe("permanente");
  });

  it("categoria desconocida (no catalogada) -> \"transitorio\" (default seguro, no se pierde el mensaje)", () => {
    expect(clasificarResultado({ ok: false, categoria: "algo-que-no-existe-todavia" })).toBe("transitorio");
    expect(clasificarResultado({ ok: false, categoria: "" })).toBe("transitorio");
  });

  it("las dos listas de categorías no se superponen", () => {
    for (const c of CATEGORIAS_TRANSITORIAS) {
      expect(CATEGORIAS_PERMANENTES.has(c)).toBe(false);
    }
  });

  it("el codigo (si viene) no afecta la clasificación", () => {
    expect(clasificarResultado({ ok: false, categoria: "red", codigo: "ECONNRESET" })).toBe("transitorio");
    expect(clasificarResultado({ ok: false, categoria: "credenciales", codigo: "401" })).toBe("permanente");
  });

  it('"conflicto_idempotencia" (HTTP 409 de Resend: misma Idempotency-Key con un cuerpo distinto) está catalogada explícitamente como transitoria — L4', () => {
    expect(CATEGORIAS_TRANSITORIAS.has("conflicto_idempotencia")).toBe(true);
    expect(clasificarResultado({ ok: false, categoria: "conflicto_idempotencia" })).toBe("transitorio");
  });
});
