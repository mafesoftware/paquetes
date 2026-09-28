# Changelog

## 0.1.1

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

## 0.1.0

### Minor Changes

- 24c0a08: Primer release del paquete (0.1.0): detectores de reglas de código fuente
  para correr dentro de un test de vitest de la app consumidora. Heurísticas
  por regex/tokens (no un parser de TypeScript), con comentarios y strings
  ignorados donde importa.
  
  - `correrDetectores(archivos, detectores)`: corre cada `Detector` sobre cada
    `{ ruta; texto }` y concatena los `Hallazgo[]` (`{ regla; archivo; linea;
    detalle }`).
  - `leerArchivos(globs, raiz)`: **Node-only** (`node:fs`), recorre `raiz`
    recursivamente con un matcher de glob mínimo (`*`, `**`). El resto del
    paquete es puro.
  - `guardaEnUseServer({ nombresGuarda })`: en un archivo `"use server"` al
    principio, exige que el primer enunciado de cada export `async` llame a
    una de las guardas.
  - `sinSqlCrudoConOr()`: flagea un `` sql`...` `` de drizzle con un `or`
    suelto (fuera de `or(...)`).
  - `sinCoalesceCeroEnPlata({ patrones })`: flagea `?? 0` en una línea "de
    plata".
  - `sinSetHours()`: flagea `.setHours(...)`/`.setUTCHours(...)` (mutan el
    `Date` en el lugar).
  - `serverOnlyEnDatos({ patronArchivo })`: un archivo de datos tiene que
    importar `"server-only"`.
  - `sinImportDeDatosEnCliente({ patronDatos })`: un archivo `"use client"` no
    puede importar un módulo de datos.
  - `sinDependenciaFile()`: flagea una dependencia `file:`/`link:` en
    `package.json`.

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.

## 0.0.0

Primera versión: detectores de reglas de código fuente (`guardaEnUseServer`,
`sinSqlCrudoConOr`, `sinCoalesceCeroEnPlata`, `sinSetHours`,
`serverOnlyEnDatos`, `sinImportDeDatosEnCliente`, `sinDependenciaFile`),
`correrDetectores` y `leerArchivos` (Node-only).
