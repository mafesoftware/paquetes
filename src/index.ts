/**
 * @mafesoftware/arca-ar — facturación electrónica de ARCA (ex AFIP).
 *
 * Tres piezas, en el orden en que se usan:
 *
 * 1. **WSAA** (`solicitarTicket`): el ticket de acceso, firmando el TRA en
 *    CMS con el certificado que emitió ARCA. Dura 12 horas y quien llama lo
 *    guarda — pedir otro con uno vigente es un error de ARCA.
 * 2. **La letra** (`tipoComprobante`): qué comprobante corresponde según la
 *    condición de IVA del emisor y del receptor.
 * 3. **WSFEv1** (`ultimoAutorizado`, `solicitarCae`): el número lo asigna
 *    quien emite (último + 1) y ARCA devuelve el CAE.
 *
 * Toda la plata viaja en CENTAVOS; el wire decimal de ARCA es un detalle de
 * este paquete. `fetch` es inyectable en todas las llamadas.
 */

export {
  armarTRA,
  solicitarTicket,
  sobreLoginCms,
  ErrorWSAA,
  type Entorno,
  type Ticket,
} from "./wsaa.js";

export { firmarCMS, firmarCMSBase64, pemADer, emisorYSerie } from "./cms.js";

export {
  letraPara,
  tipoComprobante,
  alicuotaPorId,
  ALICUOTAS_IVA,
  CONDICION_IVA_ID,
  DOC_TIPO,
  type CondicionIVA,
  type Letra,
  type ClaseComprobante,
} from "./letra.js";

export {
  solicitarCae,
  ultimoAutorizado,
  estadoDelServicio,
  fechaWire,
  ErrorWsfe,
  type AutorizacionWsfe,
  type ComprobanteParaCae,
  type IvaComprobante,
  type ResultadoCae,
} from "./wsfe.js";
