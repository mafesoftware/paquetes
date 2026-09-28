---
"@mafesoftware/limite-intentos": minor
---

Se saca la opción `tenant` de `tablaIntentos` (YAGNI: ninguna función del
paquete la usaba — `registrarIntento`/`consultarIntento`/`limpiarIntentos`
operan solo por `clave` — y confundía, sugiriendo un freno por tenant que
este paquete nunca implementó). Quien necesite una columna de tenant para
filtrar/reportar la agrega con `columnasExtra`, igual que cualquier otra
columna propia.

También: `ErrorLimiteIntentos` ahora se re-exporta desde
`@mafesoftware/limite-intentos/drizzle` (antes solo desde el núcleo), para
poder hacer `instanceof` sin un segundo import.

Antes de la primera publicación: sin consumidores externos afectados.
