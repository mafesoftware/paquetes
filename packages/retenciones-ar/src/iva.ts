/**
 * Retención de IVA: porcentaje sobre el IVA del comprobante (no sobre el
 * neto). Un proveedor monotributista factura sin discriminar IVA (factura
 * C) — se detecta por `ivaDelPago === 0n`, no por un flag aparte: "no
 * corresponde".
 *
 * En el ÚLTIMO pago del documento, la retención se calcula sobre el
 * `ivaDocumento` completo y se resta `retenidoDocumento` (lo ya retenido en
 * pagos anteriores) — así la suma de las retenciones de todos los pagos da
 * EXACTO el porcentaje sobre el IVA total, sin arrastrar el redondeo de
 * pagos parciales (el último ajusta para que la suma dé exacto).
 */
import type { CalculoRetencion, Exclusion } from "./tipos.js";
import { aplicarExclusion, aplicarPorcentaje, formatearPesos } from "./calculo.js";

export type ParametrosRetencionIva = {
  ivaDelPago: bigint;
  alicuotaSobreIva: string;
  retencionMinima: bigint;
  exclusion: Exclusion | null;
  fechaPago: string;
  ultimoPagoDelDocumento: boolean;
  ivaDocumento: bigint;
  retenidoDocumento: bigint;
};

export function retencionIva(p: ParametrosRetencionIva): CalculoRetencion {
  if (p.ivaDelPago === 0n) {
    return {
      regimen: "iva",
      concepto: "iva",
      base: 0n,
      alicuota: p.alicuotaSobreIva,
      minimoNoSujeto: 0n,
      importe: 0n,
      exclusionAplicada: null,
      explicacion: "monotributista: no corresponde",
    };
  }

  const base = p.ultimoPagoDelDocumento ? p.ivaDocumento : p.ivaDelPago;
  let importe = aplicarPorcentaje(base, p.alicuotaSobreIva);
  if (p.ultimoPagoDelDocumento) importe -= p.retenidoDocumento;
  if (importe < 0n) importe = 0n;
  importe = aplicarExclusion(importe, p.exclusion);
  if (importe < p.retencionMinima) importe = 0n;

  return {
    regimen: "iva",
    concepto: "iva",
    base,
    alicuota: p.alicuotaSobreIva,
    minimoNoSujeto: 0n,
    importe,
    exclusionAplicada: p.exclusion,
    explicacion: `${p.alicuotaSobreIva}% sobre IVA ${p.ultimoPagoDelDocumento ? "del documento" : "del pago"} ${formatearPesos(base)}`,
  };
}
