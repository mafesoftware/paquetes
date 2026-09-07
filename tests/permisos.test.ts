import { describe, it, expect } from "vitest";
import { crearSistema, leerExcepciones } from "../src/index.ts";

const ROLES = crearSistema({
  claves: ["socios.ver", "socios.editar", "cobranzas.cobrar", "accesos.abrir"] as const,
  presets: {
    duenio: "todas",
    tesoreria: ["socios.ver", "cobranzas.cobrar"],
    porteria: ["socios.ver", "accesos.abrir"],
    ninguno: [],
  },
});

describe("la ausencia significa el preset, nunca false", () => {
  it("sin excepciones vale lo que trae el rol", () => {
    expect(ROLES.tiene("tesoreria", undefined, "cobranzas.cobrar")).toBe(true);
    expect(ROLES.tiene("tesoreria", undefined, "accesos.abrir")).toBe(false);
  });
  it("un mapa VACIO no deja a nadie sin permisos", () => {
    // El bug: tratar las excepciones como lista blanca. Alguien guarda el
    // formulario sin tocar nada y le desaparece el menu.
    expect(ROLES.tiene("tesoreria", {}, "cobranzas.cobrar")).toBe(true);
    expect(ROLES.efectivas("tesoreria", {}).size).toBe(2);
  });
  it("null y undefined se comportan igual que un mapa vacio", () => {
    expect(ROLES.efectivas("porteria", null)).toEqual(ROLES.efectivas("porteria", undefined));
    expect(ROLES.efectivas("porteria", {})).toEqual(ROLES.delPreset("porteria"));
  });
  it("una clave con undefined explicito tambien es 'lo que diga el preset'", () => {
    expect(ROLES.tiene("tesoreria", { "cobranzas.cobrar": undefined }, "cobranzas.cobrar")).toBe(true);
  });
});

describe("excepciones", () => {
  it("true CONCEDE algo que el preset no da", () => {
    expect(ROLES.tiene("porteria", { "socios.editar": true }, "socios.editar")).toBe(true);
  });
  it("false QUITA algo que el preset si da", () => {
    expect(ROLES.tiene("duenio", { "cobranzas.cobrar": false }, "cobranzas.cobrar")).toBe(false);
  });
  it("'todas' concede todas las claves declaradas", () => {
    expect(ROLES.efectivas("duenio", undefined).size).toBe(ROLES.claves.length);
  });
  it("un preset vacio no concede nada, pero acepta excepciones", () => {
    expect(ROLES.efectivas("ninguno", undefined).size).toBe(0);
    expect(ROLES.tiene("ninguno", { "socios.ver": true }, "socios.ver")).toBe(true);
  });
});

describe("claves desconocidas", () => {
  it("preguntar por una clave que no existe da false, no revienta", () => {
    // @ts-expect-error clave inventada
    expect(ROLES.tiene("duenio", undefined, "inventada.total")).toBe(false);
  });
  it("una excepcion sobre una clave que no existe se ignora", () => {
    const e = ROLES.efectivas("porteria", { inventada: true } as never);
    expect(e.has("inventada" as never)).toBe(false);
    expect(e.size).toBe(2);
  });
  it("esClave valida lo que llega de un formulario", () => {
    expect(ROLES.esClave("socios.ver")).toBe(true);
    expect(ROLES.esClave("socios.borrar")).toBe(false);
    expect(ROLES.esClave(42)).toBe(false);
  });
});

describe("minimas: guardar la diferencia, no el conjunto", () => {
  it("no guarda nada cuando lo deseado es exactamente el preset", () => {
    expect(ROLES.minimas("tesoreria", ["socios.ver", "cobranzas.cobrar"])).toEqual({});
  });
  it("guarda solo lo que se agrega", () => {
    expect(ROLES.minimas("tesoreria", ["socios.ver", "cobranzas.cobrar", "accesos.abrir"]))
      .toEqual({ "accesos.abrir": true });
  });
  it("guarda solo lo que se quita", () => {
    expect(ROLES.minimas("tesoreria", ["socios.ver"])).toEqual({ "cobranzas.cobrar": false });
  });
  it("lo que guarda, aplicado, reproduce lo deseado", () => {
    const deseadas = ["socios.editar", "accesos.abrir"] as const;
    const e = ROLES.minimas("tesoreria", deseadas);
    expect([...ROLES.efectivas("tesoreria", e)].sort()).toEqual([...deseadas].sort());
  });
  it("un rol que cambia despues arrastra a quien no tenia excepcion", () => {
    // Es el motivo entero de minimas(): guardar el conjunto congelaria esto.
    const e = ROLES.minimas("porteria", ["socios.ver", "accesos.abrir"]);
    expect(e).toEqual({});
    const ROLES2 = crearSistema({
      claves: ROLES.claves,
      presets: { ...ROLES.presets, porteria: ["socios.ver", "accesos.abrir", "socios.editar"] },
    });
    expect(ROLES2.tiene("porteria", e, "socios.editar")).toBe(true);
  });
});

describe("limpiar", () => {
  it("saca las excepciones que dicen lo mismo que el preset", () => {
    expect(ROLES.limpiar("tesoreria", { "cobranzas.cobrar": true, "accesos.abrir": true }))
      .toEqual({ "accesos.abrir": true });
  });
  it("saca las claves desconocidas", () => {
    expect(ROLES.limpiar("porteria", { inventada: true, "socios.editar": true } as never))
      .toEqual({ "socios.editar": true });
  });
  it("un mapa nulo queda vacio", () => {
    expect(ROLES.limpiar("duenio", null)).toEqual({});
  });
});

describe("leerExcepciones: lo que viene de jsonb o de un formulario", () => {
  it("descarta lo que no es booleano en vez de coercionarlo", () => {
    // "false" de texto es true en JavaScript: ese es el bug que devuelve un
    // permiso que le habian sacado a alguien.
    const e = leerExcepciones({ "socios.ver": "false", "socios.editar": true }, ROLES.esClave);
    expect(e).toEqual({ "socios.editar": true });
  });
  it("descarta claves desconocidas", () => {
    expect(leerExcepciones({ inventada: true }, ROLES.esClave)).toEqual({});
  });
  it("tolera null, arrays y basura", () => {
    expect(leerExcepciones(null, ROLES.esClave)).toEqual({});
    expect(leerExcepciones([1, 2], ROLES.esClave)).toEqual({});
    expect(leerExcepciones("hola", ROLES.esClave)).toEqual({});
  });
});

describe("el mismo algebra sirve para los modulos por plan", () => {
  const PLANES = crearSistema({
    claves: ["socios", "cobranzas", "accesos", "reservas", "eventos", "hardware"] as const,
    presets: {
      digital_base: ["socios", "reservas"],
      pro_avanzado: ["socios", "cobranzas", "accesos", "reservas", "eventos"],
      premium_hardware: "todas",
    },
  });
  it("el plan es el preset", () => {
    expect(PLANES.tiene("digital_base", undefined, "cobranzas")).toBe(false);
    expect(PLANES.tiene("pro_avanzado", undefined, "cobranzas")).toBe(true);
  });
  it("un add-on contratado es una excepcion, no un plan nuevo", () => {
    expect(PLANES.tiene("digital_base", { cobranzas: true }, "cobranzas")).toBe(true);
  });
  it("premium tiene todo", () => {
    expect(PLANES.efectivas("premium_hardware", undefined).size).toBe(6);
  });
});
