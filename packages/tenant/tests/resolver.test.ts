import { describe, expect, it, vi } from "vitest";
import { resolverTenant } from "../src/resolver.js";

function opciones(overrides: {
  host?: string | null;
  sesion?: string | null;
  porHost?: string | null;
  porSesion?: string | null;
}) {
  return {
    host: overrides.host ?? null,
    sesion: overrides.sesion ?? null,
    buscarPorHost: vi.fn().mockResolvedValue(overrides.porHost ?? null),
    buscarPorSesion: vi.fn().mockResolvedValue(overrides.porSesion ?? null),
  };
}

describe("resolverTenant", () => {
  it("host y sesión resuelven al mismo id -> ese tenant", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porHost: "tenant-A", porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
  });

  it("host A y sesión B (ids distintos) -> null", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porHost: "tenant-A", porSesion: "tenant-B" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("solo el host resuelve -> el tenant del host (páginas públicas)", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: null, porHost: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
  });

  it("solo el host resuelve aunque haya sesión, si la sesión no resuelve a nada -> el tenant del host", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porHost: "tenant-A", porSesion: null });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
  });

  it("solo la sesión resuelve (host apex/desconocido) -> null, NUNCA el tenant de la sesión", async () => {
    const op = opciones({ host: "mafe.app", sesion: "sesion-1", porHost: null, porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("sin host -> null aunque la sesión resuelva (sin tenant por defecto)", async () => {
    const op = opciones({ host: null, sesion: "sesion-1", porHost: null, porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("ninguna de las dos resuelve -> null", async () => {
    const op = opciones({ host: "otro.com", sesion: "sesion-1" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("sin host y sin sesión -> null, sin llamar a ninguna búsqueda", async () => {
    const op = opciones({});
    await expect(resolverTenant(op)).resolves.toBeNull();
    expect(op.buscarPorHost).not.toHaveBeenCalled();
    expect(op.buscarPorSesion).not.toHaveBeenCalled();
  });

  it("las dos búsquedas corren en paralelo, no en secuencia", async () => {
    const orden: string[] = [];
    const op = {
      host: "demo.mafe.app",
      sesion: "sesion-1",
      buscarPorHost: vi.fn(async () => {
        orden.push("host-empieza");
        await new Promise((r) => setTimeout(r, 10));
        orden.push("host-termina");
        return "tenant-A";
      }),
      buscarPorSesion: vi.fn(async () => {
        orden.push("sesion-empieza");
        return "tenant-A";
      }),
    };
    await resolverTenant(op);
    // Si corrieran en secuencia, "sesion-empieza" llegaría después de "host-termina".
    expect(orden.indexOf("sesion-empieza")).toBeLessThan(orden.indexOf("host-termina"));
  });
});
