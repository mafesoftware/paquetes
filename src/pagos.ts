import { pedirAMercadoPago, type Fetch } from "./http.js";

/** Los cinco estados con los que trabaja el resto del mundo. */
export type EstadoPago =
  | "aprobado"
  | "pendiente"
  | "rechazado"
  | "devuelto"
  | "contracargo";

export type PagoMP = {
  id: string;
  estado: EstadoPago;
  /** El estado tal cual lo dijo MP, para poder diagnosticar. */
  estadoCrudo: string;
  detalleEstado: string;
  referenciaExterna: string | null;
  preferenciaId: string | null;
  monto: number;
  moneda: string;
  creadoEn: string | null;
};

/**
 * Traduce el estado de MP a los cinco canónicos.
 *
 * Lo desconocido cae en `pendiente` a propósito: si MP inventa un estado nuevo,
 * el error seguro es "todavía no sé", no "cobrado" ni "cancelado".
 *
 * `charged_back` y `refunded` NO se juntan: la devolución la decidiste vos, el
 * contracargo te lo hicieron, y la dueña necesita distinguirlos.
 */
export function mapearEstado(estadoCrudo: string | null | undefined): EstadoPago {
  switch ((estadoCrudo ?? "").toLowerCase()) {
    case "approved":
    case "authorized":
      return "aprobado";
    case "refunded":
      return "devuelto";
    case "charged_back":
      return "contracargo";
    case "rejected":
    case "cancelled":
      return "rechazado";
    default:
      return "pendiente";
  }
}

type PagoCrudo = {
  id: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string | null;
  preference_id?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
};

function normalizar(crudo: PagoCrudo): PagoMP {
  return {
    id: String(crudo.id),
    estado: mapearEstado(crudo.status),
    estadoCrudo: crudo.status ?? "",
    detalleEstado: crudo.status_detail ?? "",
    referenciaExterna: crudo.external_reference ?? null,
    preferenciaId: crudo.preference_id ?? null,
    monto: crudo.transaction_amount ?? 0,
    moneda: crudo.currency_id ?? "ARS",
    creadoEn: crudo.date_created ?? null,
  };
}

/** El pago según MP. `null` si MP dice que no existe (aviso adelantado). */
export async function traerPago(opciones: {
  pagoId: string;
  accessToken: string;
  fetch?: Fetch;
}): Promise<PagoMP | null> {
  const crudo = await pedirAMercadoPago<PagoCrudo>({
    ruta: `/v1/payments/${encodeURIComponent(opciones.pagoId)}`,
    accessToken: opciones.accessToken,
    fetch: opciones.fetch,
  });
  return crudo ? normalizar(crudo) : null;
}

/**
 * Todos los pagos de una referencia externa. Es la base de la reconciliación:
 * cuando el webhook se perdió no tenemos id de pago, solo el número de pedido.
 */
export async function buscarPagosPorReferencia(opciones: {
  referenciaExterna: string;
  accessToken: string;
  fetch?: Fetch;
}): Promise<PagoMP[]> {
  const respuesta = await pedirAMercadoPago<{ results?: PagoCrudo[] }>({
    ruta: `/v1/payments/search?external_reference=${encodeURIComponent(
      opciones.referenciaExterna
    )}`,
    accessToken: opciones.accessToken,
    fetch: opciones.fetch,
  });
  return (respuesta?.results ?? []).map(normalizar);
}

/**
 * De varios intentos sobre el mismo pedido, cuál manda.
 *
 * No es "el último": una clienta puede tener tres rechazos y un aprobado, y lo
 * que vale es el aprobado. El contracargo sí le gana al aprobado porque es lo
 * último que pasó de verdad con esa plata. A igual peso, el más nuevo.
 */
const PESO: Record<EstadoPago, number> = {
  contracargo: 5,
  devuelto: 4,
  aprobado: 3,
  pendiente: 2,
  rechazado: 1,
};

export function pagoMasRelevante(pagos: PagoMP[]): PagoMP | null {
  let mejor: PagoMP | null = null;
  for (const pago of pagos) {
    if (!mejor) {
      mejor = pago;
      continue;
    }
    const diferencia = PESO[pago.estado] - PESO[mejor.estado];
    if (diferencia > 0) mejor = pago;
    else if (diferencia === 0 && (pago.creadoEn ?? "") > (mejor.creadoEn ?? "")) {
      mejor = pago;
    }
  }
  return mejor;
}
