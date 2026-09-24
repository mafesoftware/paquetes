---
"@mafesoftware/correo": minor
---

`enviarCorreo` acepta una opción `claveIdempotencia` opcional, que se manda
como header `Idempotency-Key` a Resend. Con la misma clave, un segundo POST
(un reintento de red, o un caller que reintenta un envío que ya pudo haber
salido) no crea un segundo mail — Resend devuelve el resultado del primero
en vez de mandarlo de nuevo.

Pensada para `@mafesoftware/outbox` (`transporteCorreo`), cuyo
`procesarOutbox` puede reintentar un mensaje si el worker se cae DESPUÉS de
que Resend lo aceptó pero ANTES de registrar que ya se mandó ("entrega al
menos una vez", documentado ahí) — sin este header, ese reintento le llega
dos veces al destinatario. Sin pasar `claveIdempotencia` (el comportamiento
de siempre), cada llamada sigue siendo un envío nuevo para Resend.
