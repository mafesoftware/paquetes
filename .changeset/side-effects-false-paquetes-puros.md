---
"@mafesoftware/plata-ar": patch
"@mafesoftware/fechas-ar": patch
"@mafesoftware/documentos-ar": patch
"@mafesoftware/indices-ar": patch
---

Agrega `"sideEffects": false` a los paquetes puros (sin efectos de
importación: no mutan globals, no ejecutan nada al cargarlos) — permite que
un bundler haga tree-shaking real de las funciones no usadas en vez de
asumir, por las dudas, que todo el módulo hace falta.
