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

Además:

- Nueva categoría de error `"conflicto_idempotencia"` (HTTP 409 de Resend):
  la MISMA `claveIdempotencia` se usó con un cuerpo de request DISTINTO —
  distinto de un duplicado exacto (que Resend resuelve solo). Reintentar
  puede arreglarlo.
- `enviarCorreo` acepta una opción `señal` (`AbortSignal`) opcional, pasada
  tal cual al `fetch` — pensada para que un caller con su propio timeout
  (`@mafesoftware/outbox`) pueda cortar el pedido. Cancelar la señal no
  deshace un envío que Resend ya haya aceptado del otro lado.
