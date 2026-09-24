import { describe, expect, it } from "vitest";
import { cabecerasSeguridad } from "../../src/next/cabeceras.js";

describe("cabecerasSeguridad", () => {
  it("devuelve las cabeceras esperadas", () => {
    expect(cabecerasSeguridad()).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    });
  });
});
