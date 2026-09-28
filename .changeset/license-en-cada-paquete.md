---
"@mafesoftware/accesos": patch
"@mafesoftware/auditoria": patch
"@mafesoftware/carnet-qr": patch
"@mafesoftware/cuotas": patch
"@mafesoftware/documentos-ar": patch
"@mafesoftware/fechas-ar": patch
"@mafesoftware/indices-ar": patch
"@mafesoftware/kapso-wa": patch
"@mafesoftware/limite-intentos": patch
"@mafesoftware/numeradores": patch
"@mafesoftware/outbox": patch
"@mafesoftware/permisos": patch
"@mafesoftware/plata-ar": patch
"@mafesoftware/pruebas-fuentes": patch
"@mafesoftware/pruebas-tenant": patch
"@mafesoftware/reservas": patch
"@mafesoftware/seguridad": patch
"@mafesoftware/tenant": patch
---

Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
publicado aunque no estuviera acá (confirmado con un pack en seco), pero
`tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
nuevos.
