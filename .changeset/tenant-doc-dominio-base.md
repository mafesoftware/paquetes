---
"@mafesoftware/tenant": patch
---

Documenta en el README que `validarDominioBase` rechaza cualquier cosa que
no sea un hostname (URL con esquema, wildcard, barra, espacios), no solo el
string vacío — comportamiento ya presente en el código (fix previo), que no
había quedado documentado en la sección de la función. Sin cambios de
código.
