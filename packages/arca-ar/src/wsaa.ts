/**
 * WSAA: el servicio de autenticación de ARCA.
 *
 * El baile es siempre el mismo: se arma un TRA (un XML chiquito que dice qué
 * servicio se quiere usar y por cuánto tiempo), se firma en CMS con el
 * certificado que emitió ARCA, y se manda por SOAP a `loginCms`. La respuesta
 * trae el `token` y el `sign` que después viajan en CADA llamada al servicio
 * de negocio (WSFEv1).
 *
 * El ticket dura 12 horas y **pedir uno nuevo con uno vigente es un error**
 * ("El CEE ya posee un TA valido"): quien llama tiene que guardar el ticket y
 * reutilizarlo hasta que venza. Este módulo no guarda nada a propósito — no
 * sabe si quien lo usa tiene una base, un archivo o memoria.
 */

import { firmarCMSBase64 } from "./cms.js";
import { desescaparXml, escaparXml, valorDe } from "./xml.js";

export type Entorno = "produccion" | "homologacion";

const URL_WSAA: Record<Entorno, string> = {
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
};

export type Ticket = {
  token: string;
  sign: string;
  /** Cuándo vence, tal cual lo dijo ARCA. */
  expira: Date;
};

/** Una fecha en el ISO-8601 que espera el WSAA (sin milisegundos). */
function fechaWSAA(fecha: Date): string {
  return fecha.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * El TRA: el XML que se firma.
 *
 * La ventana va un rato para atrás y para adelante porque el reloj del
 * servidor de ARCA y el de quien llama nunca están de acuerdo: un TRA emitido
 * "ahora" exacto puede llegar "del futuro" y ser rechazado.
 */
export function armarTRA(opciones: {
  servicio: string;
  /** El "ahora" de quien llama. Inyectable para que los tests no dependan del reloj. */
  ahora?: Date;
}): string {
  const ahora = opciones.ahora ?? new Date();
  const desde = new Date(ahora.getTime() - 5 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<loginTicketRequest version="1.0">`,
    `<header>`,
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`,
    `<generationTime>${fechaWSAA(desde)}</generationTime>`,
    `<expirationTime>${fechaWSAA(hasta)}</expirationTime>`,
    `</header>`,
    `<service>${escaparXml(opciones.servicio)}</service>`,
    `</loginTicketRequest>`,
  ].join("\n");
}

/** El SOAP de `loginCms` con el CMS en base64 adentro. */
export function sobreLoginCms(cmsBase64: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">`,
    `<soapenv:Body>`,
    `<wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms>`,
    `</soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("");
}

export class ErrorWSAA extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorWSAA";
  }
}

/**
 * Pide un ticket de acceso para `servicio` (para facturar: `"wsfe"`).
 *
 * `fetch` es inyectable: los tests no hablan con ARCA, y quien corre en un
 * entorno raro puede envolverlo. Sin transacciones ni estado: el ticket que
 * vuelve lo guarda quien llamó.
 */
export async function solicitarTicket(opciones: {
  servicio: string;
  certificadoPem: string;
  clavePrivadaPem: string;
  entorno: Entorno;
  ahora?: Date;
  fetch?: typeof globalThis.fetch;
}): Promise<Ticket> {
  const traer = opciones.fetch ?? globalThis.fetch;
  const tra = armarTRA({ servicio: opciones.servicio, ahora: opciones.ahora });
  const cms = firmarCMSBase64(tra, opciones.certificadoPem, opciones.clavePrivadaPem);

  const respuesta = await traer(URL_WSAA[opciones.entorno], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: sobreLoginCms(cms),
  });

  const cuerpo = await respuesta.text();

  // Los errores del WSAA vienen como SOAP Fault, con el motivo en texto.
  const falla = valorDe(cuerpo, "faultstring");
  if (falla) throw new ErrorWSAA(`El WSAA rechazó el pedido: ${falla.trim()}`);
  if (!respuesta.ok)
    throw new ErrorWSAA(`El WSAA respondió ${respuesta.status}.`);

  // El ticket viene como XML ESCAPADO adentro de <loginCmsReturn>.
  const crudo = valorDe(cuerpo, "loginCmsReturn");
  if (!crudo) throw new ErrorWSAA("La respuesta del WSAA no trae el ticket.");
  const ticket = desescaparXml(crudo);

  const token = valorDe(ticket, "token");
  const sign = valorDe(ticket, "sign");
  const expira = valorDe(ticket, "expirationTime");
  if (!token || !sign || !expira)
    throw new ErrorWSAA("El ticket del WSAA vino incompleto.");

  return { token, sign, expira: new Date(expira) };
}
