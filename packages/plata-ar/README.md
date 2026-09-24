# @mafesoftware/plata-ar

Plata en centavos, parseo y formato argentino. Sin dependencias.

## 0.2: `bigint`, factores de 8 decimales, reparto por mayor resto y multimoneda

La API 0.1 (`Centavos = number`) se mantiene íntegra —gestionflow la sigue
usando— pero queda `@deprecated`: un `number` no alcanza para factores de
ajuste con 8 decimales exactos ni para montos con moneda propia (USD, EUR).
La 0.2 es **aditiva**: agrega `Importe` (`{ centavos: bigint; moneda: Moneda
}`), `redondearComercial`, `aplicarFactor`, `repartirPorMayorResto`,
`convertir`, `sumar` y `parsearImporte`, todo en `bigint` — nunca `float` —
y documentada en la sección [API 0.2](#api-02) más abajo.

**`formatearPlata` está sobrecargada**: `formatearPlata(centavos: number,
opciones?)` (0.1, deprecated) y `formatearPlata(i: Importe | bigint,
opciones?)` (0.2) conviven bajo el mismo nombre — TypeScript elige la
firma según el tipo del primer argumento.

**`parsearPlata` (0.1) no cambió de nombre** porque su forma de resultado
(`Centavos | null`) es incompatible con la nueva (`{ ok, centavos } | { ok,
error }`): forzar la misma firma habría roto a quien ya usa `parsearPlata`.
La función nueva se llama **`parsearImporte`**.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/plata-ar
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## Probar

```bash
bun test
```

## API

### Conversión

```ts
import { aCentavos, aPesos, MAXIMO_CENTAVOS } from "@mafesoftware/plata-ar";

aCentavos(19.99);  // 1999
aCentavos(NaN);    // null (nunca 0: un cero silencioso es un pago inventado)
aPesos(1999);       // 19.99
MAXIMO_CENTAVOS;    // Number.MAX_SAFE_INTEGER
```

### Formato

```ts
import { formatearPlata, plataARS } from "@mafesoftware/plata-ar";

plataARS(4_400_000);                              // "$ 44.000" (sin decimales: es redondo)
formatearPlata(4_400_000, { decimalesSiempre: true }); // "$ 44.000,00"
```

### Parseo

```ts
import { parsearPlata, parsearNumeroAR, parsearPorcentaje, parsearCantidad, pesosParaPlanilla } from "@mafesoftware/plata-ar";

parsearPlata("44.000");   // 4_400_000  (cuarenta y cuatro mil pesos, en CENTAVOS)
parsearPlata("1234.56");  //   123_456  (una celda copiada de una planilla)
parsearNumeroAR("1.234,56"); // 1234.56 (el número, sin convertir a centavos)
parsearPorcentaje("10");  // 10 (NO multiplica por cien, a diferencia de parsearPlata)
parsearCantidad("3");     // 3
pesosParaPlanilla(123_456); // "1234,56" (para que Excel lo sume como número)
```

**Lo que no es plata no pasa por `parsearPlata`.** Un porcentaje va por
`parsearPorcentaje` y una cantidad por `parsearCantidad`: pasarlos por el parser
de plata los multiplica por cien, y un "10" tipeado llega como 1000.

### Reparto y operaciones

```ts
import { repartirCentavos, aplicarPorcentaje, sumarCentavos } from "@mafesoftware/plata-ar";

// Reparte sin perder ni inventar un centavo: la suma da SIEMPRE el total.
repartirCentavos(100, [1, 1, 1]); // [34, 33, 33]
aplicarPorcentaje(123_400, 21); // 25_914 (el 21% de $1.234, redondeado a centavo)
sumarCentavos([100, 200, 300]); // 600
```

## API 0.2

Todo en `bigint`. Nada de esto lee `process.env` ni depende de un framework.

### Errores (`errores.ts`)

```ts
import { ErrorPlata, type CodigoErrorPlata } from "@mafesoftware/plata-ar";

// Las funciones de abajo tiran ErrorPlata cuando reciben datos que son un bug
// de quien llama (una lista de pesos vacía, un peso negativo, monedas
// mezcladas) — no cuando el dato lo tipeó una persona: eso lo maneja
// `parsearImporte`, que nunca tira.
try {
  // ...
} catch (e) {
  if (e instanceof ErrorPlata) {
    e.codigo; // "pesos_vacio" | "peso_invalido" | "peso_negativo" | "pesos_todo_cero"
              // | "factor_invalido" | "division_por_cero" | "moneda_mezclada"
              // | "sumar_sin_importes"
  }
}
```

### Redondeo (`bigint.ts`)

```ts
import { redondearComercial } from "@mafesoftware/plata-ar";

// Medio hacia arriba, alejándose de cero (spec 02 §1): al final de cada
// cálculo, nunca en un paso intermedio.
redondearComercial(5n, 2n);  // 3n   (2,5 -> 3)
redondearComercial(-5n, 2n); // -3n  (-2,5 -> -3, "hacia arriba" en valor absoluto)
```

### Factores de 8 decimales (`factor.ts`)

```ts
import { aplicarFactor } from "@mafesoftware/plata-ar";

// factor = índice_referencia / índice_base, como string decimal de hasta 8
// decimales (spec 02 §3.2). Todo en bigint: nunca pasa por un float.
aplicarFactor(10_000_000n, "1.06203057"); // 10_620_306n
// 10_000_000 x 1,06203057 = 10_620_305,7 -> redondeo comercial -> 10_620_306
```

### Reparto por mayor resto (`reparto.ts`)

```ts
import { repartirPorMayorResto } from "@mafesoftware/plata-ar";

// Los pesos son proporción, no monto: aceptan bigint, number o un string
// decimal ("33.33"), sin límite de decimales. La suma de las partes da
// SIEMPRE el total. Empate en el resto -> gana el índice más bajo.
repartirPorMayorResto(100n, [1, 1, 1]);                    // [34n, 33n, 33n]
repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]); // [333n, 333n, 334n]

// Tira ErrorPlata si la lista está vacía, si algún peso es negativo o si
// todos los pesos son cero: son errores de quien llama, no un dato de
// formulario.
repartirPorMayorResto(100n, []);      // tira ErrorPlata (pesos_vacio)
repartirPorMayorResto(100n, [0, 0]);  // tira ErrorPlata (pesos_todo_cero)
```

### Multimoneda (`moneda.ts`)

```ts
import { type Moneda, type Importe, convertir, sumar } from "@mafesoftware/plata-ar";

// Moneda = "ARS" | "USD" | "EUR"
// Importe = { centavos: bigint; moneda: Moneda }

convertir({ centavos: 100_000n, moneda: "USD" }, "ARS", "1050.50");
// { centavos: 105_050_000n, moneda: "ARS" }  (USD 1.000 a $1.050,50)

sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 250n, moneda: "ARS" });
// { centavos: 350n, moneda: "ARS" }

sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 100n, moneda: "USD" });
// tira ErrorPlata (moneda_mezclada): convertir antes de sumar
```

### Parseo (`parseo.ts`)

```ts
import { parsearImporte } from "@mafesoftware/plata-ar";

// Nunca tira. Mismas reglas de formato argentino que parsearPlata (0.1):
// con coma, la coma es el decimal y los puntos son miles (validados como
// agrupamiento real: "1.2.3,4" es inválido, no se lee como "123,4").
parsearImporte("44.000");    // { ok: true, centavos: 4_400_000n }
parsearImporte("44.000,50"); // { ok: true, centavos: 4_400_050n }
parsearImporte("1,234");     // { ok: true, centavos: 123n }        (1,234 pesos)
parsearImporte("1.2.3,4");   // { ok: false, error: "..." }         (miles mal agrupados)

parsearImporte("-500", { permitirNegativo: false });
// { ok: false, error: "..." }
```

### `formatearPlata` con `Importe`/`bigint`

```ts
import { formatearPlata } from "@mafesoftware/plata-ar";

// A diferencia de la firma 0.1 (Centavos number), esta muestra SIEMPRE los
// dos decimales por defecto: en un panel multimoneda "US$ 50" sin
// decimales es ambiguo con un monto en ARS.
formatearPlata({ centavos: -5_000n, moneda: "USD" }); // "-US$ 50,00"
formatearPlata(4_400_000n);                            // "$ 44.000,00" (bigint a secas: ARS por defecto)
formatearPlata(4_400_000n, { decimalesSiempre: false }); // "$ 44.000"
```
