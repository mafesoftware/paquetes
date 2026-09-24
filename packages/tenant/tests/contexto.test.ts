import { describe, expect, it } from "vitest";
import { conTenant, tenantDelContexto } from "../src/contexto.js";

describe("conTenant / tenantDelContexto", () => {
  it("fuera de conTenant, tenantDelContexto da null", () => {
    expect(tenantDelContexto()).toBeNull();
  });

  it("dentro de conTenant, tenantDelContexto da el id pasado", async () => {
    const visto = await conTenant("tenant-A", async () => tenantDelContexto());
    expect(visto).toBe("tenant-A");
  });

  it("conTenant devuelve lo que devuelve fn", async () => {
    const resultado = await conTenant("tenant-A", async () => 42);
    expect(resultado).toBe(42);
  });

  it("el contexto sigue disponible en llamadas anidadas async, no solo en el cuerpo directo de fn", async () => {
    async function funcionAnidada(): Promise<string | null> {
      await new Promise((r) => setTimeout(r, 0));
      return tenantDelContexto();
    }
    const visto = await conTenant("tenant-B", async () => funcionAnidada());
    expect(visto).toBe("tenant-B");
  });

  it("después de que termina conTenant, el contexto vuelve a null", async () => {
    await conTenant("tenant-A", async () => tenantDelContexto());
    expect(tenantDelContexto()).toBeNull();
  });

  it("dos conTenant concurrentes no se pisan entre sí", async () => {
    const [a, b] = await Promise.all([
      conTenant("tenant-A", async () => {
        await new Promise((r) => setTimeout(r, 20));
        return tenantDelContexto();
      }),
      conTenant("tenant-B", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return tenantDelContexto();
      }),
    ]);
    expect(a).toBe("tenant-A");
    expect(b).toBe("tenant-B");
  });

  it("conTenant anidado: el interior gana mientras corre, el exterior vuelve al salir", async () => {
    const vistos: (string | null)[] = [];
    await conTenant("tenant-A", async () => {
      vistos.push(tenantDelContexto());
      await conTenant("tenant-B", async () => {
        vistos.push(tenantDelContexto());
      });
      vistos.push(tenantDelContexto());
    });
    expect(vistos).toEqual(["tenant-A", "tenant-B", "tenant-A"]);
  });

  it("propaga el error de fn sin dejar el contexto pisado", async () => {
    await expect(
      conTenant("tenant-A", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(tenantDelContexto()).toBeNull();
  });
});
