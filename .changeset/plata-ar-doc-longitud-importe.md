---
"@mafesoftware/plata-ar": patch
---

Aclara en el JSDoc de `LONGITUD_MAXIMA_IMPORTE` y en el README que
`parsearImporte` cuenta el texto CRUDO (espacios u otro whitespace
alrededor incluidos) contra ese máximo, sin recortarlo antes. Solo
documentación — el comportamiento ya era ese.
