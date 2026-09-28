# Changelog

## 0.1.1

### Patch Changes

- Agrega la condición `"default"` a cada entrada de `exports` (raíz y subpaths,
  como `/drizzle` o `/next`), justo después de `"import"`.
  
  Sin esto, `drizzle-kit generate` (y cualquier otro loader que resuelva vía
  CJS, incluido `require(esm)` de Node ≥22) fallaba con
  `ERR_PACKAGE_PATH_NOT_EXPORTED` al importar, por ejemplo,
  `@mafesoftware/tenant/drizzle` desde un `schema.ts`: el `exports` map solo
  tenía condiciones `types` e `import`, y ninguna que un resolver CJS supiera
  interpretar.
  
  `"default"` apunta al mismo archivo `.js` que `"import"` — el paquete sigue
  siendo ESM puro, no se agrega ningún build CJS — pero al ser la condición de
  más baja prioridad, un loader que no entiende `"import"` cae en ella igual.
  
  Sin cambios de API pública.

## 0.1.0

### Minor Changes

- 2ecc067: Primer release del paquete (0.1.0): primitivas de seguridad centralizadas
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

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.
- a8db00c: Documenta en el README tres comportamientos ya presentes en el código que
  no estaban reflejados: `crearPase` también valida que `sello` sea un string
  no vacío (`ErrorSeguridad("pase_invalido")`); `guard()` descarta las claves
  `error`/`campo` de un resultado exitoso antes de mezclarlo; `verificarPase`
  da `motivo: "configuracion"` con `opciones` `null`/no-objeto y
  `motivo: "formato"` con un `token` hostil cuyo `toString` tira. Sin cambios
  de código.
- cb4c264: Batch de fixes chicos deferidos de revisiones previas:
  
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

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
