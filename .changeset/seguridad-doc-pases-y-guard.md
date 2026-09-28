---
"@mafesoftware/seguridad": patch
---

Documenta en el README tres comportamientos ya presentes en el código que
no estaban reflejados: `crearPase` también valida que `sello` sea un string
no vacío (`ErrorSeguridad("pase_invalido")`); `guard()` descarta las claves
`error`/`campo` de un resultado exitoso antes de mezclarlo; `verificarPase`
da `motivo: "configuracion"` con `opciones` `null`/no-objeto y
`motivo: "formato"` con un `token` hostil cuyo `toString` tira. Sin cambios
de código.
