/**
 * Imputación automática de un cobro a las deudas (cuotas vencidas) de una
 * cuenta corriente.
 *
 * Orden legal de imputación de pagos habitual en la región (ante varias
 * cuotas vencidas, el cobro se aplica primero a TODOS los intereses, de la
 * cuota más vieja a la más nueva, luego a todos los ajustes, y recién
 * después al capital): nunca se imputa capital de una cuota mientras quede
 * interés o ajuste pendiente de una cuota más vieja.
 */
import type { Moneda } from "@mafesoftware/plata-ar";

/** Deuda pendiente de una cuota, descompuesta por concepto. */
export type Deuda = {
  cuotaId: string;
  vencimiento: string; // YYYY-MM-DD
  interes: bigint;
  ajuste: bigint;
  capital: bigint;
  moneda: Moneda;
};

export type Imputacion = {
  cuotaId: string;
  concepto: "interes" | "ajuste" | "capital";
  centavos: bigint;
};

const ORDEN_CONCEPTO = { interes: 0, ajuste: 1, capital: 2 } as const satisfies Record<
  Imputacion["concepto"],
  number
>;

type Renglon = {
  cuotaId: string;
  vencimiento: string;
  concepto: Imputacion["concepto"];
  monto: bigint;
};

/**
 * Reparte `disponible` (centavos de un cobro) entre las `deudas`, en el
 * orden interés → ajuste → capital y, dentro de cada concepto, de la cuota
 * más vieja (`vencimiento` más chico) a la más nueva.
 *
 * Invariante: la suma de `imputaciones[].centavos` más `sobrante` es
 * siempre igual a `disponible`.
 */
export function imputarAutomatico(
  deudas: readonly Deuda[],
  disponible: bigint,
): { imputaciones: Imputacion[]; sobrante: bigint } {
  const renglones = ordenarRenglones(deudas);

  const imputaciones: Imputacion[] = [];
  let restante = disponible;

  for (const renglon of renglones) {
    if (restante <= 0n) break;

    const centavos = restante < renglon.monto ? restante : renglon.monto;
    imputaciones.push({ cuotaId: renglon.cuotaId, concepto: renglon.concepto, centavos });
    restante -= centavos;
  }

  return { imputaciones, sobrante: restante };
}

function ordenarRenglones(deudas: readonly Deuda[]): Renglon[] {
  const renglones: Renglon[] = deudas.flatMap((d) => [
    { cuotaId: d.cuotaId, vencimiento: d.vencimiento, concepto: "interes" as const, monto: d.interes },
    { cuotaId: d.cuotaId, vencimiento: d.vencimiento, concepto: "ajuste" as const, monto: d.ajuste },
    { cuotaId: d.cuotaId, vencimiento: d.vencimiento, concepto: "capital" as const, monto: d.capital },
  ]);

  return renglones
    .filter((r) => r.monto > 0n)
    .sort((a, b) => {
      const porConcepto = ORDEN_CONCEPTO[a.concepto] - ORDEN_CONCEPTO[b.concepto];
      if (porConcepto !== 0) return porConcepto;

      const porVencimiento = a.vencimiento.localeCompare(b.vencimiento);
      if (porVencimiento !== 0) return porVencimiento;

      return a.cuotaId.localeCompare(b.cuotaId);
    });
}
