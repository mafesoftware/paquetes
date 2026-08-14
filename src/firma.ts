import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ¿Este aviso lo mandó Mercado Pago de verdad?
 *
 * MP firma con HMAC-SHA256 sobre `id:<dataId>;request-id:<requestId>;ts:<ts>;`
 * y manda el resultado en la cabecera `x-signature` como `ts=...,v1=<hex>`.
 *
 * Sin secreto configurado el default es RECHAZAR. Es deliberado: un webhook sin
 * firma verificable deja que cualquiera POSTee "este pago está aprobado" y se
 * lleve la mercadería. `permitirSinSecreto` existe solo para poder probar en
 * local sin dar de alta el secreto, y la app es la que decide cuándo prenderlo
 * (el paquete no mira `NODE_ENV`).
 */
export function verificarFirmaWebhook(opciones: {
  cabeceraFirma: string | null;
  requestId: string | null;
  dataId: string | null;
  secreto: string | null;
  permitirSinSecreto?: boolean;
}): boolean {
  if (!opciones.secreto) return opciones.permitirSinSecreto === true;

  const { cabeceraFirma, requestId } = opciones;
  if (!cabeceraFirma || !requestId || !opciones.dataId) return false;

  const partes = new Map<string, string>();
  for (const parte of cabeceraFirma.split(",")) {
    const [clave, valor] = parte.split("=").map((x) => x.trim());
    if (clave && valor) partes.set(clave, valor);
  }

  const ts = partes.get("ts");
  const v1 = partes.get("v1");
  if (!ts || !v1) return false;

  // MP normaliza a minúsculas los ids que no son puramente numéricos.
  const dataId = /^[0-9]+$/.test(opciones.dataId)
    ? opciones.dataId
    : opciones.dataId.toLowerCase();

  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const calculado = createHmac("sha256", opciones.secreto)
    .update(manifiesto)
    .digest("hex");

  // timingSafeEqual explota si los largos difieren, así que se chequea antes.
  if (calculado.length !== v1.length) return false;
  try {
    return timingSafeEqual(Buffer.from(calculado), Buffer.from(v1));
  } catch {
    return false;
  }
}
