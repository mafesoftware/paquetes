# Changelog

## 0.1.0

### Minor Changes

- 10dc950: Primer release del paquete (0.1.0): cuenta corriente de un plan de cuotas.
  
  - **`interesMora`/`aging`**: interés simple por mora (`saldo × tasa/365 ×
    días de atraso`), con días de gracia y tramos de tasa que pueden cambiar
    a mitad del período (el interés total es la suma exacta de cada
    sub-período a la tasa vigente, redondeada una sola vez al final); y la
    banda de aging (`"0-30" | "31-60" | "61-90" | "90+"`) correspondiente a
    unos días de atraso.
  - **`imputarAutomatico`**: reparte un cobro entre las deudas pendientes en
    el orden **interés → ajuste → capital**, de la cuota más vieja a la más
    nueva — nunca imputa capital de una cuota mientras quede interés o
    ajuste pendiente de una cuota más vieja.
  - **`promesaPendienteVencida`/`agruparPorAging`**: gestión de cobranza — si
    la última promesa de pago registrada (por fecha de creación) ya venció
    sin una promesa más nueva, y un resumen por banda de aging (cantidad de
    cuentas + deuda vencida Σ por moneda).
  - **`construirLibro`/`saldoPorMoneda`**: el libro de movimientos de una
    cuenta (débitos/créditos) con su saldo corrido, llevando un acumulador
    **por moneda** — un movimiento en USD nunca mueve el acumulado de ARS.
  - **`resumenDe`/`montoVigente`**: el resumen de una cuenta (saldo, deuda
    vencida, días de mora máximos, próximo vencimiento) a partir de sus
    cuotas no anuladas; una cuota cancelada o refinanciada no aporta a
    ningún total.
  - **`transicionCuota`/`esEstadoCuota`**: la máquina de estados de
    liquidación de una cuota (`pendiente` → `pendiente_indice`/`liquidada`),
    que nunca vuelve a `pendiente` — un cálculo ya hecho no se borra.
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
  framework; toda entrada (fechas, montos, tasas) entra por parámetro.
  Depende de `@mafesoftware/plata-ar` (tipo `Moneda`, `redondearComercial`) y
  `@mafesoftware/fechas-ar` (`diasEntre`, `sumarDiasISO`). Multimoneda: todo
  lo que suma centavos lo hace por moneda separado
  (`Partial<Record<Moneda, bigint>>`).

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
