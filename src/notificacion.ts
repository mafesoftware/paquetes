export type Notificacion = {
  /** El tipo tal como llegó, en minúsculas. */
  tipo: string | null;
  /** El id del recurso (para un pago, el id del pago). */
  dataId: string | null;
  esPago: boolean;
  esContracargo: boolean;
};

/**
 * Normaliza el aviso de Mercado Pago.
 *
 * Existe porque MP manda el id en cinco lugares según la versión del webhook y
 * el tipo en tres. La query le gana al cuerpo a propósito: cuando MP reintenta
 * un aviso, el id viaja en la URL.
 *
 * Es sincrónica y recibe el cuerpo ya parseado para que se pueda testear sin
 * fabricar un Request; el adaptador de Next hace el `await request.json()`.
 */
export function leerNotificacion(entrada: {
  url: string;
  cuerpo: unknown;
}): Notificacion {
  const query = new URL(entrada.url).searchParams;
  const cuerpo = esObjeto(entrada.cuerpo) ? entrada.cuerpo : {};
  const data = esObjeto(cuerpo.data) ? cuerpo.data : {};

  const dataId =
    texto(query.get("data.id")) ??
    texto(query.get("data_id")) ??
    texto(query.get("id")) ??
    texto(data.id) ??
    texto(cuerpo.id) ??
    null;

  const tipoCrudo =
    texto(cuerpo.type) ??
    texto(cuerpo.topic) ??
    texto(query.get("type")) ??
    texto(query.get("topic")) ??
    null;

  const tipo = tipoCrudo ? tipoCrudo.toLowerCase() : null;
  const esContracargo = tipo !== null && tipo.startsWith("chargeback");
  const esPago =
    tipo !== null &&
    !esContracargo &&
    (tipo === "payment" || tipo.startsWith("payment."));

  return { tipo, dataId, esPago, esContracargo };
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Devuelve el valor como string no vacío, o undefined. MP manda ids numéricos. */
function texto(valor: unknown): string | undefined {
  if (typeof valor === "string" && valor.trim() !== "") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return undefined;
}
