---
"@mafesoftware/seguridad": patch
---

Batch de fixes chicos deferidos de revisiones previas:

- `crearPase` ahora rechaza un `sello` vacío o no-string con `ErrorSeguridad`
  (`codigo: "pase_invalido"`) — antes, un pase se firmaba igual con un sello
  inválido, y solo se notaba al intentar verificarlo.
- `verificarPase` ya no puede tirar: llamado con `opciones` `undefined`
  (bypaseando el tipo desde JS) o con un `token` cuyo `toString()` tira,
  devuelve `{ ok: false, motivo: "configuracion" }` o `{ motivo: "formato" }`
  según corresponda, nunca propaga la excepción.
- `guard` (`/next`): si el import perezoso de `next/navigation` FALLA (no
  hay `unstable_rethrow` que llamar), ahora relanza el error ORIGINAL de la
  acción — antes, el error del import fallido lo pisaba, tapando la causa
  real.
- `guard`: un resultado exitoso que trae sus propias claves `error`/`campo`
  ya no las deja colar en `{ ok: true, ...resultado }` — se descartan antes
  de mezclar.
- `claveBuffer` (`cifrar`/`descifrar`): una clave que no es `string` ni
  `Uint8Array` (`number`, `undefined`, `null`, un array plano de números)
  ahora da `ErrorSeguridad` (`codigo: "clave_invalida"`) en vez de un
  `TypeError` crudo de Node, o de aceptarse silenciosamente.
- `politicaCsp`: un valor de `extras` que es un `string` en vez de un array
  ahora tira `ErrorSeguridad` (antes se recorría carácter por carácter, sin
  avisar); una fuente con un carácter de control (`\p{Cc}`) también se
  rechaza; y un nombre de directiva que es solo `"-"` ya no pasa como
  válido.

Sin cambios en la API pública (mismas firmas, mismos tipos de resultado) —
solo entradas que antes tiraban distinto (o no tiraban) ahora dan el
resultado documentado.
