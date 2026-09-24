import { describe, expect, it, vi } from "vitest";
import { resolverTenant } from "../src/resolver.js";
import { ErrorTenant } from "../src/errores.js";

const DOMINIO_BASE = "mafe.app";

function opciones(overrides: {
  host?: string | null;
  dominioBase?: string;
  reservados?: ReadonlySet<string>;
  sesion?: string | null;
  porSlug?: string | null;
  porSesion?: string | null;
}) {
  return {
    host: overrides.host ?? null,
    dominioBase: overrides.dominioBase ?? DOMINIO_BASE,
    reservados: overrides.reservados,
    sesion: overrides.sesion ?? null,
    buscarPorSlug: vi.fn().mockResolvedValue(overrides.porSlug ?? null),
    buscarPorSesion: vi.fn().mockResolvedValue(overrides.porSesion ?? null),
  };
}

describe("resolverTenant", () => {
  it("host y sesión resuelven al mismo id -> ese tenant", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porSlug: "tenant-A", porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
    expect(op.buscarPorSlug).toHaveBeenCalledWith("demo");
  });

  it("host A y sesión B (ids distintos) -> null", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porSlug: "tenant-A", porSesion: "tenant-B" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("solo el host resuelve -> el tenant del host (páginas públicas)", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: null, porSlug: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
  });

  it("solo el host resuelve aunque haya sesión, si la sesión no resuelve a nada -> el tenant del host", async () => {
    const op = opciones({ host: "demo.mafe.app", sesion: "sesion-1", porSlug: "tenant-A", porSesion: null });
    await expect(resolverTenant(op)).resolves.toBe("tenant-A");
  });

  it("solo la sesión resuelve (host apex/desconocido) -> null, NUNCA el tenant de la sesión", async () => {
    const op = opciones({ host: "mafe.app", sesion: "sesion-1", porSlug: null, porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBeNull();
    expect(op.buscarPorSlug).not.toHaveBeenCalled(); // la apex nunca da slug
  });

  it("sin host -> null aunque la sesión resuelva (sin tenant por defecto)", async () => {
    const op = opciones({ host: null, sesion: "sesion-1", porSlug: null, porSesion: "tenant-A" });
    await expect(resolverTenant(op)).resolves.toBeNull();
    expect(op.buscarPorSlug).not.toHaveBeenCalled();
  });

  it("ninguna de las dos resuelve -> null", async () => {
    const op = opciones({ host: "otro.com", sesion: "sesion-1" });
    await expect(resolverTenant(op)).resolves.toBeNull();
  });

  it("sin host y sin sesión -> null, sin llamar a ninguna búsqueda", async () => {
    const op = opciones({});
    await expect(resolverTenant(op)).resolves.toBeNull();
    expect(op.buscarPorSlug).not.toHaveBeenCalled();
    expect(op.buscarPorSesion).not.toHaveBeenCalled();
  });

  it("las dos búsquedas corren en paralelo, no en secuencia", async () => {
    const orden: string[] = [];
    const op = {
      host: "demo.mafe.app",
      dominioBase: DOMINIO_BASE,
      sesion: "sesion-1",
      buscarPorSlug: vi.fn(async () => {
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

  describe("el host se convierte en slug ANTES de llegar a buscarPorSlug", () => {
    it("host en mayúsculas y con puerto -> buscarPorSlug recibe el slug normalizado en minúsculas", async () => {
      const op = opciones({ host: "DEMO.MAFE.APP:3300", porSlug: "tenant-A" });
      await resolverTenant(op);
      expect(op.buscarPorSlug).toHaveBeenCalledTimes(1);
      expect(op.buscarPorSlug).toHaveBeenCalledWith("demo");
    });

    it("slug reservado -> buscarPorSlug NUNCA se llama", async () => {
      const op = opciones({ host: "admin.mafe.app" });
      await resolverTenant(op);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
    });

    it("*.vercel.app -> buscarPorSlug NUNCA se llama", async () => {
      const op = opciones({ host: "preview-x1.vercel.app" });
      await resolverTenant(op);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
    });

    it("host de dos niveles (subdominio de subdominio) -> buscarPorSlug NUNCA se llama", async () => {
      const op = opciones({ host: "panel.demo.mafe.app" });
      await resolverTenant(op);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
    });

    it("la apex -> buscarPorSlug NUNCA se llama", async () => {
      const op = opciones({ host: "mafe.app" });
      await resolverTenant(op);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
    });

    it("reservados propios se respetan también acá", async () => {
      const op = opciones({ host: "facturacion.mafe.app", reservados: new Set(["facturacion"]) });
      await resolverTenant(op);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
    });
  });

  describe("dominioBase inválido", () => {
    it("tira ErrorTenant, incluso sin host, ANTES de llamar a ninguna búsqueda", async () => {
      const op = opciones({ host: null, sesion: "sesion-1", dominioBase: "" });
      await expect(resolverTenant(op)).rejects.toThrow(ErrorTenant);
      expect(op.buscarPorSlug).not.toHaveBeenCalled();
      expect(op.buscarPorSesion).not.toHaveBeenCalled();
    });

    it("tira ErrorTenant con host presente también", async () => {
      const op = opciones({ host: "demo.mafe.app", dominioBase: "   " });
      await expect(resolverTenant(op)).rejects.toThrow(ErrorTenant);
    });
  });

  describe("fail closed: un lookup que tira se propaga, nunca se convierte en null", () => {
    it("buscarPorSlug que tira propaga el error", async () => {
      const error = new Error("la base no responde");
      const op = {
        host: "demo.mafe.app",
        dominioBase: DOMINIO_BASE,
        sesion: null,
        buscarPorSlug: vi.fn().mockRejectedValue(error),
        buscarPorSesion: vi.fn().mockResolvedValue(null),
      };
      await expect(resolverTenant(op)).rejects.toThrow("la base no responde");
    });

    it("buscarPorSesion que tira propaga el error", async () => {
      const error = new Error("timeout de sesión");
      const op = {
        host: null,
        dominioBase: DOMINIO_BASE,
        sesion: "sesion-1",
        buscarPorSlug: vi.fn().mockResolvedValue(null),
        buscarPorSesion: vi.fn().mockRejectedValue(error),
      };
      await expect(resolverTenant(op)).rejects.toThrow("timeout de sesión");
    });
  });
});
