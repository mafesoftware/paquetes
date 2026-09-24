---
"@mafesoftware/seguridad": minor
---

Primer release del paquete (0.1.0): primitivas de seguridad centralizadas
que store360, consult360, facturar, distrigo y alquileres-app reimplementaban
cada uno por su lado.

- `compararEnTiempoConstante(a, b)`: comparación de secretos sin filtrar por
  timing, con `false` (no excepción) cuando difieren en largo. Puerto de
  `compararEnTiempoConstante` de `@mafesoftware/carnet-qr`.
- `cifrar(textoPlano, clave)` / `descifrar(guardado, clave)`: AES-256-GCM
  versionado, formato `"v1:<iv>:<tag>:<datos>"` (base64) **compatible con
  `fiscalCifrado.ts` de store360** — migrar es pasarle la misma clave de 32
  bytes, sin volver a cifrar nada. La clave es un parámetro (string base64 o
  `Uint8Array`), nunca `process.env`. Tira `ErrorSeguridad` con `codigo`
  (`"clave_invalida"`, `"formato_invalido"`, `"autenticacion_fallida"`) en
  vez de devolver un resultado: es un error de programación o un dato
  corrupto, no una entrada de usuario a validar.
- `crearPase(pase, secreto)` / `verificarPase(token, secreto, opciones)`:
  pases firmados y con vencimiento (reset de contraseña, invitaciones, magic
  links) sin tabla de tokens. `sello` es un string opaco que la app deriva de
  un estado que, al cambiar, mata el pase (típicamente un resumen del
  `passwordHash` del momento) — puerto generalizado de `paseRecupero.ts` de
  store360. `verificarPase` nunca tira: `{ ok, sujeto }` o
  `{ ok: false, motivo }`, con `motivo` en
  `"formato" | "firma" | "vencido" | "proposito" | "sello"`.
- `esUuid(valor)`: UUID canónico v1–v8 (y el nulo), para no dejar que un id
  con basura llegue a Postgres y tire `invalid input syntax for type uuid` en
  vez de "no encontrado". `unaDe(valor, opciones, porOmision)`: narrowing a
  una lista cerrada. Ambos, puerto de `ids.ts` de gestionflow.
- Subpath `/next` (`next >= 16` como peerDependency opcional, el núcleo no lo
  importa):
  - `politicaCsp(nonce, extras?)` / `generarNonce()`: CSP con nonce por
    request (`script-src` sin `'unsafe-inline'`), extensible por directiva.
  - `cabecerasSeguridad()`: `X-Content-Type-Options`, `Referrer-Policy`,
    `X-Frame-Options`, `Permissions-Policy`, `Strict-Transport-Security`.
  - `autorizarCron(req, secreto)`: `Authorization: Bearer <secreto>` en
    tiempo constante, **falla cerrado** si el secreto no está configurado.
  - `guard(fn)` / `ErrorNegocio`: envoltorio de server actions — convierte
    `ErrorNegocio` en `{ ok: false, error, campo? }`, mezcla el éxito en
    `{ ok: true, ...resultado }`, y vuelve a tirar `redirect()`/`notFound()`
    de Next (vía `unstable_rethrow`) y cualquier error que no sea de
    negocio. Puerto generalizado de `guard()` en `src/app/actions.ts` de
    distrigo.
  - `ipDe(headers)`: primera IP de `x-forwarded-for`, si no `x-real-ip`, si
    no `null`.
- Núcleo puro: sin `process.env`, sin dependencias de framework. Cobertura
  ≥95% en `src/**` (excluye `src/next/**`, igual probado con tests propios).
  Property-based tests (fast-check): `compararEnTiempoConstante(a, b) ===
  (a === b)` para strings al azar de largo distinto, y
  `descifrar(cifrar(x)) === x` para strings al azar incluyendo unicode.
