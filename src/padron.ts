/**
 * El padrón de ARCA: quién es un CUIT.
 *
 * Es el servicio `ws_sr_constancia_inscripcion` («Consulta de Constancia de
 * Inscripción»), y sirve para no tipear a mano la razón social ni la condición
 * frente al IVA de un cliente o un proveedor. Lo segundo es lo que importa:
 * **la condición decide la letra de la factura**, y equivocarla se descubre
 * semanas después, cuando el contador pide la A que nunca se emitió.
 *
 * ## Es un servicio APARTE del wsfe, con su propio ticket
 *
 * Hay que habilitarlo en el certificado desde el sitio de ARCA, además de
 * `wsfe`. Sin ese trámite el WSAA contesta que el servicio no está autorizado,
 * y ese error es del trámite, no del código. El ticket tampoco se comparte: el
 * del wsfe no sirve acá, por eso está `ticketDePadron`.
 *
 * ## El endpoint es otro host
 *
 * No es `servicios1.afip.gov.ar` sino `aws.afip.gov.ar` (y `awshomo` en
 * homologación): el padrón es un servicio Java, no el .NET del WSFE, y por eso
 * su respuesta puede traer prefijos de espacio de nombres que el WSFE no usa.
 *
 * `fetch` es inyectable, como en todo el paquete.
 */

import { escaparXml, valorDe } from "./xml.js";
import { solicitarTicket, type Entorno, type Ticket } from "./wsaa.js";
import type { CondicionIVA } from "./letra.js";

/** El nombre con el que ARCA conoce a este servicio en el WSAA. */
export const SERVICIO_PADRON = "ws_sr_constancia_inscripcion";

const URL_PADRON: Record<Entorno, string> = {
  produccion: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5",
  homologacion:
    "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5",
};

export class ErrorPadron extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorPadron";
  }
}

/** Lo que el padrón sabe de un CUIT. */
export type PersonaEnPadron = {
  /** El CUIT consultado, solo dígitos. */
  cuit: string;
  /** Razón social, o "Apellido, Nombre" para una persona física. */
  nombre: string;
  /**
   * La condición frente al IVA. **`null` = ARCA no la informó**, y quien carga
   * la elige a mano: ver `condicionDesdePadron`.
   */
  condicionIva: CondicionIVA | null;
  domicilio: string;
  localidad: string;
  provincia: string;
  codigoPostal: string;
};

/**
 * Traduce lo que informa el padrón a una condición frente al IVA.
 *
 * ARCA **no informa una condición**: informa los "impuestos" en los que la
 * persona está inscripta. El 30 es IVA (responsable inscripto) y el 20 es
 * monotributo.
 *
 * Dos reglas que parecen detalles y no lo son:
 *
 * 1. **El monotributo gana sobre el IVA.** Una persona puede figurar con los
 *    dos, y la factura que emite es C.
 * 2. **Sin ninguno de los dos no se asume nada** y devuelve `null`. Caer en
 *    "consumidor final" por defecto haría que un responsable inscripto reciba
 *    una factura B, que es exactamente el error que este servicio viene a
 *    evitar.
 */
export function condicionDesdePadron(datos: {
  impuestos: number[];
  categoriaMonotributo: boolean;
}): CondicionIVA | null {
  if (datos.categoriaMonotributo || datos.impuestos.includes(20))
    return "monotributo";
  if (datos.impuestos.includes(30)) return "responsable_inscripto";
  return null;
}

/**
 * Busca un CUIT en el padrón.
 *
 * Devuelve `null` cuando ARCA no lo conoce: **no es un error**, es la
 * respuesta para un CUIT que no existe o que está dado de baja, y quien está
 * cargando la ficha tiene que poder seguir a mano.
 */
export async function consultarPadron(opciones: {
  token: string;
  sign: string;
  /** El CUIT de quien consulta (el comercio). */
  cuitConsultante: string;
  /** El CUIT que se busca. */
  cuit: string;
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<PersonaEnPadron | null> {
  const traer = opciones.fetch ?? globalThis.fetch;
  const buscado = opciones.cuit.replace(/\D/g, "");
  const consultante = opciones.cuitConsultante.replace(/\D/g, "");

  // Los CUIT viajan SIN guiones: ARCA rechaza los formateados.
  const sobre =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">` +
    `<soapenv:Body><a5:getPersona>` +
    `<token>${escaparXml(opciones.token)}</token>` +
    `<sign>${escaparXml(opciones.sign)}</sign>` +
    `<cuitRepresentada>${escaparXml(consultante)}</cuitRepresentada>` +
    `<idPersona>${escaparXml(buscado)}</idPersona>` +
    `</a5:getPersona></soapenv:Body></soapenv:Envelope>`;

  const respuesta = await traer(URL_PADRON[opciones.entorno], {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: sobre,
  });
  const cuerpo = await respuesta.text();

  if (!respuesta.ok)
    throw new ErrorPadron(`El padrón respondió ${respuesta.status}.`);

  // ARCA contesta 200 con un `<faultstring>` cuando el CUIT no existe.
  if (valorDe(cuerpo, "faultstring") !== null) return null;
  if (valorDe(cuerpo, "idPersona") === null) return null;

  const nombre = (
    valorDe(cuerpo, "razonSocial") ??
    [valorDe(cuerpo, "apellido"), valorDe(cuerpo, "nombre")]
      .filter((v) => v !== null && v.trim() !== "")
      .join(", ")
  ).trim();

  const impuestos = [
    ...cuerpo.matchAll(/<(?:\w+:)?idImpuesto>(\d+)<\/(?:\w+:)?idImpuesto>/g),
  ].map((m) => Number(m[1]));

  const texto = (etiqueta: string) => (valorDe(cuerpo, etiqueta) ?? "").trim();

  return {
    cuit: buscado,
    nombre,
    condicionIva: condicionDesdePadron({
      impuestos,
      categoriaMonotributo: /categoriaMonotributo/.test(cuerpo),
    }),
    domicilio: texto("direccion"),
    localidad: texto("localidad"),
    provincia: texto("descripcionProvincia"),
    codigoPostal: texto("codPostal"),
  };
}

/**
 * Pide un ticket del WSAA para el PADRÓN.
 *
 * Es un servicio distinto de `wsfe` y necesita el suyo. **Va sin caché a
 * propósito**, al revés que el de facturar: la consulta al padrón es
 * esporádica —alguien cargando una ficha— y guardarlo obligaría a quien usa el
 * paquete a agregar otra columna para algo que se usa dos veces por semana. Si
 * algún día se consulta en cada venta, esto quiere caché del lado de quien
 * llama, igual que el del wsfe.
 */
export async function ticketDePadron(opciones: {
  certificadoPem: string;
  clavePrivadaPem: string;
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<Ticket> {
  return solicitarTicket({
    servicio: SERVICIO_PADRON,
    certificadoPem: opciones.certificadoPem,
    clavePrivadaPem: opciones.clavePrivadaPem,
    entorno: opciones.entorno,
    fetch: opciones.fetch,
  });
}
