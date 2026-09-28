---
"@mafesoftware/auditoria": patch
"@mafesoftware/accesos": patch
"@mafesoftware/cuotas": patch
"@mafesoftware/outbox": patch
"@mafesoftware/indices-ar": patch
"@mafesoftware/numeradores": patch
"@mafesoftware/reservas": patch
---

Las dependencias internas del monorepo pasan de `"workspace:*"` a
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
