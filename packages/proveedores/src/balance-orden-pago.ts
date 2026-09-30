/**
 * Balance de una orden de pago a un proveedor: "Σ medios de pago = Σ
 * imputaciones (+ anticipo)". PURA: sin DB, sin framework.
 */
import type { Moneda } from "@mafesoftware/plata-ar";

export type MontoConMoneda = { monto: bigint; moneda: Moneda };

/** Σ agrupada por moneda — cada una se balancea por separado (multi-caja multi-moneda), nunca se suman ARS con USD. */
export function totalPorMoneda(items: readonly MontoConMoneda[]): Partial<Record<Moneda, bigint>> {
  const totales: Partial<Record<Moneda, bigint>> = {};
  for (const item of items) totales[item.moneda] = (totales[item.moneda] ?? 0n) + item.monto;
  return totales;
}

export type ImputacionParaBalance = MontoConMoneda & {
  /** `true` = esta porción se paga consumiendo un anticipo YA existente, no pide plata nueva en medios de pago. */
  consumeAnticipo: boolean;
};

export type ResultadoBalanceOp = { ok: true } | { ok: false; error: string; moneda: Moneda; diferencia: bigint };

/**
 * ¿Los medios de pago cubren EXACTAMENTE lo que hace falta pagar con plata
 * nueva, moneda por moneda? Las imputaciones que consumen un anticipo
 * existente no exigen plata nueva — esa plata ya se movió cuando se generó
 * el anticipo.
 */
export function validarBalanceOp(medios: readonly MontoConMoneda[], imputaciones: readonly ImputacionParaBalance[]): ResultadoBalanceOp {
  const totalMedios = totalPorMoneda(medios);
  const totalRequerido = totalPorMoneda(imputaciones.filter((i) => !i.consumeAnticipo));
  const monedas = new Set<Moneda>([...(Object.keys(totalMedios) as Moneda[]), ...(Object.keys(totalRequerido) as Moneda[])]);

  for (const moneda of monedas) {
    const disponible = totalMedios[moneda] ?? 0n;
    const requerido = totalRequerido[moneda] ?? 0n;
    if (disponible !== requerido) {
      return {
        ok: false,
        error: `Los medios de pago en ${moneda} ($${disponible}) no coinciden con lo imputado ($${requerido}).`,
        moneda,
        diferencia: disponible - requerido,
      };
    }
  }
  return { ok: true };
}

/** No se puede pagar más que el saldo pendiente de un documento. */
export function excedeSaldoDocumento(montoAImputar: bigint, saldoPendiente: bigint): boolean {
  return montoAImputar > saldoPendiente;
}

/** Saldo disponible de un anticipo: lo que todavía no se aplicó contra ningún documento. */
export function saldoDisponibleAnticipo(monto: bigint, montoAplicado: bigint): bigint {
  return monto - montoAplicado;
}
