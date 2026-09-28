---
"@mafesoftware/pruebas-tenant": minor
---

Primer release del paquete (0.1.0): harness de aislamiento entre tenants.

- `probarAislamiento({ casos, sembrar, esNoEncontrado })` (núcleo puro): corre
  cada caso como tenant B contra un id de A y devuelve
  `{ nombre; ok; detalle }[]`, clasificando el resultado (o la excepción) de
  `ejecutar` con `esNoEncontrado`. `sembrar()` se llama una vez por caso.
- `describeAislamiento(opciones)` (subpath `/vitest`, `vitest` como
  peerDependency opcional): registra un `it` de vitest por caso, que falla si
  el caso filtra.
