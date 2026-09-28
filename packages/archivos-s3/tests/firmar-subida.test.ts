import { describe, expect, it } from "vitest";
import { firmarSubida } from "../src/index.js";
import { clienteDePrueba } from "./cliente-de-prueba.js";

const OPCIONES_BASE = {
  bucket: "mi-bucket-de-prueba",
  tipoMime: "application/pdf",
  tamano: 1000,
  nombre: "factura.pdf",
  mimesPermitidos: ["application/pdf", "image/png"] as const,
  tamanoMaximo: 25 * 1024 * 1024,
};

describe("firmarSubida", () => {
  it("firma una subida válida bajo el prefijo pending/ por omisión", async () => {
    const resultado = await firmarSubida({ cliente: clienteDePrueba(), ...OPCIONES_BASE });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.clave.startsWith("pending/")).toBe(true);
    expect(resultado.clave.endsWith("-factura.pdf")).toBe(true);
    expect(resultado.url).toMatch(/^https:\/\//);
    expect(resultado.campos["Content-Type"]).toBe("application/pdf");
    expect(resultado.campos.key).toBe(resultado.clave);
    expect(resultado.campos.Policy).toEqual(expect.any(String));
  });

  it("respeta un prefijo temporal propio", async () => {
    const resultado = await firmarSubida({ cliente: clienteDePrueba(), ...OPCIONES_BASE, prefijoTemporal: "tmp/" });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no debería fallar");
    expect(resultado.clave.startsWith("tmp/")).toBe(true);
  });

  it("dos llamadas generan claves distintas (CSPRNG, no colisiona)", async () => {
    const [a, b] = await Promise.all([
      firmarSubida({ cliente: clienteDePrueba(), ...OPCIONES_BASE }),
      firmarSubida({ cliente: clienteDePrueba(), ...OPCIONES_BASE }),
    ]);
    if (!a.ok || !b.ok) throw new Error("no debería fallar");
    expect(a.clave).not.toBe(b.clave);
  });

  it("rechaza un tipo MIME fuera de la lista permitida (no feliz)", async () => {
    const resultado = await firmarSubida({
      cliente: clienteDePrueba(),
      ...OPCIONES_BASE,
      tipoMime: "application/x-msdownload",
    });

    expect(resultado).toEqual({
      ok: false,
      error: { codigo: "mime_no_permitido", mensaje: expect.any(String) },
    });
  });

  it("rechaza un tamaño mayor al máximo permitido (no feliz)", async () => {
    const resultado = await firmarSubida({
      cliente: clienteDePrueba(),
      ...OPCIONES_BASE,
      tamano: OPCIONES_BASE.tamanoMaximo + 1,
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("debería fallar");
    expect(resultado.error.codigo).toBe("tamano_excedido");
  });

  it("rechaza un tamaño cero o negativo (no feliz)", async () => {
    const resultado = await firmarSubida({ cliente: clienteDePrueba(), ...OPCIONES_BASE, tamano: 0 });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("debería fallar");
    expect(resultado.error.codigo).toBe("tamano_excedido");
  });

  it("valida el MIME antes que el tamaño cuando ambos fallan", async () => {
    const resultado = await firmarSubida({
      cliente: clienteDePrueba(),
      ...OPCIONES_BASE,
      tipoMime: "application/x-msdownload",
      tamano: OPCIONES_BASE.tamanoMaximo + 1,
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("debería fallar");
    expect(resultado.error.codigo).toBe("mime_no_permitido");
  });
});
