/**
 * El padrón de ARCA con `fetch` falso.
 *
 * Lo que estos tests clavan es la regla que decide la letra de la factura:
 * **ARCA no informa una condición, informa impuestos**, y sin ninguno no se
 * asume nada. Devolver "consumidor final" por defecto haría que un
 * responsable inscripto reciba una factura B, que es justamente lo que
 * consultar el padrón viene a evitar.
 */

import { describe, expect, it } from "vitest";
import {
  condicionDesdePadron,
  consultarPadron,
  ErrorPadron,
  SERVICIO_PADRON,
} from "../src/padron.js";

function fetchQueDevuelve(
  xml: string,
  captura?: { body?: string; url?: string },
  status = 200
) {
  return (async (url: unknown, init?: RequestInit) => {
    if (captura) {
      captura.url = String(url);
      captura.body = String(init?.body);
    }
    return new Response(xml, { status });
  }) as typeof fetch;
}

const BASE = {
  token: "TOK",
  sign: "SGN",
  cuitConsultante: "30-12345678-9",
  cuit: "20-11111111-2",
  entorno: "homologacion" as const,
};

/* ============================================================
   La condición
   ============================================================ */

describe("la condición desde los impuestos", () => {
  it("el impuesto 30 es responsable inscripto", () => {
    expect(
      condicionDesdePadron({ impuestos: [30], categoriaMonotributo: false })
    ).toBe("responsable_inscripto");
  });

  it("el 20 (o la categoría) es monotributo", () => {
    expect(
      condicionDesdePadron({ impuestos: [20], categoriaMonotributo: false })
    ).toBe("monotributo");
    expect(
      condicionDesdePadron({ impuestos: [], categoriaMonotributo: true })
    ).toBe("monotributo");
  });

  it("el monotributo GANA sobre el IVA", () => {
    // Una persona puede figurar con los dos: la factura que emite es C.
    expect(
      condicionDesdePadron({ impuestos: [30, 20], categoriaMonotributo: false })
    ).toBe("monotributo");
  });

  it("sin ninguno NO asume nada", () => {
    /*
     * Es la regla más importante del módulo. Caer en "consumidor final" haría
     * que un responsable inscripto reciba una B, y eso se descubre cuando el
     * contador pide la A que nunca se emitió.
     */
    expect(
      condicionDesdePadron({ impuestos: [], categoriaMonotributo: false })
    ).toBeNull();
  });

  it("un impuesto que no es ninguno de los dos no cuenta", () => {
    // 32 es IVA exento, 301 es ganancias: ninguno decide la letra.
    expect(
      condicionDesdePadron({ impuestos: [301, 32], categoriaMonotributo: false })
    ).toBeNull();
  });
});

/* ============================================================
   La consulta
   ============================================================ */

describe("consultar un CUIT", () => {
  it("trae razón social, condición y domicilio", async () => {
    const captura: { body?: string; url?: string } = {};
    const persona = await consultarPadron({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soap:Envelope><soap:Body><getPersonaResponse><personaReturn>
          <idPersona>20111111112</idPersona>
          <razonSocial>DISTRIBUIDORA DEL SUR SRL</razonSocial>
          <domicilio><direccion>SAN MARTIN 100</direccion>
            <localidad>ROSARIO</localidad>
            <descripcionProvincia>SANTA FE</descripcionProvincia>
            <codPostal>2000</codPostal></domicilio>
          <impuesto><idImpuesto>30</idImpuesto></impuesto>
        </personaReturn></getPersonaResponse></soap:Body></soap:Envelope>`,
        captura
      ),
    });

    expect(persona?.nombre).toBe("DISTRIBUIDORA DEL SUR SRL");
    expect(persona?.condicionIva).toBe("responsable_inscripto");
    expect(persona?.localidad).toBe("ROSARIO");
    expect(persona?.provincia).toBe("SANTA FE");
    expect(persona?.codigoPostal).toBe("2000");

    // Los CUIT viajan SIN guiones: ARCA los rechaza formateados.
    expect(captura.body).toContain("<idPersona>20111111112</idPersona>");
    expect(captura.body).toContain(
      "<cuitRepresentada>30123456789</cuitRepresentada>"
    );
    expect(captura.url).toContain("awshomo.afip.gov.ar");
  });

  it("arma el nombre de una persona física", async () => {
    const persona = await consultarPadron({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soap:Envelope><soap:Body><personaReturn>
          <idPersona>20111111112</idPersona>
          <apellido>PEREZ</apellido><nombre>JUAN</nombre>
          <impuesto><idImpuesto>20</idImpuesto></impuesto>
        </personaReturn></soap:Body></soap:Envelope>`
      ),
    });

    expect(persona?.nombre).toBe("PEREZ, JUAN");
    expect(persona?.condicionIva).toBe("monotributo");
  });

  it("lee los datos aunque vengan con prefijo de espacio de nombres", async () => {
    /*
     * El padrón es un servicio Java y puede envolver los tags con un prefijo
     * que el WSFE no usa. Sin tolerarlo, la razón social sale vacía y nadie ve
     * ningún error: la ficha se guarda sin nombre.
     */
    const persona = await consultarPadron({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soapenv:Envelope><soapenv:Body><ns2:personaReturn>
          <ns2:idPersona>20111111112</ns2:idPersona>
          <ns2:razonSocial>ALMACEN DEL NORTE SA</ns2:razonSocial>
          <ns2:impuesto><ns2:idImpuesto>30</ns2:idImpuesto></ns2:impuesto>
        </ns2:personaReturn></soapenv:Body></soapenv:Envelope>`
      ),
    });

    expect(persona?.nombre).toBe("ALMACEN DEL NORTE SA");
    expect(persona?.condicionIva).toBe("responsable_inscripto");
  });

  it("un CUIT que ARCA no conoce devuelve null", async () => {
    // No es un error: es la respuesta para un CUIT que no existe o está de
    // baja, y quien carga la ficha tiene que poder seguir a mano.
    const persona = await consultarPadron({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soap:Envelope><soap:Body><soap:Fault>
          <faultstring>No existe persona con ese id</faultstring>
        </soap:Fault></soap:Body></soap:Envelope>`
      ),
    });
    expect(persona).toBeNull();
  });

  it("una respuesta sin idPersona también es null", async () => {
    const persona = await consultarPadron({
      ...BASE,
      fetch: fetchQueDevuelve(`<soap:Envelope><soap:Body/></soap:Envelope>`),
    });
    expect(persona).toBeNull();
  });

  it("un HTTP que no es 200 SÍ tira", async () => {
    // Un 500 del padrón no es "no lo conozco": es que el servicio está caído,
    // y confundirlos haría cargar la ficha vacía como si ARCA hubiera hablado.
    await expect(
      consultarPadron({
        ...BASE,
        fetch: fetchQueDevuelve("<html>error</html>", undefined, 500),
      })
    ).rejects.toThrow(ErrorPadron);
  });

  it("apunta a producción cuando el entorno es producción", async () => {
    const captura: { url?: string } = {};
    await consultarPadron({
      ...BASE,
      entorno: "produccion",
      fetch: fetchQueDevuelve("<a/>", captura),
    });
    expect(captura.url).toContain("aws.afip.gov.ar");
    expect(captura.url).not.toContain("awshomo");
  });
});

describe("el servicio", () => {
  it("se llama como lo espera el WSAA", () => {
    // Si este nombre no es exacto, el WSAA contesta que no está autorizado y
    // el error parece del trámite del certificado.
    expect(SERVICIO_PADRON).toBe("ws_sr_constancia_inscripcion");
  });
});
