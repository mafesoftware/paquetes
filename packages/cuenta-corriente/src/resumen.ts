/**
 * Resumen de una cuenta corriente (saldo, deuda vencida, mora, próximo
 * vencimiento) a partir de sus cuotas.
 */
import { diasEntre } from "@mafesoftware/fechas-ar";
import type { Moneda } from "@mafesoftware/plata-ar";

/** Los campos de una cuota que hacen falta para el resumen (subconjunto de la fila real de cuotas de la app). */
export type CuotaParaResumen = {
  moneda: Moneda;
  vencimiento: string; // YYYY-MM-DD
  montoBaseCentavos: bigint;
  montoAjustadoCentavos: bigint | null;
  tipo: "cuota" | "documento_ajuste";
  cobradaEn: string | null; // YYYY-MM-DD, o null si no está cobrada
  /**
   * Una cuota `cancelada` (rescisión) o `refinanciada` (plan reemplazado)
   * no cuenta en el saldo/deuda de la cuenta corriente — sin este campo
   * `resumenDe` no tiene forma de distinguirlas de una cuota viva.
   */
  estado?: "pendiente" | "pendiente_indice" | "liquidada" | "cancelada" | "refinanciada";
};

export type ResumenCuentaCorriente = {
  cobradoAFecha: Partial<Record<Moneda, bigint>>;
  saldoActual: Partial<Record<Moneda, bigint>>;
  deudaVencida: Partial<Record<Moneda, bigint>>;
  diasMoraMax: number;
  proximoVencimiento: string | null;
};

/** El monto vigente de una cuota: el ajustado si ya se liquidó, si no el base (una nota de débito no tiene ajuste propio, siempre es su base). */
export function montoVigente(c: CuotaParaResumen): bigint {
  if (c.tipo === "documento_ajuste") return c.montoBaseCentavos;
  return c.montoAjustadoCentavos ?? c.montoBaseCentavos;
}

function sumar(acc: Partial<Record<Moneda, bigint>>, moneda: Moneda, monto: bigint): void {
  acc[moneda] = (acc[moneda] ?? 0n) + monto;
}

/**
 * Arma el resumen a partir de las cuotas NO ANULADAS de una cuenta y la
 * fecha de corte `hoy` (YYYY-MM-DD). Todo por moneda separado.
 */
export function resumenDe(cuotas: readonly CuotaParaResumen[], hoy: string): ResumenCuentaCorriente {
  const cobradoAFecha: Partial<Record<Moneda, bigint>> = {};
  const saldoActual: Partial<Record<Moneda, bigint>> = {};
  const deudaVencida: Partial<Record<Moneda, bigint>> = {};
  let diasMoraMax = 0;
  let proximoVencimiento: string | null = null;

  for (const c of cuotas) {
    // Una cuota reemplazada (cancelada por rescisión, o refinanciada) no
    // aporta ni a lo cobrado ni al saldo ni a la deuda — el nuevo plan
    // (refinanciación) o la liquidación (rescisión) son los que valen de
    // acá en más.
    if (c.estado === "cancelada" || c.estado === "refinanciada") continue;

    const monto = montoVigente(c);

    if (c.cobradaEn !== null) {
      if (c.cobradaEn <= hoy) sumar(cobradoAFecha, c.moneda, monto);
      continue; // ya no debe: no aporta a saldo/deuda/próximo vencimiento
    }

    sumar(saldoActual, c.moneda, monto);

    if (c.vencimiento < hoy) {
      sumar(deudaVencida, c.moneda, monto);
      diasMoraMax = Math.max(diasMoraMax, diasEntre(c.vencimiento, hoy));
    } else if (proximoVencimiento === null || c.vencimiento < proximoVencimiento) {
      proximoVencimiento = c.vencimiento;
    }
  }

  return { cobradoAFecha, saldoActual, deudaVencida, diasMoraMax, proximoVencimiento };
}
