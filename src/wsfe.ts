/**
 * WSFEv1: el servicio de facturación electrónica de ARCA.
 *
 * Dos llamadas sostienen todo el flujo:
 *
 * - `ultimoAutorizado`: qué número tiene el último comprobante autorizado de
 *   un punto de venta y tipo. **El número lo asigna quien emite** (último +
 *   1), no ARCA — por eso esta pregunta se hace antes de cada emisión.
 * - `solicitarCae`: pide el CAE de UN comprobante. La respuesta puede ser
 *   aprobado, aprobado con observaciones (igual vale) o rechazado con el
 *   motivo.
 *
 * **Toda la plata entra y sale en CENTAVOS.** El wire de ARCA habla decimales
 * con dos lugares ("1234.56"): la conversión pasa una sola vez, acá, que es
 * el borde — la misma regla que en el resto de los sistemas que usan este
 * paquete.
 */

import { bloquesDe, escaparXml, valorDe } from "./xml.js";
import type { Entorno } from "./wsaa.js";

const URL_WSFE: Record<Entorno, string> = {
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
};

/** El ticket del WSAA más el CUIT de quien emite: viaja en cada llamada. */
export type AutorizacionWsfe = {
  token: string;
  sign: string;
  cuit: string;
};

export class ErrorWsfe extends Error {
  /** Los errores que devolvió ARCA, con su código. */
  errores: { codigo: number; mensaje: string }[];
  constructor(mensaje: string, errores: { codigo: number; mensaje: string }[] = []) {
    super(mensaje);
    this.name = "ErrorWsfe";
    this.errores = errores;
  }
}

/** Centavos → el decimal con punto que espera el wire de ARCA. */
function plataWire(centavos: number): string {
  if (!Number.isInteger(centavos))
    throw new ErrorWsfe(`La plata va en centavos enteros, llegó ${centavos}.`);
  return (centavos / 100).toFixed(2);
}

/** Una fecha a los ocho dígitos (`yyyymmdd`) del WSFEv1. */
export function fechaWire(fecha: Date): string {
  return fecha.toISOString().slice(0, 10).replace(/-/g, "");
}

function sobre(metodo: string, auth: AutorizacionWsfe, cuerpo: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">`,
    `<soapenv:Body><ar:${metodo}>`,
    `<ar:Auth><ar:Token>${escaparXml(auth.token)}</ar:Token><ar:Sign>${escaparXml(auth.sign)}</ar:Sign><ar:Cuit>${escaparXml(auth.cuit)}</ar:Cuit></ar:Auth>`,
    cuerpo,
    `</ar:${metodo}></soapenv:Body></soapenv:Envelope>`,
  ].join("");
}

async function llamar(opciones: {
  metodo: string;
  auth: AutorizacionWsfe;
  cuerpo: string;
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<string> {
  const traer = opciones.fetch ?? globalThis.fetch;
  const respuesta = await traer(URL_WSFE[opciones.entorno], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${opciones.metodo}`,
    },
    body: sobre(opciones.metodo, opciones.auth, opciones.cuerpo),
  });
  const cuerpo = await respuesta.text();

  const falla = valorDe(cuerpo, "faultstring");
  if (falla) throw new ErrorWsfe(`El WSFE rechazó el pedido: ${falla.trim()}`);
  if (!respuesta.ok) throw new ErrorWsfe(`El WSFE respondió ${respuesta.status}.`);

  // Los errores "de negocio" no son faults: vienen en <Errors><Err>.
  const errores = bloquesDe(cuerpo, "Err").map((e) => ({
    codigo: Number(valorDe(e, "Code") ?? 0),
    mensaje: (valorDe(e, "Msg") ?? "").trim(),
  }));
  if (errores.length > 0)
    throw new ErrorWsfe(
      `ARCA devolvió ${errores.length === 1 ? "un error" : "errores"}: ` +
        errores.map((e) => `${e.codigo} ${e.mensaje}`).join(" · "),
      errores
    );

  return cuerpo;
}

/* ============================================================
   Último autorizado
   ============================================================ */

export async function ultimoAutorizado(opciones: {
  auth: AutorizacionWsfe;
  puntoVenta: number;
  tipoComprobante: number;
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<number> {
  const cuerpo = await llamar({
    metodo: "FECompUltimoAutorizado",
    auth: opciones.auth,
    cuerpo: `<ar:PtoVta>${opciones.puntoVenta}</ar:PtoVta><ar:CbteTipo>${opciones.tipoComprobante}</ar:CbteTipo>`,
    entorno: opciones.entorno,
    fetch: opciones.fetch,
  });
  const numero = valorDe(cuerpo, "CbteNro");
  if (numero === null)
    throw new ErrorWsfe("La respuesta no trae el último número autorizado.");
  return Number(numero);
}

/* ============================================================
   Solicitar CAE
   ============================================================ */

/** Un renglón de IVA del comprobante: la base y el impuesto, en centavos. */
export type IvaComprobante = {
  /** Id de alícuota de ARCA (5 = 21%). Ver `ALICUOTAS_IVA`. */
  alicuotaId: number;
  baseImponibleCent: number;
  importeCent: number;
};

export type ComprobanteParaCae = {
  puntoVenta: number;
  /** Código de ARCA (1 = FA, 6 = FB, 11 = FC…). Ver `tipoComprobante()`. */
  tipoComprobante: number;
  /** El número que se está emitiendo: último autorizado + 1. */
  numero: number;
  /** 1 = productos, 2 = servicios, 3 = ambos. */
  concepto: 1 | 2 | 3;
  /** Tipo y número de documento del receptor. Ver `DOC_TIPO`. */
  docTipo: number;
  docNumero: string;
  /** Condición de IVA del receptor (RG 5616). Ver `CONDICION_IVA_ID`. */
  condicionIVAReceptorId: number;
  fecha: Date;
  /** Todo en centavos: el total, el neto gravado, el IVA y lo no gravado/exento. */
  totalCent: number;
  netoCent: number;
  ivaCent: number;
  noGravadoCent?: number;
  exentoCent?: number;
  tributosCent?: number;
  /** El desglose por alícuota. Vacío en los comprobantes C (el IVA no se discrimina). */
  iva?: IvaComprobante[];
  /**
   * Los comprobantes que este corrige. **Obligatorio en las notas de crédito
   * y de débito**: ARCA exige saber a qué factura le está dando vuelta la
   * plata, y sin esto lo observa o lo rechaza según la letra.
   */
  asociados?: {
    tipo: number;
    puntoVenta: number;
    numero: number;
    /** El CUIT de quien emitió el asociado (normalmente el propio). */
    cuitEmisor?: string;
  }[];
};

export type ResultadoCae = {
  resultado: "aprobado" | "rechazado";
  cae: string;
  /** Vencimiento del CAE: hasta cuándo el comprobante se puede entregar. */
  caeVence: Date | null;
  /**
   * Observaciones de ARCA. Un comprobante APROBADO puede traerlas: vale
   * igual, pero conviene guardarlas — son el aviso de que algo se está
   * declarando raro.
   */
  observaciones: { codigo: number; mensaje: string }[];
};

export async function solicitarCae(opciones: {
  auth: AutorizacionWsfe;
  comprobante: ComprobanteParaCae;
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<ResultadoCae> {
  const c = opciones.comprobante;

  const suma =
    c.netoCent + c.ivaCent + (c.noGravadoCent ?? 0) + (c.exentoCent ?? 0) + (c.tributosCent ?? 0);
  if (suma !== c.totalCent)
    throw new ErrorWsfe(
      `El comprobante no cierra: neto + IVA + no gravado + exento + tributos da ${suma} y el total dice ${c.totalCent}. ARCA lo va a rechazar; mejor frenarlo acá.`
    );

  const iva =
    c.iva && c.iva.length > 0
      ? `<ar:Iva>${c.iva
          .map(
            (i) =>
              `<ar:AlicIva><ar:Id>${i.alicuotaId}</ar:Id><ar:BaseImp>${plataWire(
                i.baseImponibleCent
              )}</ar:BaseImp><ar:Importe>${plataWire(i.importeCent)}</ar:Importe></ar:AlicIva>`
          )
          .join("")}</ar:Iva>`
      : "";

  const asociados =
    c.asociados && c.asociados.length > 0
      ? `<ar:CbtesAsoc>${c.asociados
          .map(
            (a) =>
              `<ar:CbteAsoc><ar:Tipo>${a.tipo}</ar:Tipo><ar:PtoVta>${a.puntoVenta}</ar:PtoVta><ar:Nro>${a.numero}</ar:Nro>${
                a.cuitEmisor ? `<ar:Cuit>${escaparXml(a.cuitEmisor)}</ar:Cuit>` : ""
              }</ar:CbteAsoc>`
          )
          .join("")}</ar:CbtesAsoc>`
      : "";

  const detalle = [
    `<ar:FECAEDetRequest>`,
    `<ar:Concepto>${c.concepto}</ar:Concepto>`,
    `<ar:DocTipo>${c.docTipo}</ar:DocTipo>`,
    `<ar:DocNro>${escaparXml(c.docNumero)}</ar:DocNro>`,
    `<ar:CbteDesde>${c.numero}</ar:CbteDesde>`,
    `<ar:CbteHasta>${c.numero}</ar:CbteHasta>`,
    `<ar:CbteFch>${fechaWire(c.fecha)}</ar:CbteFch>`,
    `<ar:ImpTotal>${plataWire(c.totalCent)}</ar:ImpTotal>`,
    `<ar:ImpTotConc>${plataWire(c.noGravadoCent ?? 0)}</ar:ImpTotConc>`,
    `<ar:ImpNeto>${plataWire(c.netoCent)}</ar:ImpNeto>`,
    `<ar:ImpOpEx>${plataWire(c.exentoCent ?? 0)}</ar:ImpOpEx>`,
    `<ar:ImpTrib>${plataWire(c.tributosCent ?? 0)}</ar:ImpTrib>`,
    `<ar:ImpIVA>${plataWire(c.ivaCent)}</ar:ImpIVA>`,
    `<ar:MonId>PES</ar:MonId>`,
    `<ar:MonCotiz>1</ar:MonCotiz>`,
    `<ar:CondicionIVAReceptorId>${c.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>`,
    asociados,
    iva,
    `</ar:FECAEDetRequest>`,
  ].join("");

  const cuerpo = await llamar({
    metodo: "FECAESolicitar",
    auth: opciones.auth,
    cuerpo:
      `<ar:FeCAEReq>` +
      `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${c.puntoVenta}</ar:PtoVta><ar:CbteTipo>${c.tipoComprobante}</ar:CbteTipo></ar:FeCabReq>` +
      `<ar:FeDetReq>${detalle}</ar:FeDetReq>` +
      `</ar:FeCAEReq>`,
    entorno: opciones.entorno,
    fetch: opciones.fetch,
  });

  const resultado = valorDe(cuerpo, "Resultado");
  const cae = valorDe(cuerpo, "CAE") ?? "";
  const vence = valorDe(cuerpo, "CAEFchVto");
  const observaciones = bloquesDe(cuerpo, "Obs").map((o) => ({
    codigo: Number(valorDe(o, "Code") ?? 0),
    mensaje: (valorDe(o, "Msg") ?? "").trim(),
  }));

  return {
    resultado: resultado === "A" ? "aprobado" : "rechazado",
    cae,
    caeVence: vence
      ? new Date(`${vence.slice(0, 4)}-${vence.slice(4, 6)}-${vence.slice(6, 8)}T00:00:00-03:00`)
      : null,
    observaciones,
  };
}

/* ============================================================
   ¿Está vivo?
   ============================================================ */

/** `FEDummy`: si los tres servidores de ARCA están arriba. Para diagnósticos. */
export async function estadoDelServicio(opciones: {
  entorno: Entorno;
  fetch?: typeof globalThis.fetch;
}): Promise<{ app: string; db: string; auth: string }> {
  const traer = opciones.fetch ?? globalThis.fetch;
  const respuesta = await traer(URL_WSFE[opciones.entorno], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://ar.gov.afip.dif.FEV1/FEDummy",
    },
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>`,
  });
  const cuerpo = await respuesta.text();
  return {
    app: valorDe(cuerpo, "AppServer") ?? "?",
    db: valorDe(cuerpo, "DbServer") ?? "?",
    auth: valorDe(cuerpo, "AuthServer") ?? "?",
  };
}
