# Changelog

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
