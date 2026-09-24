import { describe, it, expect } from "vitest";
import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  generarClaves,
  emitirCarnet,
  verificarCarnet,
  compararEnTiempoConstante,
  type DatosCarnet,
} from "../src/index.ts";

/** El separador de campos del formato, para probar que no se puede inyectar. */
const SEP = "\u001F";

const claves = generarClaves();
const otroClub = generarClaves();

const AHORA = new Date("2026-09-06T12:00:00Z");

function datos(over: Partial<DatosCarnet> = {}): DatosCarnet {
  return {
    clubId: "club_atletico_oeste",
    socioId: "soc_00042",
    numeroSocio: "1042",
    nombre: "Juan Pérez",
    categoria: "Activo",
    version: 1,
    emitidoEn: new Date("2026-09-01T00:00:00Z"),
    valeHasta: new Date("2026-12-31T23:59:59Z"),
    ...over,
  };
}

describe("emitir y verificar", () => {
  it("un carnet recien emitido vale", () => {
    const token = emitirCarnet(datos(), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.socioId).toBe("soc_00042");
      expect(r.datos.nombre).toBe("Juan Pérez");
      expect(r.datos.numeroSocio).toBe("1042");
      expect(r.datos.categoria).toBe("Activo");
      expect(r.datos.version).toBe(1);
    }
  });

  it("el token lleva el prefijo del formato y tres partes", () => {
    const token = emitirCarnet(datos(), claves.privadaPem);
    expect(token.split(".")).toHaveLength(3);
    expect(token.startsWith("GF1.")).toBe(true);
  });

  it("entra comodo en un QR: menos de 260 caracteres", () => {
    // Un nombre largo de verdad, que es el peor caso realista.
    const token = emitirCarnet(
      datos({ nombre: "María de los Ángeles Rodríguez Fernández", categoria: "Vitalicio" }),
      claves.privadaPem
    );
    expect(token.length).toBeLessThan(260);
  });

  it("los acentos sobreviven la vuelta", () => {
    const token = emitirCarnet(datos({ nombre: "Ñandú Ávalos Güemes" }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok && r.datos.nombre).toBe("Ñandú Ávalos Güemes");
  });

  it("la categoria es opcional", () => {
    const token = emitirCarnet(datos({ categoria: undefined }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok && r.datos.categoria).toBeUndefined();
  });

  it("tambien acepta un KeyObject en vez de un PEM, para emitir y para verificar", () => {
    const clavePrivada = createPrivateKey(claves.privadaPem);
    const clavePublica = createPublicKey(claves.publicaPem);
    const token = emitirCarnet(datos(), clavePrivada);
    const r = verificarCarnet(token, { publicaPem: clavePublica, ahora: AHORA });
    expect(r.ok).toBe(true);
  });
});

describe("firma: un lector no puede fabricar carnets", () => {
  it("la clave publica de OTRO club no lo valida", () => {
    const token = emitirCarnet(datos(), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: otroClub.publicaPem, ahora: AHORA });
    expect(r).toEqual({ ok: false, motivo: "firma" });
  });

  it("cambiarle un dato al payload invalida la firma", () => {
    const token = emitirCarnet(datos(), claves.privadaPem);
    const [pre, cuerpo, firma] = token.split(".");
    const roto = Buffer.from(cuerpo!.replace(/-/g, "+").replace(/_/g, "/"), "base64")
      .toString("utf8")
      .replace("1042", "9999");
    const falsificado = `${pre}.${Buffer.from(roto, "utf8").toString("base64url")}.${firma}`;
    const r = verificarCarnet(falsificado, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("firma");
  });

  it("la firma se chequea ANTES que el vencimiento", () => {
    // Si no, el motivo del error contaria si el payload inventado estaba vigente.
    const vencido = emitirCarnet(
      datos({ valeHasta: new Date("2020-01-01T00:00:00Z") }),
      otroClub.privadaPem
    );
    const r = verificarCarnet(vencido, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("firma");
  });
});

describe("nunca tira: la entrada de un lector es hostil", () => {
  const basura = [
    "",
    "   ",
    "hola",
    "GF1",
    "GF1.",
    "GF1.a.b",
    "GF1.a.b.c",
    "OTRO.aaaa.bbbb",
    "GF1...",
    "https://www.coca-cola.com/promo",
    "GF1." + "A".repeat(5000) + ".B",
  ];
  for (const t of basura) {
    it(`no revienta con ${JSON.stringify(t.slice(0, 32))}`, () => {
      const r = verificarCarnet(t, { publicaPem: claves.publicaPem, ahora: AHORA });
      expect(r.ok).toBe(false);
    });
  }

  it("tampoco con null o undefined", () => {
    expect(verificarCarnet(null as never, { publicaPem: claves.publicaPem }).ok).toBe(false);
    expect(verificarCarnet(undefined as never, { publicaPem: claves.publicaPem }).ok).toBe(false);
  });

  it("ni con una clave publica rota", () => {
    const token = emitirCarnet(datos(), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: "no soy una clave", ahora: AHORA });
    expect(r).toEqual({ ok: false, motivo: "firma" });
  });

  it("un carnet firmado con campos numericos invalidos (bypaseando el tipo) da 'formato'", () => {
    // La firma valida perfectamente (el club la firmó tal cual), pero el
    // contenido no deserializa: version no es un entero.
    const token = emitirCarnet(datos({ version: Number.NaN as never }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r).toEqual({ ok: false, motivo: "formato" });
  });
});

describe("vigencia", () => {
  it("vencido", () => {
    const token = emitirCarnet(datos({ valeHasta: new Date("2026-09-05T00:00:00Z") }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("vencido");
  });

  it("todavia no vale", () => {
    const token = emitirCarnet(datos({ emitidoEn: new Date("2026-10-01T00:00:00Z") }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("todavia_no_vale");
  });

  it("un carnet vencido igual devuelve los datos, para poder decir de quien era", () => {
    const token = emitirCarnet(datos({ valeHasta: new Date("2026-09-05T00:00:00Z") }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.datos?.nombre).toBe("Juan Pérez");
  });

  it("tolera un reloj desfasado un minuto", () => {
    const token = emitirCarnet(datos({ valeHasta: new Date("2026-09-06T11:59:00Z") }), claves.privadaPem);
    expect(verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA }).ok).toBe(true);
  });

  it("pero no uno desfasado una hora", () => {
    const token = emitirCarnet(datos({ valeHasta: new Date("2026-09-06T11:00:00Z") }), claves.privadaPem);
    expect(verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA }).ok).toBe(false);
  });

  it("la tolerancia se puede apagar", () => {
    const token = emitirCarnet(datos({ valeHasta: new Date("2026-09-06T11:59:00Z") }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA, tolerancia: 0 });
    expect(r.ok).toBe(false);
  });
});

describe("revocacion por version", () => {
  it("un carnet viejo muere cuando sube la version vigente", () => {
    // Es lo que pasa cuando alguien pierde el telefono.
    const token = emitirCarnet(datos({ version: 1 }), claves.privadaPem);
    const r = verificarCarnet(token, {
      publicaPem: claves.publicaPem,
      ahora: AHORA,
      versionVigente: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("version_revocada");
  });

  it("el carnet nuevo vale", () => {
    const token = emitirCarnet(datos({ version: 2 }), claves.privadaPem);
    expect(
      verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA, versionVigente: 2 }).ok
    ).toBe(true);
  });

  it("sin versionVigente no se revoca nada: el dispositivo sin padron no inventa", () => {
    const token = emitirCarnet(datos({ version: 1 }), claves.privadaPem);
    expect(verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA }).ok).toBe(true);
  });
});

describe("inyeccion de separador", () => {
  it("un separador metido en el nombre NO corre los campos siguientes", () => {
    // El ataque no es falsificar la firma: es lograr que el club firme un
    // payload torcido, donde el numero de socio de uno se lea como otra cosa.
    const token = emitirCarnet(
      datos({ nombre: "Juan9999Vitalicio99" }),
      claves.privadaPem
    );
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.numeroSocio).toBe("1042");
      expect(r.datos.categoria).toBe("Activo");
      expect(r.datos.nombre).not.toContain(SEP);
    }
  });

  it("un salto de linea tampoco rompe nada", () => {
    const token = emitirCarnet(datos({ nombre: "Juan\nPérez" }), claves.privadaPem);
    const r = verificarCarnet(token, { publicaPem: claves.publicaPem, ahora: AHORA });
    expect(r.ok && r.datos.nombre).toBe("Juan Pérez");
  });
});

describe("compararEnTiempoConstante", () => {
  it("iguales", () => {
    expect(compararEnTiempoConstante("token-secreto", "token-secreto")).toBe(true);
  });
  it("distintos", () => {
    expect(compararEnTiempoConstante("token-secreto", "token-secretX")).toBe(false);
  });
  it("largos distintos no revientan", () => {
    expect(compararEnTiempoConstante("a", "abcdef")).toBe(false);
  });
  it("null y undefined", () => {
    expect(compararEnTiempoConstante(null as never, "a")).toBe(false);
    expect(compararEnTiempoConstante(undefined as never, undefined as never)).toBe(true);
  });
});
