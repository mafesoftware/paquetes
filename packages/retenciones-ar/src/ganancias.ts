/**
 * Retención de Ganancias: mínimo no sujeto
 * ACUMULADO en el mes (por proveedor + concepto — lo acumula quien llama,
 * acá solo entra ya sumado), alícuota fija (inscripto/no inscripto) o
 * escala progresiva (ej. honorarios, código SICORE 116). El no inscripto
 * tributa SIN mínimo no sujeto (RG vigente): se retiene sobre el neto de
 * ESTE pago, no sobre el acumulado.
 */
import type { CalculoRetencion, EscalaTramo, Exclusion, TablaGanancias } from "./tipos.js";
import { aplicarExclusion, aplicarPorcentaje, formatearPesos, max0 } from "./calculo.js";

export type ParametrosRetencionGanancias = {
  netoPago: bigint;
  /** Acumulado de netos pagados en el mes a este proveedor/concepto, INCLUYENDO este pago. */
  acumuladoNetoMes: bigint;
  /** Lo efectivamente retenido en el mes ANTES de este pago (no lo "calculado": si un pago quedó en 0 por el mínimo, no suma acá). */
  retenidoMes: bigint;
  inscripto: boolean;
  tabla: TablaGanancias;
  exclusion: Exclusion | null;
  fechaPago: string;
};

/** El tramo de la escala al que pertenece `base` — intervalos semiabiertos `[desde, hasta)`, el último sin `hasta` (abierto). */
function tramoDe(escala: readonly EscalaTramo[], base: bigint): EscalaTramo {
  for (const tramo of escala) {
    if (base >= tramo.desde && (tramo.hasta === null || base < tramo.hasta)) return tramo;
  }
  return escala[escala.length - 1]!;
}

export function retencionGanancias(p: ParametrosRetencionGanancias): CalculoRetencion {
  if (!p.inscripto) {
    // No inscripto: sin mínimo no sujeto, sin retención mínima — se retiene sobre el neto de este pago solo.
    const importe = aplicarExclusion(aplicarPorcentaje(p.netoPago, p.tabla.alicuotaNoInscripto), p.exclusion);
    return {
      regimen: "ganancias",
      concepto: p.tabla.concepto,
      base: p.netoPago,
      alicuota: p.tabla.alicuotaNoInscripto,
      minimoNoSujeto: 0n,
      importe,
      exclusionAplicada: p.exclusion,
      explicacion: `No inscripto: ${p.tabla.alicuotaNoInscripto}% sobre ${formatearPesos(p.netoPago)} (sin mínimo)`,
    };
  }

  const base = max0(p.acumuladoNetoMes - p.tabla.minimoNoSujeto);
  let retencionSobreElAcumulado: bigint;
  let alicuotaTexto: string;
  if (p.tabla.alicuotaInscripto === "escala") {
    const tramo = tramoDe(p.tabla.escala ?? [], base);
    retencionSobreElAcumulado = tramo.fijo + aplicarPorcentaje(base - tramo.desde, tramo.porcentaje);
    alicuotaTexto = tramo.porcentaje;
  } else {
    retencionSobreElAcumulado = aplicarPorcentaje(base, p.tabla.alicuotaInscripto);
    alicuotaTexto = p.tabla.alicuotaInscripto;
  }

  let importe = max0(retencionSobreElAcumulado - p.retenidoMes);
  importe = aplicarExclusion(importe, p.exclusion);
  if (importe < p.tabla.retencionMinima) importe = 0n;

  return {
    regimen: "ganancias",
    concepto: p.tabla.concepto,
    base,
    alicuota: alicuotaTexto,
    minimoNoSujeto: p.tabla.minimoNoSujeto,
    importe,
    exclusionAplicada: p.exclusion,
    explicacion: `Base ${formatearPesos(base)} = pagos del mes ${formatearPesos(p.acumuladoNetoMes)} − mínimo ${formatearPesos(p.tabla.minimoNoSujeto)}; ${alicuotaTexto}%`,
  };
}
