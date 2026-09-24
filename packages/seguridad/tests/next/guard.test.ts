import { notFound, redirect } from "next/navigation.js";
import { describe, expect, it } from "vitest";
import { ErrorNegocio, guard } from "../../src/next/guard.js";

describe("guard", () => {
  it("éxito: mezcla el resultado en { ok: true, ...resultado }", async () => {
    const accion = guard(async (nombre: string) => ({ id: "1", nombre }));
    const resultado = await accion("Juana");
    expect(resultado).toEqual({ ok: true, id: "1", nombre: "Juana" });
  });

  it("éxito sin resultado (void): { ok: true }", async () => {
    const accion = guard(async () => {
      /* no devuelve nada */
    });
    const resultado = await accion();
    expect(resultado).toEqual({ ok: true });
  });

  it("ErrorNegocio se convierte en { ok: false, error }", async () => {
    const accion = guard(async () => {
      throw new ErrorNegocio("El email ya está en uso");
    });
    const resultado = await accion();
    expect(resultado).toEqual({ ok: false, error: "El email ya está en uso" });
  });

  it("ErrorNegocio con campo se convierte en { ok: false, error, campo }", async () => {
    const accion = guard(async () => {
      throw new ErrorNegocio("Contraseña demasiado corta", "password");
    });
    const resultado = await accion();
    expect(resultado).toEqual({ ok: false, error: "Contraseña demasiado corta", campo: "password" });
  });

  it("un error que no es de negocio (bug) se vuelve a tirar, no se convierte en { ok: false }", async () => {
    const accion = guard(async () => {
      throw new TypeError("no debería pasar");
    });
    await expect(accion()).rejects.toThrow(TypeError);
  });

  it("redirect() se vuelve a tirar vía unstable_rethrow, no se traga como ErrorNegocio", async () => {
    const accion = guard(async () => {
      redirect("/login");
    });
    let capturado: unknown;
    try {
      await accion();
      throw new Error("no debería llegar acá: guard() se comió el redirect");
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toHaveProperty("digest");
    expect((capturado as { digest: string }).digest).toContain("NEXT_REDIRECT");
  });

  it("notFound() se vuelve a tirar vía unstable_rethrow", async () => {
    const accion = guard(async () => {
      notFound();
    });
    let capturado: unknown;
    try {
      await accion();
      throw new Error("no debería llegar acá: guard() se comió el notFound");
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toHaveProperty("digest");
    expect((capturado as { digest: string }).digest).toContain("NEXT_HTTP_ERROR_FALLBACK");
  });

  it("pasa los argumentos de la acción original a fn", async () => {
    const accion = guard(async (a: number, b: number) => ({ suma: a + b }));
    const resultado = await accion(2, 3);
    expect(resultado).toEqual({ ok: true, suma: 5 });
  });
});

describe("ErrorNegocio", () => {
  it("expone mensaje y campo, y es instancia de Error", () => {
    const error = new ErrorNegocio("mensaje", "campo-x");
    expect(error).toBeInstanceOf(Error);
    expect(error.mensaje).toBe("mensaje");
    expect(error.campo).toBe("campo-x");
    expect(error.name).toBe("ErrorNegocio");
  });

  it("campo es opcional", () => {
    const error = new ErrorNegocio("mensaje");
    expect(error.campo).toBeUndefined();
  });
});
