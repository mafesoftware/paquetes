/**
 * Gestión de cobranza: agrupar el listado de deudores por banda de aging
 * (para un resumen/gráfico) y decidir si la ÚLTIMA promesa de pago
 * registrada sobre una cuenta ya venció sin que se haya registrado un pago.
 */
import type { Moneda } from "@mafesoftware/plata-ar";
import type { AgingBanda } from "./mora.js";

export type TipoGestion = "llamada" | "mensaje" | "nota" | "promesa_pago";

/** Los campos de una gestión que hacen falta para decidir la alerta (subconjunto de la fila real de gestiones de cobranza). */
export type GestionParaAlerta = {
  tipo: TipoGestion;
  /** `YYYY-MM-DD`, solo presente en `tipo:"promesa_pago"`. */
  fechaPromesa: string | null;
  /** `YYYY-MM-DD` (o cualquier ISO con ese prefijo) — para elegir la promesa MÁS RECIENTE cuando hay varias. */
  creadoEn: string;
};

/**
 * `true` si la promesa de pago más reciente de la cuenta ya venció
 * (`fechaPromesa < hoy`). Pensada para invocarse solo sobre cuentas que YA
 * están en mora (el llamador filtra eso antes) — si la deuda ya se hubiera
 * cobrado, la cuenta no debería llegar acá. Una promesa más vieja que una
 * posterior no cuenta: una promesa nueva reemplaza a la anterior.
 */
export function promesaPendienteVencida(gestiones: readonly GestionParaAlerta[], hoy: string): boolean {
  const promesas = gestiones.filter((g): g is GestionParaAlerta & { fechaPromesa: string } => g.tipo === "promesa_pago" && g.fechaPromesa !== null);
  if (promesas.length === 0) return false;
  const ultima = promesas.reduce((mas_reciente, actual) => (actual.creadoEn > mas_reciente.creadoEn ? actual : mas_reciente));
  return ultima.fechaPromesa < hoy;
}

/** Los campos de una fila del listado de deudores que hacen falta para el resumen por aging. */
export type FilaParaAging = { aging: AgingBanda; deudaVencida: Partial<Record<Moneda, bigint>> };

export type ResumenAging = { cantidad: number; deudaVencida: Partial<Record<Moneda, bigint>> };

const BANDAS: readonly AgingBanda[] = ["0-30", "31-60", "61-90", "90+"];

/** Resumen por banda de aging: cantidad de cuentas + deuda vencida Σ por moneda, banda por banda. */
export function agruparPorAging(filas: readonly FilaParaAging[]): Record<AgingBanda, ResumenAging> {
  const resumen = Object.fromEntries(BANDAS.map((b) => [b, { cantidad: 0, deudaVencida: {} }])) as Record<AgingBanda, ResumenAging>;
  for (const f of filas) {
    const r = resumen[f.aging];
    r.cantidad += 1;
    for (const [moneda, centavos] of Object.entries(f.deudaVencida) as [Moneda, bigint][]) {
      r.deudaVencida[moneda] = (r.deudaVencida[moneda] ?? 0n) + centavos;
    }
  }
  return resumen;
}
