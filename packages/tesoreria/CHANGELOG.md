# Changelog

## 0.1.0

### Minor Changes

- d86eb40: Primer release del paquete (0.1.0): decisiones de negocio de tesorería —
  saldos de caja, transferencias entre cajas con tipo de cambio implícito,
  arqueo y el ciclo de una rendición de gastos.
  
  - **`decidirEgreso`**: si se puede registrar un egreso dado el saldo actual
    de una caja, con un error claro (y el saldo disponible) en vez de
    permitir que quede negativa cuando eso no está permitido.
  - **`fechaBloqueadaPorCierre`**: si una fecha de movimiento está bloqueada
    por el último cierre vigente de la caja.
  - **`tcImplicito`**: el tipo de cambio implícito de una transferencia con
    cambio de moneda (`importeOrigen / importeDestino`), como decimal de 6
    dígitos redondeado medio hacia arriba — reutiliza `redondearComercial` de
    `@mafesoftware/plata-ar` en vez de reimplementar el redondeo.
  - **`CATEGORIA_TRANSFERENCIA` / `esTransferenciaInterna`**: la categoría de
    cashflow de una transferencia entre cajas propias, y el chequeo de si una
    categoría es esa — una transferencia interna queda afuera de cualquier
    cashflow operativo.
  - **`diferenciaArqueo` / `requiereAjusteArqueo`**: la diferencia de un
    arqueo (`saldoContado - saldoSistema`) y si necesita un ajuste.
  - **`EstadoRendicion` / `puedeAprobarRendicion` / `puedeRechazarRendicion` /
    `puedeReponerRendicion`**: el ciclo de una rendición de gastos (`cargado
    → aprobado → repuesto`, con `rechazado` desde `cargado` o `aprobado`).
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
  framework, sin `process.env` — saldos, fechas y estados entran siempre por
  parámetro. Extraído del código puro de tesorería de Obriq
  (`src/lib/dominio/tesoreria/`).

## 0.1.0

Primer release del paquete: decisiones de negocio de tesorería — saldos de
caja (`decidirEgreso`, `fechaBloqueadaPorCierre`), transferencias entre
cajas con tipo de cambio implícito (`tcImplicito`, `esTransferenciaInterna`,
`CATEGORIA_TRANSFERENCIA`), arqueo (`diferenciaArqueo`,
`requiereAjusteArqueo`) y el ciclo de una rendición de gastos
(`puedeAprobarRendicion`, `puedeRechazarRendicion`, `puedeReponerRendicion`).

Extraído del código puro de tesorería de Obriq
(`src/lib/dominio/tesoreria/`). `tcImplicito` reutiliza
`redondearComercial` de `@mafesoftware/plata-ar` en vez de reimplementar el
redondeo medio hacia arriba.
