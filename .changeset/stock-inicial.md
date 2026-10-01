---
"@mafesoftware/stock": minor
---

Primer release del paquete (0.1.0): costo promedio ponderado (CPP) de stock,
diferencia de inventario físico y alerta de reposición.

- **`costoPromedio` / `egresoAPromedio` / `egresoAValorFijo` /
  `costoUnitarioDivision`**: el saldo de un material (cantidad + valor) en
  `bigint` centavos, cómo lo mezcla un ingreso (CPP, nunca FIFO/LIFO) y cómo
  sale un egreso — al costo promedio vigente o a un valor fijo (reversión de
  una operación anterior, ej. anular una recepción al precio pactado
  originalmente). Egresar el saldo entero nunca deja valor residual: se lleva
  `s.valor` exacto en vez de recalcular `cantidad × costoUnitario` y
  arrastrar el redondeo.
- **`diferenciaInventario`**: la diferencia (faltante/sobrante) de un conteo
  físico contra el sistema, valorizada al costo promedio vigente.
- **`bajoMinimo`**: si una cantidad disponible está bajo su punto de
  reposición configurado.

**Núcleo puro** (regla 1 de diseño del monorepo): sin DB, sin framework, sin
`process.env` — saldos y cantidades entran siempre por parámetro. Depende
solo de `@mafesoftware/plata-ar` (`redondearComercial`, nunca reimplementado
acá). Las tablas de almacenes y movimientos de stock (qué se guarda, qué FKs
tiene, el `FOR UPDATE` que evita que dos egresos concurrentes sobregiren el
mismo saldo) son específicas de cada producto y quedan afuera a propósito —
no hay una parte de DB genérica para extraer.

Extraído de Obriq (`src/lib/dominio/materiales/stock.ts` y
`src/lib/dominio/materiales/inventario.ts`), donde ya era núcleo puro por
diseño (sin `@/db`, `next` ni nada de la app), generalizando los nombres
específicos del producto.
