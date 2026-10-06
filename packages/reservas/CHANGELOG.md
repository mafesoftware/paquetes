# Changelog

## 0.1.3

### Patch Changes

- Updated dependencies [0aded29]
- Updated dependencies [0aded29]
  - @mafesoftware/fechas-ar@0.3.0
  - @mafesoftware/plata-ar@0.3.0

## 0.1.2

### Patch Changes

- Agrega la condición `"default"` a cada entrada de `exports` (raíz y subpaths,
  como `/drizzle` o `/next`), justo después de `"import"`.
  
  Sin esto, `drizzle-kit generate` (y cualquier otro loader que resuelva vía
  CJS, incluido `require(esm)` de Node ≥22) fallaba con
  `ERR_PACKAGE_PATH_NOT_EXPORTED` al importar, por ejemplo,
  `@mafesoftware/tenant/drizzle` desde un `schema.ts`: el `exports` map solo
  tenía condiciones `types` e `import`, y ninguna que un resolver CJS supiera
  interpretar.
  
  `"default"` apunta al mismo archivo `.js` que `"import"` — el paquete sigue
  siendo ESM puro, no se agrega ningún build CJS — pero al ser la condición de
  más baja prioridad, un loader que no entiende `"import"` cae en ella igual.
  
  Sin cambios de API pública.
- Updated dependencies
  - @mafesoftware/fechas-ar@0.2.1
  - @mafesoftware/plata-ar@0.2.1

## 0.1.1

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.
- a8db00c: Las dependencias internas del monorepo pasan de `"workspace:*"` a
  `"workspace:^"`. `scripts/reescribir-workspace.ts` (que corre `bun run
  release` antes de `changeset publish`) ya sabía convertir las dos formas —
  `"workspace:*"` a la versión exacta, `"workspace:^"` a `"^" + la versión —
  pero `"workspace:*"` publicado como versión exacta fija el internal
  dependency a un único patch, y cada bump de `plata-ar`/`fechas-ar`/`tenant`
  obligaría a republicar TODO lo que depende de ellos aunque el cambio sea
  compatible. Con `"workspace:^"`, el paquete publicado queda con
  `"^x.y.z"`, que permite actualizaciones compatibles de la dependencia sin
  forzar una nueva publicación del que la consume.
  
  Sin cambios de comportamiento: `bun run lint:paquetes` (el chequeo de
  `bun pm pack` + reescritura) y `tests/reescribir-workspace.test.ts` ya
  cubrían este caso.
- Updated dependencies [f05e1fc]
- Updated dependencies [a8db00c]
- Updated dependencies [1050024]
- Updated dependencies [7d3a1fd]
- Updated dependencies [a8db00c]
  - @mafesoftware/fechas-ar@0.2.0
  - @mafesoftware/plata-ar@0.2.0

## 0.1.0

Motor de disponibilidad, turnos y lista de espera: grilla de un día
(`generarTurnos`), reglas de reserva con lista de espera automática
(`puedeReservar`), promoción al cancelar (`proximoEnEspera`) y el chequeo de
solapamiento que corre la acción del servidor (`verificarSolapamiento`,
`seSolapan`). Puro, sobre `@mafesoftware/fechas-ar` y
`@mafesoftware/plata-ar`.
