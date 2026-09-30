# @mafesoftware/cuenta-corriente

Cuenta corriente de un plan de cuotas: interés por mora, imputación
automática de cobros, gestión de cobranza (aging + promesas de pago), libro
de movimientos con saldo corrido, resumen de cuenta y la máquina de estados
de liquidación de una cuota.

Parte de la familia de paquetes de MAFE Software: **núcleo puro** (sin base
de datos, sin framework, sin `process.env`) — toda entrada (fechas, montos,
tasas) entra por parámetro, así que sirve igual a una app con Drizzle,
Prisma o SQL crudo. Depende de `@mafesoftware/plata-ar` (tipo `Moneda`,
`redondearComercial`) y `@mafesoftware/fechas-ar` (`diasEntre`,
`sumarDiasISO`).

```bash
bun add @mafesoftware/cuenta-corriente
```

Multimoneda: todo lo que suma centavos lo hace por moneda separado
(`Partial<Record<Moneda, bigint>>`), nunca mezclando ARS con USD.

## API

### Interés por mora y aging

```ts
import { interesMora, aging, type TramoTasa } from "@mafesoftware/cuenta-corriente";

const tramos: TramoTasa[] = [{ desde: "2026-01-01", tasaAnual: "36" }];

// Interés simple: saldo × tasa/365 × días de atraso, con gracia y tramos.
interesMora(100_000_00n, "2026-01-01", "2026-01-31", tramos, 0); // 2_958_904n ($29.589,04)
interesMora(100_000_00n, "2026-01-01", "2026-01-31", tramos, 5); // gracia de 5 días: 25 días de atraso

aging(45); // "31-60"
```

`interesMora(saldo, desde, hasta, tramos, diasGracia)`: `saldo` en
centavos, `desde`/`hasta` fechas `YYYY-MM-DD`. Los primeros `diasGracia`
días desde `desde` no generan interés. Si la tasa cambió durante el
período (`tramos` con más de un elemento), el interés es la suma exacta de
cada sub-período a la tasa vigente en ese momento, redondeada una sola vez
al final (medio hacia arriba). Devuelve `0n` si `saldo <= 0` o no hay días
de atraso.

`aging(diasAtraso)`: la banda de aging (`"0-30" | "31-60" | "61-90" |
"90+"`) correspondiente a unos días de atraso.

### Imputación automática de un cobro

```ts
import { imputarAutomatico, type Deuda } from "@mafesoftware/cuenta-corriente";

const deudas: Deuda[] = [
  { cuotaId: "c1", vencimiento: "2026-01-10", interes: 100n, ajuste: 200n, capital: 1_000n, moneda: "ARS" },
  { cuotaId: "c2", vencimiento: "2026-02-10", interes: 50n, ajuste: 150n, capital: 2_000n, moneda: "ARS" },
];

const { imputaciones, sobrante } = imputarAutomatico(deudas, 500n);
// imputaciones: [interés de c1, interés de c2, ajuste de c1, ajuste de c2]
// sobrante: 0n
```

`imputarAutomatico(deudas, disponible)`: reparte `disponible` (centavos de
un cobro) entre las `deudas`, en el orden **interés → ajuste → capital** y,
dentro de cada concepto, de la cuota más vieja (`vencimiento` más chico) a
la más nueva — nunca imputa capital de una cuota mientras quede interés o
ajuste pendiente de una cuota más vieja. Invariante: la suma de
`imputaciones[].centavos` más `sobrante` siempre da `disponible`.

### Gestión de cobranza

```ts
import { promesaPendienteVencida, agruparPorAging } from "@mafesoftware/cuenta-corriente";

promesaPendienteVencida(
  [{ tipo: "promesa_pago", fechaPromesa: "2026-03-01", creadoEn: "2026-02-20" }],
  "2026-03-15"
); // true: la promesa venció sin que se registre otra más nueva

agruparPorAging([
  { aging: "0-30", deudaVencida: { ARS: 100_00n } },
  { aging: "0-30", deudaVencida: { ARS: 200_00n } },
]);
// { "0-30": { cantidad: 2, deudaVencida: { ARS: 300_00n } }, "31-60": { cantidad: 0, deudaVencida: {} }, ... }
```

`promesaPendienteVencida(gestiones, hoy)`: `true` si la promesa de pago más
reciente (por `creadoEn`) ya venció (`fechaPromesa < hoy`) sin que se haya
registrado una promesa más nueva. Pensada para invocarse solo sobre cuentas
que ya están en mora.

`agruparPorAging(filas)`: cantidad de cuentas + deuda vencida Σ por moneda,
banda de aging por banda de aging (siempre las 4 bandas, en cero si no hay
filas).

### Libro de movimientos

```ts
import { construirLibro, saldoPorMoneda, type MovimientoLibro } from "@mafesoftware/cuenta-corriente";

const movimientos: MovimientoLibro[] = [
  { fecha: "2026-02-15", tipo: "cuota", concepto: "Cuota 1", moneda: "ARS", debitoCentavos: 100_000n, creditoCentavos: 0n, referenciaId: "c1" },
  { fecha: "2026-02-20", tipo: "cobro", concepto: "Cobro", moneda: "ARS", debitoCentavos: 0n, creditoCentavos: 60_000n, referenciaId: "cob1" },
];

construirLibro(movimientos); // cada fila con su saldoCorridoCentavos
saldoPorMoneda(movimientos); // { ARS: 40_000n }
```

`construirLibro(movimientos)`: ordena por fecha (a igual fecha, débitos
antes que créditos) y calcula el saldo corrido llevando un acumulador **por
moneda** — un movimiento en USD nunca mueve el acumulado de ARS.

`saldoPorMoneda(movimientos)`: el saldo final por moneda (Σ débitos −
créditos), sin ordenar ni calcular el saldo corrido fila por fila.

### Resumen de cuenta

```ts
import { resumenDe, montoVigente, type CuotaParaResumen } from "@mafesoftware/cuenta-corriente";

const cuotas: CuotaParaResumen[] = [
  { moneda: "ARS", vencimiento: "2026-02-15", montoBaseCentavos: 100_000n, montoAjustadoCentavos: 108_000n, tipo: "cuota", cobradaEn: null },
];

resumenDe(cuotas, "2026-03-01");
// { cobradoAFecha: {}, saldoActual: { ARS: 108_000n }, deudaVencida: { ARS: 108_000n }, diasMoraMax: 14, proximoVencimiento: null }
```

`resumenDe(cuotas, hoy)`: saldo actual, deuda vencida y días de mora máximos
(todo por moneda), y el próximo vencimiento, a partir de las cuotas NO
ANULADAS de una cuenta. Una cuota `cancelada` o `refinanciada` no aporta a
ningún total.

`montoVigente(cuota)`: el monto vigente de una cuota — el ajustado si ya se
liquidó, si no el base; un documento de ajuste (nota de débito/crédito)
siempre usa su propio monto base.

### Estado de liquidación de una cuota

```ts
import { transicionCuota, esEstadoCuota } from "@mafesoftware/cuenta-corriente";

transicionCuota("pendiente", "liquidar"); // "liquidada"
transicionCuota("pendiente", "faltaIndice"); // "pendiente_indice"
transicionCuota("liquidada", "faltaIndice"); // instancia de Error: transición inválida
```

`transicionCuota(estado, evento)`: el estado destino (`"pendiente" |
"pendiente_indice" | "liquidada"`) de aplicar un evento
(`"liquidar" | "faltaIndice" | "reliquidar"`) sobre un estado, o una
instancia de `Error` si la transición no es válida. Ninguna transición
vuelve a `pendiente` — un cálculo ya hecho no se borra.

`esEstadoCuota(x)`: type guard para `EstadoCuota`.
