/**
 * Retención de IIBB: alícuota del padrón de la
 * jurisdicción si el CUIT figura (`alicuotaPadron`), si no la alícuota por
 * defecto de la fixture/config (`alicuotaNoPadron`) — con explicación
 * distinta para que se note que faltó importar el padrón. Convenio
 * Multilateral aplica primero el `baseCmPct` (coeficiente de la
 * jurisdicción) sobre el neto, y recién sobre esa base la alícuota.
 */
import type { CalculoRetencion, Exclusion, Jurisdiccion } from "./tipos.js";
import { aplicarExclusion, aplicarPorcentaje, formatearPesos } from "./calculo.js";

export type ParametrosRetencionIibb = {
  netoPago: bigint;
  jurisdiccion: Jurisdiccion;
  alicuotaPadron: string | null;
  alicuotaNoPadron: string;
  convenioMultilateral: boolean;
  baseCmPct: string;
  exclusion: Exclusion | null;
  fechaPago: string;
};

export function retencionIibb(p: ParametrosRetencionIibb): CalculoRetencion {
  const enPadron = p.alicuotaPadron !== null;
  const alicuota = p.alicuotaPadron ?? p.alicuotaNoPadron;
  const base = p.convenioMultilateral ? aplicarPorcentaje(p.netoPago, p.baseCmPct) : p.netoPago;
  const importe = aplicarExclusion(aplicarPorcentaje(base, alicuota), p.exclusion);
  const periodo = p.fechaPago.slice(0, 7);

  return {
    regimen: "iibb",
    concepto: String(p.jurisdiccion),
    base,
    alicuota,
    minimoNoSujeto: 0n,
    importe,
    exclusionAplicada: p.exclusion,
    explicacion: enPadron
      ? `${p.jurisdiccion} ${alicuota}% sobre ${formatearPesos(base)}`
      : `no figura en el padrón ${p.jurisdiccion} de ${periodo}`,
  };
}
