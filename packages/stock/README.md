# @mafesoftware/stock

Costo promedio ponderado de stock, diferencia de inventario físico y alertas
de reposición.

Parte de la familia de paquetes de MAFE Software: sin dependencias de
framework, sin ORM, y **puro** — sin DB, sin `process.env`, sin ningún
efecto de lado. Los saldos, cantidades y costos entran siempre por
parámetro; quien persiste (y resuelve la concurrencia, ej. con `FOR UPDATE`
sobre la fila del saldo) vive en la app que consume este paquete.

```bash
bun add @mafesoftware/stock
```

La documentación de cada función está en `src/`, con **el motivo de cada
decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué caso cubre.

## Probar

```bash
bun test
```

## Tipos y unidades

- **Plata**: siempre `bigint` en **centavos** — un monto nunca pasa por
  `number`, ni como paso intermedio.
- **Cantidades físicas** (`Cantidad = string`): decimal con hasta 4
  decimales (`"120"`, `"833.3333"`) — tampoco pasan por `number`, para no
  perder precisión en un promedio con muchos decimales.
- El redondeo (comercial, medio hacia arriba, al centavo) usa
  `redondearComercial` de `@mafesoftware/plata-ar` — nunca reimplementado
  acá.

## API

### Costo promedio ponderado (CPP)

```ts
import { costoPromedio, egresoAPromedio, egresoAValorFijo, type SaldoStock } from "@mafesoftware/stock";

let saldo: SaldoStock = { cantidad: "0", valor: 0n };

// Ingreso 100 u a $ 10.000 (1.000.000 centavos)
saldo = costoPromedio(saldo, { cantidad: "100", costoUnitario: 1_000_000n });
// { cantidad: "100.0000", valor: 100_000_000n, costoUnitario: 1_000_000n }

// Ingreso 50 u a $ 13.000 → se mezcla con el saldo existente
saldo = costoPromedio(saldo, { cantidad: "50", costoUnitario: 1_300_000n });
// { cantidad: "150.0000", valor: 165_000_000n, costoUnitario: 1_100_000n } ($ 11.000 promedio)

// Egreso al costo promedio VIGENTE (no se recalcula)
const egreso = egresoAPromedio(saldo, "30");
// egreso.ok === true → { valorEgreso: 33_000_000n, resto: { cantidad: "120.0000", valor: 132_000_000n } }

// Cantidad insuficiente
egresoAPromedio(saldo, "999");
// { ok: false, error: "stock_insuficiente", disponible: "120.0000" }
```

Egresar el **saldo entero** nunca deja valor residual (ni $ 0,02 de más ni
de menos): se lleva `s.valor` exacto en vez de recalcular
`cantidad × costoUnitario` y arrastrar el redondeo.

`egresoAValorFijo(s, cantidad, valorFijo)` es la variante para revertir una
operación anterior al costo ORIGINAL de esa operación (ej.: anular una
recepción al precio pactado en la orden de compra), no al costo promedio
vigente del saldo — mismo chequeo de disponibilidad, y el valor egresado se
acota a `s.valor` para no dejarlo negativo.

`costoUnitarioDivision(valor, cantidad)` expone el cociente
`valor / cantidad` con el mismo redondeo — útil para valorizar un ajuste al
costo promedio vigente sin pasar por un `costoPromedio`/`egreso*`.

### Inventario físico y reposición

```ts
import { diferenciaInventario, bajoMinimo } from "@mafesoftware/stock";

// Sistema 120, contado 115, costo promedio $ 11.000 → faltante
diferenciaInventario("120", "115", 1_100_000n);
// { cantidad: "-5.0000", valor: -5_500_000n }

// Punto de reposición 50, disponible 45 → alerta
bajoMinimo("45", "50"); // true
bajoMinimo("55", "50"); // false
bajoMinimo("10", null); // false (sin punto de reposición configurado)
```

## Qué queda afuera a propósito

Las tablas de almacenes y movimientos de stock (qué se guarda, qué FKs
tiene, a qué proyecto o rubro de presupuesto se asocia, el `FOR UPDATE` que
evita que dos egresos concurrentes sobregiren el mismo saldo) son
específicas de cada producto — no hay una parte de DB genérica para
extraer a este paquete. Lo que sí es común entre productos es la
**aritmética**: el CPP, la diferencia de inventario y la alerta de
reposición de arriba.
