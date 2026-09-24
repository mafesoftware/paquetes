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

## Requisitos

`formatearPlata(Importe | bigint, ...)` necesita que el motor JS soporte
**"Intl.NumberFormat v3"** (`Intl.NumberFormat#format` aceptando un string
decimal con precisión matemática exacta, `ToIntlMathematicalValue`) — parte
de ES2023: **Node ≥ 20, Safari ≥ 15.4, Firefox ≥ 116** (V8/Chrome lo trae
hace más tiempo). En un motor más viejo sin esto, `Intl.NumberFormat`
convierte el string a través de `number` antes de formatear, así que un
importe por encima de `2^53` (`Number.MAX_SAFE_INTEGER`) pierde precisión
en el formateo — aunque el cálculo en `bigint` de más arriba (redondeo,
factores, reparto) siga siendo exacto en cualquier motor. `engines.node` de
este paquete ya pide `>=20`.

`parsearImporte` acepta hasta `LONGITUD_MAXIMA_IMPORTE` (64) caracteres;
un texto más largo se rechaza antes de analizarlo (ver `parseo.ts`).

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
              // | "sumar_sin_importes" | "tc_no_positivo" | "tc_identidad"
              // | "indice_invalido"
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
import { aplicarFactor, factorEntre } from "@mafesoftware/plata-ar";

// aplicarFactor toma un FACTOR ya calculado (la razón índice_referencia /
// índice_base), como string decimal de HASTA 8 decimales (spec 02 §3.2).
// Todo en bigint: nunca pasa por un float.
aplicarFactor(10_000_000n, "1.06203057"); // 10_620_306n
// 10_000_000 x 1,06203057 = 10_620_305,7 -> redondeo comercial -> 10_620_306

// factorEntre calcula ESE factor a partir de dos valores de ÍNDICE (no
// factores): a diferencia de aplicarFactor, valorRef/valorBase aceptan
// CUALQUIER cantidad de decimales (un índice publicado puede traer más de
// 8) -- el redondeo a 8 decimales pasa una sola vez, al final, sobre el
// resultado. Los índices son positivos: tira ErrorPlata (indice_invalido)
// si valorRef o valorBase no son mayores a 0, o no son un decimal válido.
factorEntre("3662.2", "3448.3"); // "1.06203057"
aplicarFactor(10_000_000n, factorEntre("3662.2", "3448.3")); // 10_620_306n
factorEntre("3662.123456789", "3448.3"); // "1.06200837" (más de 8 decimales de entrada, sin problema)
factorEntre("-100", "50"); // tira ErrorPlata (indice_invalido): los índices no son negativos
```

`factorAEscala`/`ESCALA_FACTOR` (el detalle interno de escala ×10⁸ que usan
`aplicarFactor`/`convertir`) son internos y **no** forman parte de la API
pública — viven en `src/escala-factor.ts`, sin re-exportar desde
`index.ts`.

### Reparto por mayor resto (`reparto.ts`)

```ts
import { repartirPorMayorResto, type PesoReparto } from "@mafesoftware/plata-ar";

// Los pesos son proporción, no monto: aceptan bigint, number (incluida
// notación exponencial, "1e-7") o un string decimal ("33.33"), sin límite
// de decimales. PesoReparto = bigint | number | string.
//
// La suma de las partes da SIEMPRE el total. Empate en el resto -> gana el
// PESO más grande (spec 02 §1: "empate: la parte de mayor peso"); si los
// pesos también empatan, gana el índice más bajo.
repartirPorMayorResto(100n, [1, 1, 1]);                    // [34n, 33n, 33n]
repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]); // [333n, 333n, 334n]
repartirPorMayorResto(2n, [1, 3]);                         // [0n, 2n]  (empate: gana el peso 3)

// Tira ErrorPlata si la lista está vacía, si algún peso es negativo o si
// todos los pesos son cero (un "-0" cuenta como cero, no como negativo):
// son errores de quien llama, no un dato de formulario.
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

// tc tiene que ser > 0 (si no, tira ErrorPlata tc_no_positivo), y convertir
// a la MISMA moneda de origen exige tc == "1" (si no, tira tc_identidad):
// un TC ≠ 1 en una conversión ARS→ARS es casi siempre el TC de otro par
// pegado en el lugar equivocado.
convertir({ centavos: 100n, moneda: "ARS" }, "ARS", "1");  // sin cambios
convertir({ centavos: 100n, moneda: "ARS" }, "ARS", "2");  // tira ErrorPlata (tc_identidad)

// Contrato de ida y vuelta: convertir(convertir(i, B, tc), A, tcInv) cae
// dentro de ±1 centavo del original SOLO si tc y tcInv son recíprocos
// exactos (tc × tcInv === 1, p.ej. "2"/"0.5") Y se arranca en la moneda
// "fuerte" (tcInv <= 1). Con dos cotizaciones cargadas por separado (el
// caso normal) NO hay garantía de round trip: son dos conversiones
// independientes. Quien necesite el importe original tiene que guardarlo,
// no reconstruirlo convirtiendo para atrás.

sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 250n, moneda: "ARS" });
// { centavos: 350n, moneda: "ARS" }

sumar({ centavos: 100n, moneda: "ARS" }, { centavos: 100n, moneda: "USD" });
// tira ErrorPlata (moneda_mezclada): convertir antes de sumar
```

### Parseo (`parseo.ts`)

```ts
import {
  parsearImporte,
  LONGITUD_MAXIMA_IMPORTE,
  type OpcionesParseoImporte,
  type ResultadoParseoImporte,
} from "@mafesoftware/plata-ar";

// Nunca tira: ResultadoParseoImporte = { ok: true; centavos: bigint }
//                                    | { ok: false; error: string }.
//
// Formato argentino ESTRICTO por defecto: con coma, la coma es el decimal y
// los puntos son miles (validados como agrupamiento real: "1.2.3,4" es
// inválido, no se lee como "123,4"). SIN coma, un punto es SIEMPRE
// separador de miles y tiene que agrupar de a 3 dígitos exactos: "1.50" y
// "1234.56" son inválidos acá (spec 02 §1: un punto nunca es decimal salvo
// que el usuario tenga locale en inglés).
parsearImporte("44.000");    // { ok: true, centavos: 4_400_000n }
parsearImporte("44.000,50"); // { ok: true, centavos: 4_400_050n }
parsearImporte("1,234");     // { ok: true, centavos: 123n }        (1,234 pesos)
parsearImporte("1.2.3,4");   // { ok: false, error: "..." }         (miles mal agrupados)
parsearImporte("1234.56");   // { ok: false, error: "..." }         (un punto SIEMPRE es miles acá)

// OpcionesParseoImporte = { permitirNegativo?: boolean; decimalConPunto?: boolean }
parsearImporte("-500", { permitirNegativo: false });    // { ok: false, error: "..." }
parsearImporte("44000.5", { decimalConPunto: true });   // { ok: true, centavos: 4_400_050n } (convención en inglés)

// Solo tolera dígitos, un "-" inicial, ".", ",", espacios y COMO MUCHO UN
// símbolo/código de moneda ($, US$, U$S, ARS, USD, EUR, €) en total -- y
// ese signo/token SOLO como prefijo o sufijo alrededor del número, nunca
// metidos adentro de los dígitos ni repetidos: cualquier otro caracter, un
// token/espacio en el medio, o un segundo token, es inválido, no se
// descarta en silencio.
parsearImporte("1e3");      // { ok: false, error: "..." }  (no es "1300")
parsearImporte("(500)");    // { ok: false, error: "..." }  (no es "500")
parsearImporte("1$2");      // { ok: false, error: "..." }  (token en el medio, no es "12")
parsearImporte("12 ARS 34"); // { ok: false, error: "..." } (idem)
parsearImporte("$$5");      // { ok: false, error: "..." }  (dos tokens)
parsearImporte("ARS5USD");  // { ok: false, error: "..." }  (idem: prefijo + sufijo)
parsearImporte("$ -1.000"); // { ok: true, centavos: -100_000n }  (token y signo como prefijo: sí vale)
parsearImporte("1.000,50 ARS"); // { ok: true, centavos: 100_050n } (token como sufijo: sí vale)

// El escaneo es lineal (una sola pasada, sin backtracking sobre corridas
// de espacios), pero igual hay un tope de longitud: un texto de más de
// LONGITUD_MAXIMA_IMPORTE (64) caracteres se rechaza ANTES de analizarlo.
// Ningún importe real necesita tanto.
parsearImporte(" ".repeat(1000) + "5"); // { ok: false, error: "..." }
```

**`decimalConPunto` es responsabilidad de quien llama**: `parsearImporte`
no adivina el locale de quien tipeó — si se activa la opción para un campo
que en los hechos recibe entrada argentina, `"1.000"` se lee como **1 peso**
(un punto decimal con tres ceros), no como mil. Activarla es una decisión
explícita para un campo/fuente que se sabe en inglés (una planilla
importada, un formulario con `locale=en`), no un default seguro para
"por las dudas".

### `formatearPlata` con `Importe`/`bigint`

```ts
import { formatearPlata, type FormatoImporte } from "@mafesoftware/plata-ar";

// FormatoImporte = { moneda?: Moneda; locale?: string; decimalesSiempre?: boolean }
// (moneda solo aplica si `i` es un bigint a secas: la de un Importe la trae
// el propio importe y opciones.moneda NO la pisa.)

// A diferencia de la firma 0.1 (Centavos number), esta muestra SIEMPRE los
// dos decimales por defecto y formatea con aritmética bigint exacta — sin
// el límite de Number.MAX_SAFE_INTEGER centavos de la 0.1.
formatearPlata({ centavos: -5_000n, moneda: "USD" }); // "-US$ 50,00"
formatearPlata(4_400_000n);                            // "$ 44.000,00" (bigint a secas: ARS por defecto)
formatearPlata(4_400_000n, { decimalesSiempre: false }); // "$ 44.000"
formatearPlata({ centavos: 5_000n, moneda: "USD" }, { moneda: "ARS" }); // "US$ 50,00" (moneda ignorada: es un Importe)
formatearPlata(9_007_199_254_740_993n); // "$ 90.071.992.547.409,93" (exacto más allá de MAX_SAFE_INTEGER)

// El agrupamiento de miles/separadores es el del locale REAL (vía
// Intl.NumberFormat con un string decimal exacto, no reimplementado a
// mano asumiendo grupos de a 3 en todos lados):
formatearPlata(123_456_789n, { locale: "es-ES", moneda: "EUR" }); // "1.234.567,89 €"
formatearPlata(123_456_789n, { locale: "en-IN", moneda: "USD" }); // "$12,34,567.89" (agrupamiento irregular de la India)
```
