---
"@mafesoftware/documentos-ar": minor
---

Renombra el campo `motivo` (el texto humano) a `mensaje` en el resultado de
`validarCuit`/`validarDni`/`validarCbu`/`validarCvu`/`validarAlias` —
`codigo` (el código de máquina) no cambia. Esto alinea a `documentos-ar` con
`seguridad`/`tenant`/`carnet-qr`, donde `motivo` YA es el código de máquina;
tener el mismo nombre de campo significando dos cosas distintas según el
paquete era confuso, y corregirlo antes de la primera publicación es gratis.

Antes de la primera publicación: sin consumidores externos afectados.
