/**
 * Validaciones de cheques de terceros: quien consume este paquete las corre
 * ANTES de tocar su base.
 */
import { diasEntre } from "@mafesoftware/fechas-ar";

export type Resultado = { ok: true } | { ok: false; error: string };

/**
 * Una fecha de pago demasiado lejos de la emisión es un plazo irrazonable
 * para un cheque diferido, sea cual sea su origen. Se mide desde la fecha de
 * EMISIÓN. `diasLimite` por defecto 360 — ajustable si otra plaza usa otro
 * tope.
 */
export function validarFechaPago(fechaEmision: string, fechaPago: string, diasLimite = 360): Resultado {
  const dias = diasEntre(fechaEmision, fechaPago);
  if (dias > diasLimite) return { ok: false, error: `La fecha de pago no puede ser más de ${diasLimite} días posterior a la emisión.` };
  return { ok: true };
}

/**
 * No se puede depositar antes de la fecha de pago del cheque — `fecha` es la
 * fecha del DEPÓSITO; ok cuando `fechaPago <= fecha`.
 */
export function validarFechaDeposito(fechaPago: string, fecha: string): Resultado {
  if (fecha < fechaPago) return { ok: false, error: `No se puede depositar antes de la fecha de pago del cheque (${fechaPago}).` };
  return { ok: true };
}

/** Un cheque en una moneda solo puede ir a una caja de valores de la MISMA moneda. */
export function validarMonedaCajaValores(monedaCheque: string, monedaCajaValores: string): Resultado {
  if (monedaCheque !== monedaCajaValores) {
    return { ok: false, error: `Un cheque en ${monedaCheque} solo puede ir a una caja de valores en ${monedaCheque}.` };
  }
  return { ok: true };
}
