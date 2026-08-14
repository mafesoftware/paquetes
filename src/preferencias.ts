import { ErrorMP } from "./errores.js";
import { pedirAMercadoPago, type Fetch } from "./http.js";

export type ItemPreferencia = {
  id: string;
  titulo: string;
  descripcion?: string;
  cantidad: number;
  precioUnitario: number;
  /** Default "ARS". */
  moneda?: string;
  /** Categoría de MP: "services", "others"… Ayuda a bajar el rechazo. */
  categoria?: string;
};

export type PreferenciaCreada = {
  id: string;
  initPoint: string;
  sandboxInitPoint: string | null;
};

/**
 * La comisión de la plataforma, en pesos, a partir de puntos básicos.
 *
 * Puntos básicos (250 = 2,5%) y no porcentaje para poder cobrar medios puntos
 * sin meter decimales en la base.
 */
export function calcularComision(
  items: ItemPreferencia[],
  puntosBasicos: number
): number {
  const total = items.reduce((n, i) => n + i.precioUnitario * i.cantidad, 0);
  return Math.round((total * puntosBasicos) / 10_000);
}

/**
 * Crea la preferencia de Checkout Pro y devuelve a dónde mandar a la clienta.
 *
 * Se firma con el token de la VENDEDORA: la plata le entra a ella y la comisión
 * de la plataforma viaja adentro como `application_fee`.
 */
export async function crearPreferencia(opciones: {
  accessToken: string;
  items: ItemPreferencia[];
  referenciaExterna: string;
  urlDeNotificacion: string;
  urlsDeVuelta: { exito: string; error: string; pendiente: string };
  pagador?: { nombre?: string; email?: string };
  comisionEnPuntosBasicos?: number;
  venceEn?: Date | null;
  descriptorEnResumen?: string;
  metadata?: Record<string, string>;
  fetch?: Fetch;
}): Promise<PreferenciaCreada> {
  if (opciones.items.length === 0) {
    throw new ErrorMP("rechazado", "No se puede crear una preferencia sin items");
  }

  const comision = calcularComision(
    opciones.items,
    opciones.comisionEnPuntosBasicos ?? 0
  );

  const cuerpo: Record<string, unknown> = {
    items: opciones.items.map((item) => ({
      id: item.id,
      title: item.titulo,
      ...(item.descripcion ? { description: item.descripcion } : {}),
      ...(item.categoria ? { category_id: item.categoria } : {}),
      quantity: item.cantidad,
      unit_price: item.precioUnitario,
      currency_id: item.moneda ?? "ARS",
    })),
    external_reference: opciones.referenciaExterna,
    notification_url: opciones.urlDeNotificacion,
    back_urls: {
      success: opciones.urlsDeVuelta.exito,
      failure: opciones.urlsDeVuelta.error,
      pending: opciones.urlsDeVuelta.pendiente,
    },
    auto_return: "approved",
  };

  // Con comisión 0 NO se manda el campo: MP rechaza `application_fee: 0`.
  if (comision > 0) cuerpo.application_fee = comision;

  if (opciones.pagador?.nombre || opciones.pagador?.email) {
    cuerpo.payer = {
      ...(opciones.pagador.nombre ? { name: opciones.pagador.nombre } : {}),
      ...(opciones.pagador.email ? { email: opciones.pagador.email } : {}),
    };
  }

  // Lo que ve la compradora en el resumen de su tarjeta. Baja los contracargos
  // de "no reconozco este consumo".
  if (opciones.descriptorEnResumen) {
    cuerpo.statement_descriptor = opciones.descriptorEnResumen;
  }

  if (opciones.venceEn) {
    cuerpo.expires = true;
    cuerpo.expiration_date_to = opciones.venceEn.toISOString();
  }

  if (opciones.metadata) cuerpo.metadata = opciones.metadata;

  const respuesta = await pedirAMercadoPago<{
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
  }>({
    ruta: "/checkout/preferences",
    metodo: "POST",
    accessToken: opciones.accessToken,
    cuerpoJson: cuerpo,
    fetch: opciones.fetch,
  });

  if (!respuesta?.id || !respuesta.init_point) {
    throw new ErrorMP(
      "rechazado",
      "Mercado Pago creó la preferencia pero no devolvió a dónde pagar"
    );
  }

  return {
    id: respuesta.id,
    initPoint: respuesta.init_point,
    sandboxInitPoint: respuesta.sandbox_init_point ?? null,
  };
}
