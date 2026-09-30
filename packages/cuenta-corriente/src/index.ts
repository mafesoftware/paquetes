/**
 * Cuenta corriente de un plan de cuotas: interés por mora, imputación
 * automática de cobros, gestión de cobranza, libro de movimientos con
 * saldo corrido, resumen y estado de liquidación de una cuota.
 *
 * Núcleo puro (regla 1 de diseño del monorepo, ver CLAUDE.md): sin base de
 * datos, sin framework — toda entrada (fechas, montos, tasas) entra por
 * parámetro. Multimoneda: todo lo que suma centavos lo hace por moneda
 * separado (`Partial<Record<Moneda, bigint>>`), nunca mezclando ARS con
 * USD.
 *
 * - `interesMora`/`aging`: interés simple por mora (con gracia y tramos de
 *   tasa) y la banda de aging correspondiente a unos días de atraso.
 * - `imputarAutomatico`: reparte un cobro entre las deudas pendientes en el
 *   orden interés → ajuste → capital, de la cuota más vieja a la más nueva.
 * - `promesaPendienteVencida`/`agruparPorAging`: gestión de cobranza — si
 *   la última promesa de pago registrada ya venció, y un resumen por banda
 *   de aging (cantidad + deuda vencida Σ por moneda).
 * - `construirLibro`/`saldoPorMoneda`: el libro de movimientos de la cuenta
 *   (débitos/créditos) con su saldo corrido, un acumulador por moneda.
 * - `resumenDe`/`montoVigente`: el resumen de la cuenta (saldo, deuda
 *   vencida, días de mora máximos, próximo vencimiento) a partir de sus
 *   cuotas.
 * - `transicionCuota`/`esEstadoCuota`: la máquina de estados de liquidación
 *   de una cuota (`pendiente` → `pendiente_indice`/`liquidada`).
 */
export { interesMora, aging, type TramoTasa, type AgingBanda } from "./mora.js";
export { imputarAutomatico, type Deuda, type Imputacion } from "./imputacion.js";
export {
  promesaPendienteVencida,
  agruparPorAging,
  type TipoGestion,
  type GestionParaAlerta,
  type FilaParaAging,
  type ResumenAging,
} from "./cobranza.js";
export {
  construirLibro,
  saldoPorMoneda,
  type TipoMovimientoLibro,
  type MovimientoLibro,
  type FilaLibro,
} from "./libro.js";
export { resumenDe, montoVigente, type CuotaParaResumen, type ResumenCuentaCorriente } from "./resumen.js";
export {
  ESTADOS_CUOTA,
  EVENTOS_CUOTA,
  esEstadoCuota,
  transicionCuota,
  type EstadoCuota,
  type EventoCuota,
} from "./estados.js";
