# @mafesoftware/devengados

Obligaciones que **se devengan por mes y se cancelan con pagos**: sueldos,
alquileres, acuerdos de sponsor, cuotas sociales. Todas tienen la misma forma:

- un contrato que arranca un día, puede darse de baja otro, y vence un día fijo
  de cada mes;
- un monto mensual que **cambia con el tiempo** (el alquiler sube, el sueldo se
  actualiza) — cada cambio rige desde un mes;
- pagos que se cargan aparte y se comparan contra lo devengado.

La pregunta de siempre es "¿cuánto debería haberse pagado hasta hoy y cómo
estamos?". La respuesta no se guarda (se desactualiza sola al pasar el día de
vencimiento): se **calcula** a partir del contrato, las vigencias y el día de
hoy. Este paquete es ese cálculo, sin base de datos ni framework:

- **Núcleo puro**: no lee el reloj — el "hoy" entra siempre por parámetro.
- **Plata en centavos `bigint`**: sin `number`, sin redondeos.
- **No inventa ceros**: un mes sin vigencia que lo cubra no devenga, y una
  celda sin datos no aparece en la matriz (el consumidor decide si muestra `0`
  o `—`).
- **Corte de migración**: si venías de un Excel, cargás el devengado previo
  hasta una fecha y el paquete solo calcula desde el mes siguiente.

Fechas como `"YYYY-MM-DD"` y períodos como `"YYYY-MM"` (vía
[`@mafesoftware/fechas-ar`](../fechas-ar)). Toda entrada inválida tira un
`Error` que dice qué campo falla.

```sh
bun add @mafesoftware/devengados
```

## API

### `estadoSaldo(devengado: bigint, pagado: bigint): EstadoSaldo`

Clasifica una obligación según lo devengado y lo pagado. Total: todo par cae en
exactamente uno de estos estados:

| Estado | Cuándo |
|---|---|
| `sin_deuda` | no se devengó nada y tampoco se pagó (`devengado <= 0` y `pagado <= 0`) |
| `pendiente` | hay devengado y no se pagó nada |
| `parcial` | se pagó una parte (`0 < pagado < devengado`) |
| `saldada` | `pagado == devengado` |
| `pagado_de_mas` | se pagó más de lo devengado (anticipo o error de carga — conviene mirarlo) |

```ts
import { estadoSaldo } from "@mafesoftware/devengados";

estadoSaldo(150_000_00n, 0n);          // "pendiente"
estadoSaldo(150_000_00n, 100_000_00n); // "parcial"
estadoSaldo(150_000_00n, 150_000_00n); // "saldada"
estadoSaldo(0n, 20_000_00n);           // "pagado_de_mas"
```

### `periodoDeFecha(fecha: string): Periodo`

El período `"YYYY-MM"` de una fecha `"YYYY-MM-DD"`. Tira si la fecha no existe.

```ts
import { periodoDeFecha } from "@mafesoftware/devengados";

periodoDeFecha("2026-06-15"); // "2026-06"
periodoDeFecha("2026-02-30"); // Error: periodoDeFecha: fecha inválida "2026-02-30" …
```

### `primerDia(periodo: Periodo): string`

El primer día de un período: así se suele guardar un período en una columna
`date`.

```ts
import { primerDia } from "@mafesoftware/devengados";

primerDia("2026-06"); // "2026-06-01"
primerDia("2026-13"); // Error: primerDia: período inválido "2026-13" …
```

### `periodosEntre(desde: Periodo, hasta: Periodo): Periodo[]`

Los períodos de `desde` a `hasta`, ambos incluidos, en orden (cruza el año).
Vacío si `desde > hasta`. Tira si alguno no es un período válido. Sirve para
armar las columnas de una planilla anual.

```ts
import { periodosEntre } from "@mafesoftware/devengados";

periodosEntre("2026-11", "2027-02"); // ["2026-11", "2026-12", "2027-01", "2027-02"]
periodosEntre("2026-05", "2026-04"); // []
```

### `montoVigente(vigencias: readonly Vigencia[], periodo: Periodo): bigint | null`

El monto que rige en `periodo`: el de la vigencia más reciente con
`desde <= periodo`. `null` si ninguna rige todavía (no se inventa un `0`). El
orden de la lista no importa; con dos vigencias del mismo `desde` gana la
primera.

```ts
import { montoVigente, type Vigencia } from "@mafesoftware/devengados";

const alquiler: Vigencia[] = [
  { desde: "2026-02", monto: 400_000_00n },
  { desde: "2026-06", monto: 520_000_00n }, // actualización por índice
];

montoVigente(alquiler, "2026-05"); // 400_000_00n
montoVigente(alquiler, "2026-09"); // 520_000_00n
montoVigente(alquiler, "2026-01"); // null
```

### `cuotasVencidas(contrato: ContratoMensual, hasta: string): CuotaDevengada[]`

Las cuotas **ya vencidas** al día `hasta`, una por mes, con el monto vigente de
cada mes:

- devenga desde el mes de `inicio` (o desde el mes siguiente al `corte`, si es
  posterior) hasta el mes de `baja` inclusive (o el de `hasta`);
- un mes cuenta recién cuando llegó su día de vencimiento
  (`vence <= hasta`); `diaVencimiento` se trunca y se acota a 1..28, así
  febrero siempre lo tiene;
- un mes sin vigencia que lo cubra no genera cuota.

```ts
import { cuotasVencidas, type ContratoMensual } from "@mafesoftware/devengados";

const sueldo: ContratoMensual = {
  inicio: "2026-02-01",
  baja: null,
  diaVencimiento: 5,
  vigencias: [
    { desde: "2026-02", monto: 900_000_00n },
    { desde: "2026-04", monto: 1_000_000_00n },
  ],
};

cuotasVencidas(sueldo, "2026-04-04");
// [
//   { periodo: "2026-02", monto: 900_000_00n, vence: "2026-02-05" },
//   { periodo: "2026-03", monto: 900_000_00n, vence: "2026-03-05" },
// ]  ← abril todavía no venció
```

### `devengadoAl(contrato: ContratoMensual, hasta: string): bigint`

El total devengado y vencido al día `hasta`: `devengadoPrevio` (lo que ya
venía contado hasta el corte) más la suma de `cuotasVencidas`. Comparalo con lo
pagado y pasáselo a `estadoSaldo`.

```ts
import { devengadoAl, estadoSaldo, type ContratoMensual } from "@mafesoftware/devengados";

// Sponsor que venía de una planilla: hasta julio ya se habían devengado $600.000.
const sponsor: ContratoMensual = {
  inicio: "2025-01-01",
  baja: null,
  diaVencimiento: 10,
  vigencias: [{ desde: "2025-01", monto: 100_000_00n }],
  corte: "2026-07-31",
  devengadoPrevio: 600_000_00n,
};

const devengado = devengadoAl(sponsor, "2026-09-30"); // 600_000_00n + agosto + septiembre = 800_000_00n
estadoSaldo(devengado, 750_000_00n);                  // "parcial"
```

### `matrizPorPeriodo(filas: Iterable<{ fila: string; periodo: Periodo; importe: bigint }>): Matriz`

Suma importes por (fila, período) — la tabla dinámica que en el Excel se arma
con un `SUMIFS` por celda. Devuelve los totales por celda, por fila, por
período y el general (siempre `total == Σ porFila == Σ porPeriodo`). Las
combinaciones que no aparecen no se inventan. `fila` y `periodo` se usan como
claves tal cual; tira si un `importe` no es `bigint`.

```ts
import { matrizPorPeriodo } from "@mafesoftware/devengados";

const m = matrizPorPeriodo([
  { fila: "luz", periodo: "2026-01", importe: 100_00n },
  { fila: "luz", periodo: "2026-01", importe: 50_00n },
  { fila: "gas", periodo: "2026-02", importe: 30_00n },
]);

m.celdas.get("luz")?.get("2026-01"); // 150_00n
m.celdas.get("gas")?.get("2026-01"); // undefined (no hubo gas en enero)
m.porFila.get("gas");                // 30_00n
m.porPeriodo.get("2026-01");         // 150_00n
m.total;                             // 180_00n
```

### Tipos

```ts
type Periodo = string; // "YYYY-MM" — string a secas para pasar lo que viene de la base sin casts
type EstadoSaldo = "sin_deuda" | "pendiente" | "parcial" | "saldada" | "pagado_de_mas";
type Vigencia = { desde: Periodo; monto: bigint };
type ContratoMensual = {
  inicio: string;           // "YYYY-MM-DD": devenga desde este mes
  baja: string | null;      // "YYYY-MM-DD": devenga hasta este mes inclusive
  diaVencimiento: number;   // 1..28 (se acota)
  vigencias: readonly Vigencia[];
  corte?: string | null;    // "YYYY-MM-DD": meses hasta este inclusive ya están en devengadoPrevio
  devengadoPrevio?: bigint;
};
type CuotaDevengada = { periodo: Periodo; monto: bigint; vence: string };
type Matriz = {
  celdas: Map<string, Map<Periodo, bigint>>;
  porFila: Map<string, bigint>;
  porPeriodo: Map<Periodo, bigint>;
  total: bigint;
};
```

```ts
import type { ContratoMensual, CuotaDevengada, EstadoSaldo, Matriz, Periodo, Vigencia } from "@mafesoftware/devengados";
```
