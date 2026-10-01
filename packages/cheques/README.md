# @mafesoftware/cheques

Cartera de cheques (propios/terceros, físico/echeq): estados y
transiciones, proyección de saldo bancario y validaciones de depósito —
para cualquier producto de MAFE Software que maneje cheques en su
tesorería. Extraído de Obriq (`src/lib/dominio/cheques/`).

Núcleo puro: sin DB ni framework, sin `process.env`. Montos en centavos
(`bigint`), nunca `number`; fechas como `"YYYY-MM-DD"`.

```bash
bun add @mafesoftware/cheques
```

## Conceptos

- **Cheque de tercero**: el que recibe tu cuenta corriente, de un cliente
  o de un endoso. Vive en `EstadoTercero`: `"en_cartera"` (estado inicial)
  → `"depositado"` → `"acreditado"` | `"rechazado"`; o desde
  `"en_cartera"` → `"endosado"` (y de ahí solo vuelve, por rechazo del
  endosatario, a `"rechazado"`) | `"descontado"` | `"custodia"` (y de
  vuelta a `"en_cartera"`).
- **Cheque propio**: el que tu cuenta emite contra una chequera. Vive en
  `EstadoPropio`: `"en_blanco"` (número cargado, todavía sin entregar) →
  `"emitido"` → `"debitado"`; `"anular"` es válida desde `"en_blanco"` o
  `"emitido"`, nunca desde `"debitado"` (un cheque que ya salió de la
  cuenta no se anula, se rebate por otra vía).
- Los dos vocabularios son DISJUNTOS a propósito: no hay un estado
  compartido entre un cheque propio y uno de tercero, y `transicionCheque`
  es la única fuente de verdad de qué transición es válida en cada uno —
  la capa de datos de quien consume este paquete nunca decide esto a mano.

## API

### `transicionCheque(tipo, estado, evento): Estado | Error`

Sobrecargada por `tipo` (`"tercero"` → recibe/devuelve `EstadoTercero`,
`"propio"` → `EstadoPropio`). Devuelve el estado siguiente, o un `Error`
(**nunca tira**) si la transición no es válida — quien llama decide si ese
`Error` se propaga o se traduce a `{ ok: false, error }`.

```ts
import { transicionCheque } from '@mafesoftware/cheques';

transicionCheque('tercero', 'en_cartera', 'depositar'); // "depositado"
transicionCheque('tercero', 'acreditado', 'rechazar'); // instanceof Error
transicionCheque('propio', 'debitado', 'anular'); // instanceof Error
```

### `proyeccionSaldoBancario(saldoHoy, eventos, hasta): PuntoSaldo[]`

El saldo de una cuenta bancaria proyectado hacia adelante, acumulando los
cheques pendientes de cobrarse (terceros en cartera) o debitarse (propios
emitidos) hasta la fecha `hasta` (inclusive). Un punto por cada fecha
DISTINTA con algún evento, en orden cronológico; eventos posteriores a
`hasta` no entran.

```ts
import { proyeccionSaldoBancario, type EventoCalendario } from '@mafesoftware/cheques';

const eventos: EventoCalendario[] = [
  { fecha: '2026-10-15', importe: 200_000_00n, tipo: 'tercero_a_cobrar' }, // +$2.000.000
  { fecha: '2026-11-30', importe: 50_000_00n, tipo: 'propio_a_debitar' }, // -$500.000
];

proyeccionSaldoBancario(500_000_00n, eventos, '2026-12-31');
// [
//   { fecha: '2026-10-15', saldo: 700_000_00n },
//   { fecha: '2026-11-30', saldo: 650_000_00n },
// ]
```

### Validaciones (`Resultado = { ok: true } | { ok: false; error: string }`)

- **`validarFechaPago(fechaEmision, fechaPago, diasLimite = 360): Resultado`**
  — una fecha de pago demasiado lejos de la emisión es un plazo
  irrazonable para un cheque diferido. `diasLimite` es ajustable por si
  otra plaza usa otro tope.
- **`validarFechaDeposito(fechaPago, fecha): Resultado`** — no se puede
  depositar antes de la fecha de pago del cheque (`fecha` es la fecha del
  depósito); ok cuando `fechaPago <= fecha`.
- **`validarMonedaCajaValores(monedaCheque, monedaCajaValores): Resultado`**
  — un cheque en una moneda solo puede ir a una caja de valores de la
  MISMA moneda.

```ts
import { validarFechaPago, validarFechaDeposito, validarMonedaCajaValores } from '@mafesoftware/cheques';

validarFechaPago('2026-09-20', '2026-10-15'); // { ok: true }
validarFechaDeposito('2026-10-15', '2026-10-01'); // { ok: false, error: '...' }
validarMonedaCajaValores('USD', 'ARS'); // { ok: false, error: '...' }
```

`validarFechaPago`/`validarFechaDeposito` cuentan días de calendario con
`diasEntre` de `@mafesoftware/fechas-ar` — un `fechaEmision`/`fechaPago`
mal formado (o un calendario imposible, ej. `"2026-02-30"`) tira
`ErrorFecha` en vez de devolver un conteo silenciosamente incorrecto.

## Lo que este paquete NO hace

No persiste nada: ni cartera, ni chequeras, ni depósitos. Cargar una
chequera, emitir un número, endosar o descontar un cheque contra un
banco real, y decidir en qué transacción hacerlo, es responsabilidad de
cada app, sobre su propio schema — no hay una operación atómica genérica
para extraer acá (a diferencia de, por ejemplo,
`@mafesoftware/numeradores` u `@mafesoftware/outbox`, que sí traen un
subpath `/drizzle` con tabla y operación). Ver `src/lib/cheques/` y
`src/db/schema/cheques.ts` en Obriq para un ejemplo completo de app que
compone este motor con su propia persistencia.
