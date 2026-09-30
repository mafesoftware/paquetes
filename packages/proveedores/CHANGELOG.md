# Changelog

## 0.1.0

### Minor Changes

- 01a65d4: Primer release del paquete (0.1.0): dominio de proveedores para un ERP/SaaS
  multi-tenant argentino, extraído de Obriq (`src/lib/dominio/proveedores/` y
  `src/lib/dominio/documentos/`, más `src/lib/dominio/ordenesPago/`).
  
  - **`iva.ts`**: `calcularIva`/`esAlicuotaIva` por alícuota argentina (21,
    10,5, 27, 0, exento, no gravado), cada una como fracción exacta en
    `bigint`.
  - **`totales.ts`**: `totalesDeItems`/`subtotalItem` (Σ ítems + IVA),
    `totalPercepciones`, y `validarTotalDocumento` — compara el total
    calculado contra el informado, con una tolerancia de $1 y un ajuste
    explícito a persistir (nunca aplicado en silencio).
  - **`prorrateo.ts`**: `sumaCien`/`prorratearPorPorcentaje` — prorratea un
    documento entre proyectos por porcentaje, por mayor resto (delega en
    `repartirPorMayorResto` de `@mafesoftware/plata-ar`), sin perder ni
    inventar un centavo.
  - **`archivar.ts`**: `decidirArchivarProveedor` — archivar con saldo
    pendiente exige `confirmado: true` explícito, nunca bloquea para siempre.
  - **`balance-orden-pago.ts`**: `validarBalanceOp`/`totalPorMoneda` — los
    medios de pago tienen que cubrir exacto lo imputado, moneda por moneda
    (multi-caja multi-moneda); una imputación que consume un anticipo
    existente no exige plata nueva. Más `excedeSaldoDocumento` y
    `saldoDisponibleAnticipo`.
  - **`aprobacion-orden-pago.ts`**: `requiereAprobacion`/`estadoInicialOp` —
    aprobación simple de una orden de pago por encima de un umbral
    configurable.
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin DB, sin framework, sin
  variables de entorno. Depende de `@mafesoftware/plata-ar` para la aritmética
  de plata (redondeo comercial, reparto por mayor resto, el tipo `Moneda`) —
  no reimplementada acá.

## 0.0.0

Paquete generado a mano, siguiendo la estructura de `scripts/nuevo-paquete.ts`.
