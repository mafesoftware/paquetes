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

## Ejemplo

```ts
import { parsearPlata, plataARS, repartirCentavos } from "@mafesoftware/plata-ar";

parsearPlata("44.000");   // 4_400_000  (cuarenta y cuatro mil pesos)
parsearPlata("1234.56");  //   123_456  (una celda copiada de una planilla)
plataARS(4_400_000);      // "$ 44.000"

// Reparte sin perder ni inventar un centavo: la suma da SIEMPRE el total.
repartirCentavos(100, [1, 1, 1]); // [34, 33, 33]
```

**Lo que no es plata no pasa por `parsearPlata`.** Un porcentaje va por
`parsearPorcentaje` y una cantidad por `parsearCantidad`: pasarlos por el parser
de plata los multiplica por cien, y un "10" tipeado llega como 1000.
