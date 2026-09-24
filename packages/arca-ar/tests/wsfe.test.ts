/**
 * El WSFEv1 con `fetch` falso: qué XML sale y cómo se leen las respuestas.
 *
 * Lo más importante acá es el borde de la plata: el paquete habla CENTAVOS y
 * el wire de ARCA habla decimales con dos lugares. La conversión pasa UNA
 * vez, y estos tests son los que la clavan.
 */

import { describe, expect, it } from "vitest";
import {
  consultarComprobante,
  ErrorWsfe,
  fechaWire,
  solicitarCae,
  ultimoAutorizado,
} from "../src/wsfe.js";

const AUTH = { token: "T", sign: "S", cuit: "20111111112" };

function fetchQueDevuelve(xml: string, captura?: { body?: string; url?: string }) {
  return (async (url: unknown, init?: RequestInit) => {
    if (captura) {
      captura.url = String(url);
      captura.body = String(init?.body);
    }
    return new Response(xml, { status: 200 });
  }) as typeof fetch;
}

const RESPUESTA_APROBADA = `<?xml version="1.0"?><soap:Envelope><soap:Body><FECAESolicitarResponse>
<FeCabResp><Resultado>A</Resultado></FeCabResp>
<FeDetResp><FECAEDetResponse><CAE>75123456789012</CAE><CAEFchVto>20260827</CAEFchVto>
<Observaciones><Obs><Code>10217</Code><Msg> Fecha vencimiento pago informada </Msg></Obs></Observaciones>
</FECAEDetResponse></FeDetResp></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

const COMPROBANTE = {
  puntoVenta: 3,
  tipoComprobante: 6,
  numero: 128,
  concepto: 1 as const,
  docTipo: 96,
  docNumero: "30123456",
  condicionIVAReceptorId: 5,
  fecha: new Date("2026-08-17T15:00:00Z"),
  totalCent: 1210000, // $12.100,00
  netoCent: 1000000, // $10.000,00
  ivaCent: 210000, // $2.100,00
  iva: [{ alicuotaId: 5, baseImponibleCent: 1000000, importeCent: 210000 }],
};

describe("solicitarCae", () => {
  it("los centavos salen al wire como decimales con dos lugares", async () => {
    const captura: { body?: string; url?: string } = {};
    await solicitarCae({
      auth: AUTH,
      comprobante: COMPROBANTE,
      entorno: "homologacion",
      fetch: fetchQueDevuelve(RESPUESTA_APROBADA, captura),
    });

    expect(captura.url).toContain("wswhomo.afip.gov.ar");
    expect(captura.body).toContain("<ar:ImpTotal>12100.00</ar:ImpTotal>");
    expect(captura.body).toContain("<ar:ImpNeto>10000.00</ar:ImpNeto>");
    expect(captura.body).toContain("<ar:ImpIVA>2100.00</ar:ImpIVA>");
    expect(captura.body).toContain("<ar:BaseImp>10000.00</ar:BaseImp>");
    expect(captura.body).toContain("<ar:CbteFch>20260817</ar:CbteFch>");
    // RG 5616: sin la condición del receptor, ARCA rechaza. Tiene que viajar.
    expect(captura.body).toContain("<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>");
    expect(captura.body).toContain("<ar:CbteDesde>128</ar:CbteDesde>");
    expect(captura.body).toContain("<ar:CbteHasta>128</ar:CbteHasta>");
  });

  it("devuelve el CAE, su vencimiento y las observaciones", async () => {
    const r = await solicitarCae({
      auth: AUTH,
      comprobante: COMPROBANTE,
      entorno: "homologacion",
      fetch: fetchQueDevuelve(RESPUESTA_APROBADA),
    });
    expect(r.resultado).toBe("aprobado");
    expect(r.cae).toBe("75123456789012");
    expect(r.caeVence?.toISOString()).toBe("2026-08-27T03:00:00.000Z");
    expect(r.observaciones).toEqual([
      { codigo: 10217, mensaje: "Fecha vencimiento pago informada" },
    ]);
  });

  it("un comprobante que no cierra se frena ANTES de llamar a ARCA", async () => {
    let llamo = false;
    const falso = (async () => {
      llamo = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await expect(
      solicitarCae({
        auth: AUTH,
        comprobante: { ...COMPROBANTE, totalCent: 1210001 },
        entorno: "homologacion",
        fetch: falso,
      })
    ).rejects.toThrow(/no cierra/);
    expect(llamo).toBe(false);
  });

  it("la plata en centavos no enteros es un bug de quien llama: explota", async () => {
    await expect(
      solicitarCae({
        auth: AUTH,
        comprobante: { ...COMPROBANTE, totalCent: 1210000.5, netoCent: 1000000.5 },
        entorno: "homologacion",
        fetch: fetchQueDevuelve(RESPUESTA_APROBADA),
      })
    ).rejects.toThrow(/centavos enteros/);
  });

  it("los errores de ARCA llegan con código y mensaje", async () => {
    const conError = `<soap:Envelope><soap:Body><Errors><Err><Code>10016</Code><Msg>Campo CbteDesde no coincide</Msg></Err></Errors></soap:Body></soap:Envelope>`;
    await expect(
      solicitarCae({
        auth: AUTH,
        comprobante: COMPROBANTE,
        entorno: "homologacion",
        fetch: fetchQueDevuelve(conError),
      })
    ).rejects.toThrow(/10016/);

    try {
      await solicitarCae({
        auth: AUTH,
        comprobante: COMPROBANTE,
        entorno: "homologacion",
        fetch: fetchQueDevuelve(conError),
      });
    } catch (e) {
      expect((e as ErrorWsfe).errores).toEqual([
        { codigo: 10016, mensaje: "Campo CbteDesde no coincide" },
      ]);
    }
  });

  it("un rechazo NO es una excepción: es un resultado que se guarda", async () => {
    const rechazada = RESPUESTA_APROBADA.replace(">A<", ">R<").replace(
      "<CAE>75123456789012</CAE>",
      "<CAE></CAE>"
    );
    const r = await solicitarCae({
      auth: AUTH,
      comprobante: COMPROBANTE,
      entorno: "homologacion",
      fetch: fetchQueDevuelve(rechazada),
    });
    expect(r.resultado).toBe("rechazado");
    expect(r.cae).toBe("");
  });
});

describe("solicitarCae con asociados (las notas de crédito)", () => {
  it("manda el CbtesAsoc que ARCA exige para una NC", async () => {
    const captura: { body?: string } = {};
    await solicitarCae({
      auth: AUTH,
      comprobante: {
        ...COMPROBANTE,
        tipoComprobante: 8, // NC B
        asociados: [{ tipo: 6, puntoVenta: 3, numero: 128, cuitEmisor: "20111111112" }],
      },
      entorno: "homologacion",
      fetch: fetchQueDevuelve(RESPUESTA_APROBADA, captura),
    });
    expect(captura.body).toContain(
      "<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>6</ar:Tipo><ar:PtoVta>3</ar:PtoVta><ar:Nro>128</ar:Nro><ar:Cuit>20111111112</ar:Cuit></ar:CbteAsoc></ar:CbtesAsoc>"
    );
  });
});

describe("ultimoAutorizado", () => {
  it("devuelve el número y manda punto de venta y tipo", async () => {
    const captura: { body?: string } = {};
    const xml = `<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse><CbteNro>127</CbteNro></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`;
    const n = await ultimoAutorizado({
      auth: AUTH,
      puntoVenta: 3,
      tipoComprobante: 6,
      entorno: "produccion",
      fetch: fetchQueDevuelve(xml, captura),
    });
    expect(n).toBe(127);
    expect(captura.body).toContain("<ar:PtoVta>3</ar:PtoVta>");
    expect(captura.body).toContain("<ar:CbteTipo>6</ar:CbteTipo>");
  });

  it("un SOAP Fault avisa con el texto de ARCA", async () => {
    const xml = `<soap:Envelope><soap:Body><soap:Fault><faultstring>Token invalido</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
    await expect(
      ultimoAutorizado({
        auth: AUTH,
        puntoVenta: 3,
        tipoComprobante: 6,
        entorno: "homologacion",
        fetch: fetchQueDevuelve(xml),
      })
    ).rejects.toThrow(/Token invalido/);
  });
});

describe("fechaWire", () => {
  it("ocho dígitos, sin guiones", () => {
    expect(fechaWire(new Date("2026-08-17T15:00:00Z"))).toBe("20260817");
  });
});

/* ============================================================
   FECompConsultar
   ============================================================ */

describe("consultar un comprobante ya emitido", () => {
  const BASE = {
    auth: AUTH,
    puntoVenta: 1,
    tipoComprobante: 6,
    numero: 42,
    entorno: "homologacion" as const,
  };

  it("devuelve el CAE que dice ARCA", async () => {
    const captura: { body?: string } = {};
    const r = await consultarComprobante({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soap:Envelope><soap:Body><FECompConsultarResponse><ResultGet>
          <CodAutorizacion>75123456789012</CodAutorizacion>
          <FchVto>20261231</FchVto>
          <Resultado>A</Resultado>
        </ResultGet></FECompConsultarResponse></soap:Body></soap:Envelope>`,
        captura
      ),
    });

    expect(r.existe).toBe(true);
    expect(r.cae).toBe("75123456789012");
    expect(r.vencimientoCae).toBe("20261231");
    expect(r.resultado).toBe("A");

    // Los tres datos que identifican el comprobante: sin alguno, ARCA
    // contesta por otro.
    expect(captura.body).toContain("<ar:CbteNro>42</ar:CbteNro>");
    expect(captura.body).toContain("<ar:PtoVta>1</ar:PtoVta>");
    expect(captura.body).toContain("<ar:CbteTipo>6</ar:CbteTipo>");
  });

  it("el 602 significa «no lo tengo», no una falla", async () => {
    /*
     * ARCA devuelve sus errores adentro de un 200. Tratar el 602 como
     * excepción haría que verificar un comprobante inexistente tire, cuando
     * "ARCA no lo tiene" es la respuesta que hay que mostrar — y la más grave
     * de todas, porque significa que el CAE guardado nunca se autorizó.
     */
    const r = await consultarComprobante({
      ...BASE,
      fetch: fetchQueDevuelve(
        `<soap:Envelope><soap:Body><Errors><Err>
          <Code>602</Code><Msg>Sin Resultados</Msg>
        </Err></Errors></soap:Body></soap:Envelope>`
      ),
    });

    expect(r.existe).toBe(false);
    expect(r.cae).toBe("");
    expect(r.observaciones).toMatch(/no tiene registrado/i);
  });

  it("cualquier OTRO código sí es un problema", async () => {
    await expect(
      consultarComprobante({
        ...BASE,
        fetch: fetchQueDevuelve(
          `<soap:Envelope><soap:Body><Errors><Err>
            <Code>600</Code><Msg>Token invalido</Msg>
          </Err></Errors></soap:Body></soap:Envelope>`
        ),
      })
    ).rejects.toThrow(ErrorWsfe);
  });

  it("el 602 tolerado NO tapa a un error que venga al lado", async () => {
    // Tolerar un código es tolerar ESE código, no la lista entera.
    await expect(
      consultarComprobante({
        ...BASE,
        fetch: fetchQueDevuelve(
          `<soap:Envelope><soap:Body><Errors>
            <Err><Code>602</Code><Msg>Sin Resultados</Msg></Err>
            <Err><Code>600</Code><Msg>Token invalido</Msg></Err>
          </Errors></soap:Body></soap:Envelope>`
        ),
      })
    ).rejects.toThrow(/600/);
  });

  it("otros métodos siguen tirando con el 602", async () => {
    /*
     * La tolerancia es de esta consulta y no del WSFE: un 602 pidiendo el
     * último autorizado sí es una falla.
     */
    await expect(
      ultimoAutorizado({
        auth: AUTH,
        puntoVenta: 3,
        tipoComprobante: 6,
        entorno: "homologacion",
        fetch: fetchQueDevuelve(
          `<soap:Envelope><soap:Body><Errors><Err>
            <Code>602</Code><Msg>Sin Resultados</Msg>
          </Err></Errors></soap:Body></soap:Envelope>`
        ),
      })
    ).rejects.toThrow(ErrorWsfe);
  });
});
