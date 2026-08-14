import { type Fetch } from "./http.js";
import {
  buscarPagosPorReferencia,
  pagoMasRelevante,
  traerPago,
  type EstadoPago,
  type PagoMP,
} from "./pagos.js";

export type CambioDePago = {
  referenciaExterna: string;
  pagoId: string;
  estado: EstadoPago;
  pago: PagoMP;
};

/**
 * La persistencia, que el paquete no tiene.
 *
 * `aplicar` devuelve `true` si escribió de verdad. La app lo implementa con un
 * UPDATE condicionado al estado de origen (`... WHERE id = ? AND estado = ?`) y
 * devuelve si afectó filas: así, de dos webhooks simultáneos, uno solo gana.
 */
export type PuertosDePedido = {
  cargarPedido: (
    referenciaExterna: string
  ) => Promise<{ estadoPago: EstadoPago | null } | null>;
  aplicar: (cambio: CambioDePago) => Promise<boolean>;
};

export type ResultadoProceso =
  | {
      aplicado: true;
      estado: EstadoPago;
      pagoId: string;
      referenciaExterna: string;
    }
  | {
      aplicado: false;
      motivo:
        | "pago_inexistente"
        | "sin_referencia"
        | "pedido_desconocido"
        | "sin_cambios";
    };

/**
 * Procesa un aviso de pago.
 *
 * El orden importa y es la razón de ser de esta función:
 *
 * 1. **Nunca le creemos al cuerpo del webhook**: se le vuelve a preguntar el
 *    pago a la API de MP. El body es forjable y además llega desordenado.
 * 2. Se busca el pedido por la referencia externa.
 * 3. Si el estado no cambia, no se escribe.
 * 4. La escritura la hace la app, condicionada al estado de origen.
 */
export async function procesarNotificacionDePago(
  opciones: { pagoId: string; accessToken: string; fetch?: Fetch } & PuertosDePedido
): Promise<ResultadoProceso> {
  const pago = await traerPago({
    pagoId: opciones.pagoId,
    accessToken: opciones.accessToken,
    fetch: opciones.fetch,
  });
  if (!pago) return { aplicado: false, motivo: "pago_inexistente" };

  return aplicarPago(pago, opciones);
}

/**
 * La red de abajo: le pregunta a MP por todos los pagos de un pedido.
 *
 * Se usa cuando no hay id de pago porque el webhook nunca llegó — al volver de
 * MP a la cuenta de la clienta, y antes de dar un pedido por vencido.
 */
export async function reconciliarPago(
  opciones: {
    referenciaExterna: string;
    accessToken: string;
    fetch?: Fetch;
  } & PuertosDePedido
): Promise<ResultadoProceso> {
  const pagos = await buscarPagosPorReferencia({
    referenciaExterna: opciones.referenciaExterna,
    accessToken: opciones.accessToken,
    fetch: opciones.fetch,
  });
  const pago = pagoMasRelevante(pagos);
  if (!pago) return { aplicado: false, motivo: "pago_inexistente" };

  return aplicarPago(pago, opciones);
}

async function aplicarPago(
  pago: PagoMP,
  puertos: PuertosDePedido
): Promise<ResultadoProceso> {
  const referenciaExterna = pago.referenciaExterna;
  if (!referenciaExterna) return { aplicado: false, motivo: "sin_referencia" };

  const pedido = await puertos.cargarPedido(referenciaExterna);
  if (!pedido) return { aplicado: false, motivo: "pedido_desconocido" };

  if (pedido.estadoPago === pago.estado) {
    return { aplicado: false, motivo: "sin_cambios" };
  }

  const escribio = await puertos.aplicar({
    referenciaExterna,
    pagoId: pago.id,
    estado: pago.estado,
    pago,
  });
  if (!escribio) return { aplicado: false, motivo: "sin_cambios" };

  return {
    aplicado: true,
    estado: pago.estado,
    pagoId: pago.id,
    referenciaExterna,
  };
}
