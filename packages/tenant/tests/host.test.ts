import { describe, expect, it } from "vitest";
import { normalizarHost, slugDeHost } from "../src/host.js";

describe("normalizarHost", () => {
  it("pasa a minúsculas", () => {
    expect(normalizarHost("DEMO.MAFE.APP")).toBe("demo.mafe.app");
  });

  it("saca el puerto", () => {
    expect(normalizarHost("demo.mafe.app:3300")).toBe("demo.mafe.app");
  });

  it("saca un punto final", () => {
    expect(normalizarHost("demo.mafe.app.")).toBe("demo.mafe.app");
  });

  it("saca el www del principio", () => {
    expect(normalizarHost("www.demo.mafe.app")).toBe("demo.mafe.app");
  });

  it("combina las cuatro reglas a la vez, en orden (minúsculas, puerto, punto final, www)", () => {
    expect(normalizarHost("WWW.MAFE.APP:443.")).toBe("mafe.app");
  });

  it("no toca un host que ya está normalizado", () => {
    expect(normalizarHost("demo.mafe.app")).toBe("demo.mafe.app");
  });
});

describe("slugDeHost", () => {
  const BASE = "mafe.app";

  it("un subdominio simple da su slug", () => {
    expect(slugDeHost("demo.mafe.app", BASE)).toBe("demo");
  });

  it("no distingue mayúsculas", () => {
    expect(slugDeHost("DEMO.MAFE.APP", BASE)).toBe("demo");
  });

  it("ignora el puerto", () => {
    expect(slugDeHost("demo.mafe.app:3300", BASE)).toBe("demo");
  });

  it("ignora un punto final", () => {
    expect(slugDeHost("demo.mafe.app.", BASE)).toBe("demo");
  });

  it("la apex (el dominio pelado) no es una organización", () => {
    expect(slugDeHost("mafe.app", BASE)).toBeNull();
  });

  it("www se saca antes de mirar el slug, así que www.<base> también es la apex", () => {
    expect(slugDeHost("www.mafe.app", BASE)).toBeNull();
  });

  it("un subdominio de dos niveles no es un slug (una sola etiqueta)", () => {
    expect(slugDeHost("panel.demo.mafe.app", BASE)).toBeNull();
  });

  it("un slug reservado da null", () => {
    expect(slugDeHost("admin.mafe.app", BASE)).toBeNull();
    expect(slugDeHost("api.mafe.app", BASE)).toBeNull();
  });

  it("*.vercel.app nunca es una organización", () => {
    expect(slugDeHost("gestionflow-git-main-mafesoftware.vercel.app", BASE)).toBeNull();
  });

  it("punycode (xn--) da null", () => {
    expect(slugDeHost("xn--80ak6aa92e.mafe.app", BASE)).toBeNull();
  });

  it("una etiqueta que no pasa validarSlug (muy corta) da null", () => {
    expect(slugDeHost("ab.mafe.app", BASE)).toBeNull();
  });

  it("un host que no es de esta base da null", () => {
    expect(slugDeHost("otro-dominio.com", BASE)).toBeNull();
  });

  it("funciona con dominioBase = localhost (E2E sin DNS)", () => {
    expect(slugDeHost("demo.localhost:3300", "localhost")).toBe("demo");
  });

  it("localhost pelado (sin subdominio) no es una organización", () => {
    expect(slugDeHost("localhost:3300", "localhost")).toBeNull();
  });

  it("acepta una lista de reservados propia en vez de RESERVADOS", () => {
    expect(slugDeHost("mi-tienda.mafe.app", BASE, new Set(["mi-tienda"]))).toBeNull();
    // con la lista custom, "admin" ya no está reservado:
    expect(slugDeHost("admin.mafe.app", BASE, new Set(["mi-tienda"]))).toBe("admin");
  });
});
