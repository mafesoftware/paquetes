# Changelog

## 0.1.0

### Minor Changes

- 24c0a08: Primer release del paquete (0.1.0): harness de aislamiento entre tenants.
  
  - `probarAislamiento({ casos, sembrar, esNoEncontrado })` (núcleo puro): corre
    cada caso como tenant B contra un id de A y devuelve
    `{ nombre; ok; detalle }[]`, clasificando el resultado (o la excepción) de
    `ejecutar` con `esNoEncontrado`. `sembrar()` se llama una vez por caso.
  - `describeAislamiento(opciones)` (subpath `/vitest`, `vitest` como
    peerDependency opcional): registra un `it` de vitest por caso, que falla si
    el caso filtra.

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.

## 0.0.0

Primera versión: `probarAislamiento` (núcleo) y `describeAislamiento`
(subpath `/vitest`, peerDependency opcional).
