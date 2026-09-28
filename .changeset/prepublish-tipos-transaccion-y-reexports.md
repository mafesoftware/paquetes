---
"@mafesoftware/outbox": minor
"@mafesoftware/numeradores": minor
---

**`/drizzle`: el primer parámetro de las funciones que exigen transacción
ahora lo dice su TIPO, no solo un chequeo en tiempo de ejecución.**

- `encolar` (`@mafesoftware/outbox/drizzle`) y `siguienteNumero`
  (`@mafesoftware/numeradores/drizzle`) tipan su primer parámetro como el
  nuevo `Transaccion` (exportado desde cada `/drizzle`), no `DbCliente` —
  pasarles el `db` de nivel superior ahora falla en TIEMPO DE COMPILACIÓN,
  además del `ErrorOutbox`/`ErrorNumeradores("requiere_transaccion")` que
  ya tiraban en runtime (`exigirTransaccion` se mantiene sin cambios).
- `configurarNumerador` (que NO exige transacción) renombra su primer
  parámetro de `tx` a `db` — sigue aceptando tanto `db` como una `tx`, el
  nombre viejo era engañoso.
- `ErrorOutbox`/`ErrorNumeradores` ahora también se re-exportan desde sus
  respectivos `/drizzle`, para poder hacer `instanceof` sin un segundo
  import del núcleo.

Sin cambios de comportamiento en runtime.
