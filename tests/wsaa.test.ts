/**
 * El WSAA: el TRA, el sobre SOAP y la lectura del ticket. Todo con `fetch`
 * falso — la suite no habla con ARCA nunca.
 */

import { describe, expect, it } from "vitest";
import { armarTRA, solicitarTicket, ErrorWSAA } from "../src/wsaa.js";
import { valorDe } from "../src/xml.js";
import { certificadoDePrueba } from "./certificado.js";

const AHORA = new Date("2026-08-17T12:00:00Z");

describe("armarTRA", () => {
  it("pide 12 horas y arranca la ventana 5 minutos atrás", () => {
    const tra = armarTRA({ servicio: "wsfe", ahora: AHORA });
    expect(valorDe(tra, "service")).toBe("wsfe");
    expect(valorDe(tra, "generationTime")).toBe("2026-08-17T11:55:00Z");
    expect(valorDe(tra, "expirationTime")).toBe("2026-08-18T00:00:00Z");
    expect(valorDe(tra, "uniqueId")).toBe(String(Math.floor(AHORA.getTime() / 1000)));
  });

  it("escapa el nombre del servicio: viene de configuración, no del código", () => {
    const tra = armarTRA({ servicio: "ws<fe>", ahora: AHORA });
    expect(tra).toContain("ws&lt;fe&gt;");
  });
});

function respuestaConTicket() {
  const ticket =
    `<loginTicketResponse><credentials><token>TOKEN.123</token><sign>FIRMA==</sign></credentials>` +
    `<header><expirationTime>2026-08-18T00:00:00-03:00</expirationTime></header></loginTicketResponse>`;
  const escapado = ticket.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0"?><soapenv:Envelope><soapenv:Body><loginCmsReturn>${escapado}</loginCmsReturn></soapenv:Body></soapenv:Envelope>`;
}

describe("solicitarTicket", () => {
  it("firma el TRA, lo manda por SOAP y devuelve el ticket", async () => {
    const { certPem, clavePem } = certificadoDePrueba();
    let urlLlamada = "";
    let cuerpoMandado = "";
    const falso = (async (url: unknown, init?: RequestInit) => {
      urlLlamada = String(url);
      cuerpoMandado = String(init?.body);
      return new Response(respuestaConTicket(), { status: 200 });
    }) as typeof fetch;

    const ticket = await solicitarTicket({
      servicio: "wsfe",
      certificadoPem: certPem,
      clavePrivadaPem: clavePem,
      entorno: "homologacion",
      ahora: AHORA,
      fetch: falso,
    });

    expect(urlLlamada).toContain("wsaahomo.afip.gov.ar");
    expect(cuerpoMandado).toContain("<wsaa:in0>");
    // Lo que viaja adentro es un CMS en base64, no el XML pelado.
    expect(cuerpoMandado).not.toContain("loginTicketRequest");
    expect(ticket.token).toBe("TOKEN.123");
    expect(ticket.sign).toBe("FIRMA==");
    expect(ticket.expira.toISOString()).toBe("2026-08-18T03:00:00.000Z");
  });

  it("un SOAP Fault se convierte en un error que se puede leer", async () => {
    const { certPem, clavePem } = certificadoDePrueba();
    const falso = (async () =>
      new Response(
        `<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultstring>El CEE ya posee un TA valido</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
        { status: 500 }
      )) as typeof fetch;

    await expect(
      solicitarTicket({
        servicio: "wsfe",
        certificadoPem: certPem,
        clavePrivadaPem: clavePem,
        entorno: "homologacion",
        fetch: falso,
      })
    ).rejects.toThrow(/TA valido/);
  });

  it("un ticket incompleto no pasa en silencio", async () => {
    const { certPem, clavePem } = certificadoDePrueba();
    const falso = (async () =>
      new Response(
        `<soapenv:Envelope><soapenv:Body><loginCmsReturn>&lt;x&gt;&lt;/x&gt;</loginCmsReturn></soapenv:Body></soapenv:Envelope>`,
        { status: 200 }
      )) as typeof fetch;

    await expect(
      solicitarTicket({
        servicio: "wsfe",
        certificadoPem: certPem,
        clavePrivadaPem: clavePem,
        entorno: "homologacion",
        fetch: falso,
      })
    ).rejects.toThrow(ErrorWSAA);
  });
});
