/**
 * Cartera de cheques (propios/terceros, físico/echeq): estados y
 * transiciones, proyección de saldo bancario y validaciones de depósito —
 * para cualquier producto de MAFE Software que maneje cheques en su
 * tesorería. Extraído de Obriq (`src/lib/dominio/cheques/`).
 *
 * Núcleo puro: sin DB ni framework, sin `process.env`. Montos en centavos
 * (`bigint`), nunca `number`; fechas como `"YYYY-MM-DD"`.
 *
 * - `estados.ts`: `transicionCheque` — la única fuente de verdad de qué
 *   transición es válida entre dos vocabularios DISJUNTOS
 *   (`EstadoTercero`/`EstadoPropio`, según `tipo`).
 * - `calendario.ts`: `proyeccionSaldoBancario` — el saldo bancario
 *   proyectado acumulando los cheques pendientes de cobrarse/debitarse
 *   hasta una fecha.
 * - `validaciones.ts`: `validarFechaPago`/`validarFechaDeposito`/
 *   `validarMonedaCajaValores` — las reglas que corren antes de persistir
 *   un cheque o un depósito. Usa `diasEntre` de `@mafesoftware/fechas-ar`.
 *
 * Lo que queda fuera (ver README, "Lo que este paquete NO hace"): la
 * persistencia (chequeras, depósitos, endoso, rechazo, descuento contra un
 * banco real) es lógica atada al schema de cada app.
 */
export { transicionCheque, type EstadoTercero, type EstadoPropio, type EventoCheque } from "./estados.js";
export { proyeccionSaldoBancario, type EventoCalendario, type PuntoSaldo } from "./calendario.js";
export { validarFechaPago, validarFechaDeposito, validarMonedaCajaValores, type Resultado } from "./validaciones.js";
