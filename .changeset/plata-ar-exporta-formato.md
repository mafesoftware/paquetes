---
"@mafesoftware/plata-ar": patch
---

Arregla un bug de empaquetado: `index.ts` no re-exportaba `formato.ts`, así
que `formatearImporteExacto` quedaba inalcanzable para quien consume el
paquete publicado (`formatearPlata`, que sí es pública, la usa por dentro,
pero no la expone). Agrega `export * from "./formato.js"` al index y un test
que la importa desde ahí.
