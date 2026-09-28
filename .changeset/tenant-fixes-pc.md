---
"@mafesoftware/tenant": patch
---

`validarDominioBase` (y por lo tanto `slugDeHost`/`resolverTenant`) ahora
rechaza cualquier `dominioBase` que no sea un hostname real: una URL con
esquema (`"https://x"`), un valor con una barra (`"x/"`), un wildcard
(`"*.x"`), valores con espacios en el medio, o cualquier otra cosa que no
sean etiquetas `[a-z0-9-]` separadas por puntos — todos tiran `ErrorTenant`
(`codigo: "dominio_base_invalido"`), igual que un `dominioBase` vacío.

Además, el README documenta que `x-forwarded-host` puede ser falsificado por
quien manda la request salvo que un proxy de confianza (Vercel, un load
balancer propio) lo sobrescriba antes de llegar a la app.

Sin cambios de comportamiento para un `dominioBase` que ya era válido.
