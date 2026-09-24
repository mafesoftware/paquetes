import { describe, expect, it } from "vitest";
import { normalizarHost, slugDeHost, validarDominioBase } from "../src/host.js";
import { ErrorTenant } from "../src/errores.js";

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

  it("IPv6 entre corchetes: saca el puerto de después del ']', deja la dirección intacta", () => {
    expect(normalizarHost("[::1]:3000")).toBe("[::1]");
  });

  it("IPv6 entre corchetes sin puerto no cambia", () => {
    expect(normalizarHost("[::1]")).toBe("[::1]");
  });

  it("IPv6 entre corchetes con mayúsculas se normaliza igual que cualquier host", () => {
    expect(normalizarHost("[2001:DB8::1]:8080")).toBe("[2001:db8::1]");
  });
});

describe("validarDominioBase", () => {
  it("un dominioBase válido se devuelve normalizado", () => {
    expect(validarDominioBase("MAFE.app")).toBe("mafe.app");
    expect(validarDominioBase("www.mafe.app")).toBe("mafe.app"); // documentado: se normaliza igual que un host
  });

  it("tira ErrorTenant (dominio_base_invalido) si queda vacío", () => {
    expect(() => validarDominioBase("")).toThrow(ErrorTenant);
    expect(() => validarDominioBase("   ")).toThrow(ErrorTenant);
    expect(() => validarDominioBase(".")).toThrow(ErrorTenant);
  });

  it("el ErrorTenant tirado tiene el código correcto", () => {
    expect.assertions(2);
    try {
      validarDominioBase("");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorTenant);
      expect((error as ErrorTenant).codigo).toBe("dominio_base_invalido");
    }
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

  it("una lista de reservados propia con mayúsculas igual bloquea (se normaliza sola)", () => {
    expect(slugDeHost("facturacion.mafe.app", BASE, new Set(["Facturacion"]))).toBeNull();
  });

  it("tira ErrorTenant si dominioBase es vacío/inválido, sin evaluar el host", () => {
    expect(() => slugDeHost("demo.mafe.app", "")).toThrow(ErrorTenant);
  });
});
