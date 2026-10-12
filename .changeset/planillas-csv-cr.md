---
"@mafesoftware/planillas": patch
---

`filasACsv` entrecomilla también las celdas con un `\r` en el medio. Excel corta la fila en un CR suelto: un nombre como `Juan\r=WEBSERVICE(...)` dejaba la fórmula sola en otra celda, sin el apóstrofo de la anti-inyección.
