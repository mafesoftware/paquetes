# @mafesoftware/plata-ar

Plata en centavos, parseo y formato argentino. Sin dependencias.

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
