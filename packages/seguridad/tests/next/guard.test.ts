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

  describe("fix round 1 (M6): ok:true no se puede pisar, y valores no-objeto se envuelven", () => {
    it("un resultado que trae su propia clave 'ok' NO puede pisar el ok:true real", async () => {
      const accion = guard(async () => ({ ok: false, id: "1" }) as { ok: boolean; id: string });
      const resultado = await accion();
      expect(resultado.ok).toBe(true);
      expect((resultado as { id: string }).id).toBe("1");
    });

    it("un array se envuelve como { ok: true, valor: [...] }, no se spreadea", async () => {
      const accion = guard(async () => [1, 2, 3]);
      const resultado = await accion();
      expect(resultado).toEqual({ ok: true, valor: [1, 2, 3] });
    });

    it("un string se envuelve como { ok: true, valor: '...' }", async () => {
      const accion = guard(async () => "hola");
      const resultado = await accion();
      expect(resultado).toEqual({ ok: true, valor: "hola" });
    });

    it("un number (incluido 0) se envuelve como { ok: true, valor }", async () => {
      const accion = guard(async () => 0);
      const resultado = await accion();
      expect(resultado).toEqual({ ok: true, valor: 0 });
    });

    it("un boolean false se envuelve como { ok: true, valor: false }, no se confunde con 'sin resultado'", async () => {
      const accion = guard(async () => false);
      const resultado = await accion();
      expect(resultado).toEqual({ ok: true, valor: false });
    });

    it("null se envuelve como { ok: true, valor: null } (distinto de undefined/void)", async () => {
      const accion = guard(async () => null);
      const resultado = await accion();
      expect(resultado).toEqual({ ok: true, valor: null });
    });
  });

  describe("fix round 1 (M6): ErrorNegocio se detecta también entre copias distintas del paquete", () => {
    it("un objeto con name:'ErrorNegocio' pero SIN la marca no se trata como ErrorNegocio (se re-tira)", async () => {
      class ErrorNegocioFalso extends Error {
        mensaje = "no soy de verdad";
        constructor() {
          super("no soy de verdad");
          this.name = "ErrorNegocio";
        }
      }
      const accion = guard(async () => {
        throw new ErrorNegocioFalso();
      });
      await expect(accion()).rejects.toThrow(ErrorNegocioFalso);
    });

    it("un ErrorNegocio 'de otra copia del paquete' (misma forma, distinta clase) SÍ se detecta, vía Symbol.for", async () => {
      // Simula lo que pasa con dos instalaciones de @mafesoftware/seguridad
      // en el mismo árbol de node_modules: la clase es OTRA (no
      // `instanceof` la importada acá), pero misma marca global.
      const MARCA = Symbol.for("@mafesoftware/seguridad:ErrorNegocio");
      class ErrorNegocioDeOtraCopia extends Error {
        readonly mensaje: string;
        readonly campo?: string;
        constructor(mensaje: string, campo?: string) {
          super(mensaje);
          this.name = "ErrorNegocio";
          this.mensaje = mensaje;
          this.campo = campo;
          (this as unknown as Record<symbol, unknown>)[MARCA] = true;
        }
      }
      const accion = guard(async () => {
        throw new ErrorNegocioDeOtraCopia("de otra copia", "campo-y");
      });
      const resultado = await accion();
      expect(resultado).toEqual({ ok: false, error: "de otra copia", campo: "campo-y" });
    });
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
