# Changelog

## 0.1.0

### Minor Changes

- 9a6a824: Primer release del paquete (0.1.0): compras de obra — ciclo de vida de un
  pedido de compra (requisición), cuadro comparativo de cotizaciones y ciclo
  de vida y totales de una orden de compra.
  
  - **`transicionPedido` / `transicionADestino` / `pendienteDeItem` /
    `pedidoQuedoComprado`**: el ciclo `borrador → enviado → aprobado |
    rechazado → cotizando → comprado_parcial → comprado → cerrado` de un
    pedido de compra, con `rechazado` reenviable a `enviado`, más lo que
    falta comprar de cada ítem.
  - **`armarComparativo`**: cuadro comparativo de cotizaciones de varios
    proveedores contra los ítems de un pedido — precio más bajo gana, empate
    de precio lo desempata el menor plazo, un proveedor que no cotizó un
    ítem no puede ganarlo.
  - **`transicionOrdenCompra` / `totalesOrdenCompra`**: el ciclo `borrador →
    pendiente_aprobacion → aprobada → enviada → entregada_parcial →
    entregada → facturada → cerrada`, o `anulada`, de una orden de compra, y
    sus totales con IVA por ítem (cada uno con su propia alícuota).
  - **`multiplicar` / `sumarCantidades` / `restarCantidades` /
    `compararCantidades` / `menorCantidad` / `porcentajeDe`**: la aritmética
    de `Cantidad` (decimal como `string`, hasta 4 decimales, nunca `number`)
    que usan los tres módulos de arriba y que la app puede reusar para sus
    propios cálculos con el mismo criterio.
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
  framework, sin `process.env` — todo entra por parámetro. Extraído del
  código puro de compras de Obriq (`src/lib/dominio/compras/`). Recepción de
  mercadería, conciliación de 3 vías, acopios y alertas de desvío son parte
  del dominio pero todavía no tienen lógica pura propia en Obriq (solo
  código acoplado a su DB) — se agregan a este paquete cuando esa lógica
  nazca pura del lado de la app.

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
