import { describe, expect, it } from "vitest";
import { cabecerasSeguridad } from "../../src/next/cabeceras.js";

describe("cabecerasSeguridad", () => {
  it("por defecto, Strict-Transport-Security NO lleva preload (fix round 1, ruling M9)", () => {
    expect(cabecerasSeguridad()).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
  });

  it("con { hstsPreload: true } agrega preload", () => {
    const cabeceras = cabecerasSeguridad({ hstsPreload: true });
    expect(cabeceras["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("con { hstsPreload: false } explícito, sigue sin preload", () => {
    const cabeceras = cabecerasSeguridad({ hstsPreload: false });
    expect(cabeceras["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("hstsPreload no afecta a las demás cabeceras", () => {
    const sinPreload = cabecerasSeguridad();
    const conPreload = cabecerasSeguridad({ hstsPreload: true });
    for (const clave of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"] as const) {
      expect(conPreload[clave]).toBe(sinPreload[clave]);
    }
  });
});
