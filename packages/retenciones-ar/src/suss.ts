/**
 * Retención SUSS: alícuota distinta si el pago
 * incluye mano de obra o no, sobre el neto del pago (sin acumulado
 * mensual — a diferencia de Ganancias).
 */
import type { CalculoRetencion, Exclusion } from "./tipos.js";
import { aplicarExclusion, aplicarPorcentaje, formatearPesos } from "./calculo.js";

export type ParametrosRetencionSuss = {
  netoPago: bigint;
  conManoDeObra: boolean;
  alicuotaConMO: string;
  alicuotaSinMO: string;
  retencionMinima: bigint;
  exclusion: Exclusion | null;
  fechaPago: string;
};

export function retencionSuss(p: ParametrosRetencionSuss): CalculoRetencion {
  const alicuota = p.conManoDeObra ? p.alicuotaConMO : p.alicuotaSinMO;
  let importe = aplicarExclusion(aplicarPorcentaje(p.netoPago, alicuota), p.exclusion);
  if (importe < p.retencionMinima) importe = 0n;

  return {
    regimen: "suss",
    concepto: p.conManoDeObra ? "con_mano_de_obra" : "sin_mano_de_obra",
    base: p.netoPago,
    alicuota,
    minimoNoSujeto: 0n,
    importe,
    exclusionAplicada: p.exclusion,
    explicacion: `${alicuota}% ${p.conManoDeObra ? "(con mano de obra)" : "(sin mano de obra)"} sobre ${formatearPesos(p.netoPago)}`,
  };
}
