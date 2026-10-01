# @mafesoftware/compras

Compras de obra: pedidos (requisiciones), cuadro comparativo de
cotizaciones y órdenes de compra.

Núcleo **puro**: sin DB, sin framework, sin `process.env` — ninguna función
de este paquete toca una base de datos ni conoce el esquema de tablas de tu
app. Toda cantidad física es un `Cantidad` (decimal como `string`, hasta 4
decimales — **nunca `number`** cuando multiplica un precio: un `number`
pierde precisión en cuanto el decimal no es exacto en binario) y toda plata
es `bigint` en centavos. Depende de `@mafesoftware/plata-ar` para el
redondeo comercial (medio hacia arriba, una sola vez, al final).

Recepción de mercadería (remitos), conciliación de 3 vías, acopios y
alertas de desvío son parte del dominio de compras pero todavía no tienen
lógica pura propia en la app de origen (Obriq) — hoy solo existen ahí como
código acoplado a su DB (acciones y consultas), así que no hay nada
genérico que extraer todavía. Se agregan a este paquete cuando esa lógica
nazca pura del lado de la app, con el mismo criterio que los cuatro módulos
de abajo.

No trae subpath `/drizzle`: no hay ninguna parte con DB que extraer
todavía — a diferencia de una cola genérica como `@mafesoftware/outbox`,
que sí tiene una tabla común. El esquema de pedidos/cotizaciones/OC de cada
app tiene además demasiadas columnas y relaciones propias (ítems,
proveedores, adjuntos, permisos, auditoría) como para modelar una tabla
común de cualquier forma — ese esquema vive en tu app, y este paquete solo
le presta la lógica pura que corre sobre esos datos.

```bash
bun add @mafesoftware/compras
```

## API

### Cantidades (`cantidad.ts`)

#### `multiplicar(cantidad: Cantidad, precioUnitario: bigint): bigint`

`cantidad × precioUnitario` (centavos), redondeo comercial al centavo.

```ts
import { multiplicar } from "@mafesoftware/compras";

multiplicar("200", 1_200_000n); // 240_000_000n ($ 2.400.000,00, 200 × $ 12.000)
```

#### `sumarCantidades(xs: readonly Cantidad[]): Cantidad`

Σ de cantidades, sin perder precisión.

```ts
import { sumarCantidades } from "@mafesoftware/compras";

sumarCantidades(["10.5", "0.25"]); // "10.7500"
```

#### `restarCantidades(a: Cantidad, b: Cantidad): Cantidad`

`a - b`, sin pasar por `number`.

```ts
import { restarCantidades } from "@mafesoftware/compras";

restarCantidades("1000", "850"); // "150.0000"
```

#### `compararCantidades(a: Cantidad, b: Cantidad): number`

Signo de `a - b`: `1` si `a > b`, `-1` si `a < b`, `0` si son iguales.

```ts
import { compararCantidades } from "@mafesoftware/compras";

compararCantidades("10", "5"); // 1
```

#### `menorCantidad(a: Cantidad, b: Cantidad): Cantidad`

La menor de dos `Cantidad`.

```ts
import { menorCantidad } from "@mafesoftware/compras";

menorCantidad("120", "100"); // "100"
```

#### `porcentajeDe(parte: Cantidad, total: Cantidad): string`

`(parte / total) × 100`, con 4 decimales. `total = "0"` → `"0.0000"`.

```ts
import { porcentajeDe } from "@mafesoftware/compras";

porcentajeDe("850", "1000"); // "85.0000"
```

### Pedidos (`pedidos.ts`)

Ciclo de vida de un pedido de compra (requisición): `borrador → enviado →
aprobado | rechazado → cotizando → comprado_parcial → comprado → cerrado`,
con `rechazado` reenviable a `enviado`.

#### `transicionPedido(estado: EstadoPedido, evento: EventoPedido, opciones?: { pendienteCero?: boolean }): EstadoPedido | Error`

La transición ante un evento, o un `Error` si no es válido en ese estado
(nunca tira). `"comprar"` depende de `opciones.pendienteCero`: con pendiente
→ `comprado_parcial`; sin pendiente → `comprado`.

```ts
import { transicionPedido } from "@mafesoftware/compras";

transicionPedido("borrador", "enviar"); // "enviado"
transicionPedido("cotizando", "comprar", { pendienteCero: false }); // "comprado_parcial"
transicionPedido("borrador", "comprar"); // Error: no se puede "comprar" un pedido en estado "borrador"
```

#### `transicionADestino(estado: EstadoPedido, destino: EstadoPedido): EstadoPedido | Error`

Resuelve qué evento manual lleva de `estado` a `destino` — para un kanban,
que arrastra a una COLUMNA, no dispara un evento con nombre.

```ts
import { transicionADestino } from "@mafesoftware/compras";

transicionADestino("aprobado", "cotizando"); // "cotizando"
```

#### `pendienteDeItem(cantidadPedida: Cantidad, cantidadComprada: Cantidad): Cantidad`

Lo que falta comprar de un ítem.

```ts
import { pendienteDeItem } from "@mafesoftware/compras";

pendienteDeItem("1000", "850"); // "150.0000"
```

#### `pedidoQuedoComprado(items: readonly { cantidadPedida: Cantidad; cantidadComprada: Cantidad }[]): boolean`

`true` si ya no queda nada pendiente de comprar en NINGÚN ítem — el
`pendienteCero` que necesita `transicionPedido(..., "comprar", ...)`.

```ts
import { pedidoQuedoComprado } from "@mafesoftware/compras";

pedidoQuedoComprado([{ cantidadPedida: "1000", cantidadComprada: "1000" }]); // true
```

### Cuadro comparativo (`comparativo.ts`)

#### `armarComparativo(items: readonly ItemComparativo[], proveedorIds: readonly string[], respuestas: readonly RespuestaComparativo[]): CuadroComparativo`

Arma el cuadro comparativo de cotizaciones de varios proveedores contra los
ítems de un pedido. "Mejor": precio más bajo gana; empate → gana el de
menor plazo; un proveedor que no cotizó un ítem queda con celda `null` y no
puede ganarlo. `mejorTotal`: el proveedor con el total más bajo entre los
que cotizaron algo. `mejorCombinado`: la suma del ganador de CADA ítem por
separado (nunca mayor al mejor total de un solo proveedor).

```ts
import { armarComparativo } from "@mafesoftware/compras";

const cuadro = armarComparativo(
  [{ id: "cemento", cantidad: "200" }],
  ["A", "B"],
  [
    { proveedorId: "A", itemId: "cemento", precio: 1_200_000n, plazoDias: 5, condiciones: null },
    { proveedorId: "B", itemId: "cemento", precio: 1_180_000n, plazoDias: 10, condiciones: null },
  ],
);
cuadro.filas[0]?.mejor; // "B" (precio más bajo)
cuadro.mejorTotal; // "B"
```

### Órdenes de compra (`ordenes-compra.ts`)

Ciclo de vida de una OC: `borrador → pendiente_aprobacion → aprobada →
enviada → entregada_parcial → entregada → facturada → cerrada`, o
`anulada`. Las transiciones que dependen de DATOS externos (recepciones ya
cargadas, remitos ya recibidos) no viven acá — las decide tu app,
escribiendo el estado directo; esta máquina cubre los eventos
ADMINISTRATIVOS.

#### `transicionOrdenCompra(estado: EstadoOrdenCompra, evento: EventoOrdenCompra): EstadoOrdenCompra | Error`

```ts
import { transicionOrdenCompra } from "@mafesoftware/compras";

transicionOrdenCompra("pendiente_aprobacion", "rechazar"); // "borrador" (la OC no tiene estado propio de rechazo)
transicionOrdenCompra("cerrada", "anular"); // Error: no se puede anular una orden de compra en estado "cerrada"
```

#### `totalesOrdenCompra(items: readonly ItemTotalOc[]): TotalesOrdenCompra`

Totales de una OC a partir de sus ítems, con IVA por ítem (cada uno puede
tener su propia alícuota) — para validar antes de persistir y para el PDF.

```ts
import { totalesOrdenCompra } from "@mafesoftware/compras";

totalesOrdenCompra([{ cantidad: "200", precio: 1_200_000n, alicuotaIva: "21" }]);
// { subtotal: 240_000_000n, iva: 50_400_000n, total: 290_400_000n }
```
