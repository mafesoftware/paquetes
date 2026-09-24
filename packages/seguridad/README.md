# @mafesoftware/seguridad

Primitivas de seguridad para los productos de MAFE Software: comparación en
tiempo constante, cifrado versionado AES-256-GCM, pases firmados con
vencimiento (reset de contraseña, invitaciones, magic links), CSP/cabeceras
para Next.js, auth de cron que falla cerrado, y un `guard()` para server
actions.

Centraliza lo que store360, consult360, facturar, distrigo y alquileres-app
reimplementaban cada uno por su lado (o directamente no tenían).

Parte de la familia de paquetes de MAFE Software: sin dependencias de
framework, sin ORM, y **puro** en el núcleo — nada lee `process.env`; las
claves y secretos entran por parámetro. Lo específico de Next.js vive aparte,
en el subpath `/next` (`next` como peerDependency opcional, `>=16`).

```bash
bun add @mafesoftware/seguridad
```

La documentación de cada función está en `src/`, con **el motivo de cada
decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué caso cubre.

## API

### Núcleo (`@mafesoftware/seguridad`)

#### `compararEnTiempoConstante(a: string, b: string): boolean`

Compara dos secretos sin filtrar por timing cuántos caracteres coinciden.

- `false` si `a`/`b` no son ambos `string` (`null`/`undefined`/`number` no
  cuentan como "vacío": son directamente inválidos).
- `false` si CUALQUIERA de los dos está vacío — **incluso comparando dos
  vacíos entre sí**: esta función compara SECRETOS, y un secreto real nunca
  es la cadena vacía; que `("", "")` diera `true` era justo el agujero por el
  que un secreto no configurado (`undefined` → `""`) podía "coincidir" con lo
  que mandara quien ataca.
- `false` si difieren en largo (en code units UTF-16, no en bytes UTF-8 — ver
  abajo), sin tirar.

```ts
import { compararEnTiempoConstante } from "@mafesoftware/seguridad";

compararEnTiempoConstante(tokenRecibido, tokenGuardado); // true | false
```

**Por qué UTF-16 y no UTF-8.** El encoder UTF-8 de Node reemplaza cualquier
surrogate suelto (la mitad de un par, inválido por sí solo) por el mismo
carácter U+FFFD — así que dos strings JS DISTINTOS podían terminar
codificando a los mismos bytes UTF-8 y comparar "iguales" sin serlo. Comparar
por code units UTF-16 (`utf16le`) es una función inyectiva de string a bytes:
nunca colisiona.

#### `cifrar(textoPlano: string, clave: Clave): string`

Cifra con AES-256-GCM. `clave` es un string en base64 **estándar canónico**
(32 bytes, como lo devuelve `openssl rand -base64 32` — nunca base64url, ni
con relleno `=` en una posición rara) o un `Uint8Array` ya decodificado.
Devuelve `"v1:<iv>:<tag>:<datos>"`, todo en base64 — **el mismo formato que
`fiscalCifrado.ts` de store360**, así que migrar es pasarle la misma clave de
32 bytes, sin volver a cifrar nada. Tira `ErrorSeguridad` (`codigo:
"clave_invalida"`) si la clave no tiene 32 bytes o no es base64 canónico.

```ts
import { cifrar } from "@mafesoftware/seguridad";

const clave = process.env.CIFRADO_CLAVE!; // 32 bytes en base64, decidido por la app
cifrar("certificado o token a guardar", clave);
// "v1:qk3F.../base64-iv:.../base64-tag:.../base64-datos"
```

**Compatibilidad con store360, un caso borde documentado.** `cifrar("")`
produce un segmento `<datos>` vacío (la codificación base64 de cero bytes es
`""`). Este paquete lo lee perfecto de vuelta; una implementación vieja que
parsee el formato con un split ingenuo (como `fiscalCifrado.ts`) podría
llegar a rechazarlo. Es aceptable: cifrar un string vacío es un caso de uso
raro, y no afecta lo que store360 realmente guarda (certificados, tokens,
siempre no vacíos).

#### `descifrar(guardado: string, clave: Clave): string`

La inversa de `cifrar`. Tira `ErrorSeguridad`:

- `codigo: "formato_invalido"` — no tiene el formato `v1:<iv>:<tag>:<datos>`,
  el prefijo no es `"v1"`, algún segmento no es base64 estándar CANÓNICO (sin
  base64url, sin relleno mal puesto), o el IV/tag no tienen el largo EXACTO
  (12 y 16 bytes respectivamente — un tag truncado es más fácil de forzar
  por fuerza bruta, así que no se acepta ni con un largo "razonablemente
  parecido").
- `codigo: "autenticacion_fallida"` — el formato es correcto pero el tag de
  GCM no autentica (texto alterado, o la clave no es la que lo cifró).

```ts
import { cifrar, descifrar, ErrorSeguridad } from "@mafesoftware/seguridad";

const guardado = cifrar("dato sensible", clave);
descifrar(guardado, clave); // "dato sensible"

try {
  descifrar("basura-que-no-es-nuestra", clave);
} catch (error) {
  if (error instanceof ErrorSeguridad) error.codigo; // "formato_invalido"
}
```

#### `crearPase(pase: DatosPase, secreto: string): string`

Firma un pase: reset de contraseña, invitación, magic link. Sin tabla: el
token vence solo y nadie puede fabricarlo sin `secreto`. `sello` es un string
opaco que la app deriva de un estado que, al cambiar, tiene que matar el pase
(típicamente un resumen del `passwordHash` del momento).

`secreto` tiene que ser un string de **al menos 32 caracteres** (es la clave
HMAC: uno corto se puede forzar por fuerza bruta) — si no, tira
`ErrorSeguridad` (`codigo: "secreto_invalido"`). `venceEn` tiene que ser una
fecha/epoch VÁLIDA (no `NaN`, no un `Invalid Date`) — si no, tira
`ErrorSeguridad` (`codigo: "pase_invalido"`).

```ts
import { crearPase } from "@mafesoftware/seguridad";

const token = crearPase(
  {
    proposito: "reset-password",
    sujeto: usuario.id,
    venceEn: Date.now() + 30 * 60_000, // media hora
    sello: selloDePassword(usuario.passwordHash), // lo deriva la app
  },
  process.env.AUTH_SECRET!, // >= 32 caracteres
);
// "<payload base64url>.<firma base64url>" — esto va en el link del mail
```

#### `verificarPase(token, secreto, opciones): ResultadoPase`

**Nunca tira**: `{ ok: true, sujeto }` o `{ ok: false, motivo }`, con
`motivo` en
`"formato" | "firma" | "vencido" | "proposito" | "sello" | "configuracion"`.
`selloActual` se recalcula del estado ACTUAL (hay que leerlo de la base
antes de llamar): si no coincide con el que se firmó, el pase murió aunque
no haya vencido — por ejemplo, porque la contraseña ya se cambió.

Un pase es válido en el instante EXACTO de `venceEn` (`ahora === venceEn`
todavía sirve) e inválido en cualquier instante posterior. Un `token` de más
de 4096 caracteres se rechaza directamente con `motivo: "formato"`, sin
intentar parsearlo — un pase real nunca se acerca a ese largo.

`"configuracion"` es distinto a los demás motivos: no dice que el TOKEN esté
mal, dice que `secreto` (vacío, demasiado corto, o no-string) o `ahora`
(`NaN`, `Invalid Date`) están mal — un bug de quien LLAMA a `verificarPase`,
no de quien mandó el pase. Nunca tira ni con esto: un `secreto` `undefined`
antes daba un `TypeError` crudo de `node:crypto`, y un `ahora` `NaN` podía
"revivir" un pase vencido hace rato (porque `NaN > cualquier_cosa` siempre es
`false`) — las dos cosas se cierran con `{ ok: false, motivo: "configuracion" }`.

```ts
import { verificarPase } from "@mafesoftware/seguridad";

const resultado = verificarPase(token, process.env.AUTH_SECRET!, {
  proposito: "reset-password",
  selloActual: selloDePassword(usuarioDeLaBase.passwordHash), // el de AHORA
});

if (resultado.ok) {
  resultado.sujeto; // el usuario.id que se firmó
} else {
  resultado.motivo; // por qué no vale
}
```

#### `esUuid(valor: unknown): valor is string`

Valida un UUID canónico v1–v8 (o el UUID nulo). No dice que el id exista:
dice que se puede preguntar por él sin que Postgres tire
`invalid input syntax for type uuid`.

```ts
import { esUuid } from "@mafesoftware/seguridad";

esUuid("550e8400-e29b-41d4-a716-446655440000"); // true
esUuid("no-es-un-uuid"); // false
```

#### `unaDe(valor: unknown, opciones: readonly T[], porOmision: T): T`

El valor si está entre `opciones`, o `porOmision` si no. Para columnas `text`
con una lista cerrada que no tiene un `CHECK` del lado de la base.

```ts
import { unaDe } from "@mafesoftware/seguridad";

const ESTADOS = ["borrador", "publicado", "archivado"] as const;
unaDe(formData.get("estado"), ESTADOS, "borrador");
```

#### `ErrorSeguridad`

El único error que tira este paquete: `codigo` distingue el tipo de problema
sin parsear el mensaje —
`"clave_invalida" | "formato_invalido" | "autenticacion_fallida" | "secreto_invalido" | "pase_invalido" | "csp_invalida"`.
Ver `cifrar`/`descifrar`, `crearPase` y `politicaCsp` arriba/abajo.

### `/next` (`@mafesoftware/seguridad/next`)

Requiere `next >= 16` como peerDependency **opcional**: `autorizarCron`,
`cabecerasSeguridad`, `politicaCsp`/`generarNonce` e `ipDe` no tocan `next`
para nada y funcionan sin tenerlo instalado. Solo `guard()` lo necesita, y lo
carga con un `import()` dinámico DENTRO del `catch` (no al importar el
módulo) — así que ni siquiera `guard` rompe el `import` del subpath completo
si `next` no está; rompería recién al ATRAPAR un error, si de verdad hace
falta decidir si es un `redirect()`/`notFound()`.

#### `politicaCsp(nonce: string, extras?: ExtrasCsp): string`

La CSP completa, lista para el header `Content-Security-Policy`. `extras`
agrega fuentes a una directiva existente (o una directiva nueva) sin pisar la
base.

Tira `ErrorSeguridad` (`codigo: "csp_invalida"`) si `nonce` no tiene forma de
nonce (base64/base64url, con o sin relleno), si el nombre de una directiva de
`extras` no es `[a-z-]+`, o si una fuente contiene `;`, `,` o un espacio —
cualquiera de esos, sin validar, permitiría cerrar una directiva e INYECTAR
una nueva en el header.

```ts
import { politicaCsp } from "@mafesoftware/seguridad/next";

politicaCsp(nonce);
// "default-src 'self'; script-src 'self' 'nonce-...' 'strict-dynamic'; ..."

politicaCsp(nonce, { "style-src": ["https://fonts.googleapis.com"] });

politicaCsp("x'; script-src *; foo='"); // tira ErrorSeguridad (csp_invalida)
```

#### `generarNonce(): string`

Un nonce de request: 16 bytes al azar, en base64.

```ts
import { generarNonce } from "@mafesoftware/seguridad/next";

const nonce = generarNonce(); // distinto en cada request
```

#### `cabecerasSeguridad(opciones?: { hstsPreload?: boolean }): Record<string, string>`

Las cabeceras que no dependen del request: `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`,
`Strict-Transport-Security`. Por defecto, `Strict-Transport-Security` NO
lleva `preload` — es una decisión de una sola vía (entrar a la lista de
precarga hardcodeada en los navegadores) que cada app toma a propósito, no
algo que este paquete imponga; pasá `{ hstsPreload: true }` para agregarlo.

```ts
import { cabecerasSeguridad } from "@mafesoftware/seguridad/next";

for (const [nombre, valor] of Object.entries(cabecerasSeguridad())) {
  response.headers.set(nombre, valor);
}

cabecerasSeguridad({ hstsPreload: true })["Strict-Transport-Security"];
// "max-age=63072000; includeSubDomains; preload"
```

#### `autorizarCron(req: Request, secreto: string | undefined): boolean`

`Authorization: Bearer <secreto>`, en tiempo constante. **Falla cerrado**: si
`secreto` está vacío o `undefined` (typo en la config del cron, variable de
entorno que falta), devuelve `false` — nunca deja pasar por default.

```ts
import { autorizarCron } from "@mafesoftware/seguridad/next";

export async function GET(req: Request) {
  if (!autorizarCron(req, process.env.CRON_SECRET)) {
    return new Response("No autorizado", { status: 401 });
  }
  // ...
}
```

#### `guard(fn)`

Envuelve una server action.

- Si `fn` no devuelve nada, el resultado es `{ ok: true }`.
- Si `fn` devuelve un objeto PLANO, se mezcla en `{ ...resultado, ok: true }`
  — con `ok` puesto AL FINAL, para que un `resultado` que por accidente traiga
  su propia clave `ok` nunca pueda pisar el `true` real.
- Si `fn` devuelve un array o un primitivo (string, number, boolean, `null`),
  se envuelve como `{ ok: true, valor: resultado }` en vez de spreadearlo
  (spreadear un array da claves `"0"`, `"1"`, ...; spreadear un primitivo no
  da nada útil).
- `ErrorNegocio` se convierte en `{ ok: false, error, campo? }` — se detecta
  también entre COPIAS distintas del paquete (dos instalaciones de
  `@mafesoftware/seguridad` en el mismo `node_modules`, con clases que no son
  `instanceof` la una de la otra), vía una marca `Symbol.for(...)` además de
  `instanceof`.
- `redirect()`/`notFound()` de Next se vuelven a tirar tal cual (nunca se
  tragan); cualquier otro error (un bug) también se vuelve a tirar.

```ts
import { guard, ErrorNegocio } from "@mafesoftware/seguridad/next";

export const crearClienteAction = guard(async (form: FormData) => {
  const email = String(form.get("email") ?? "");
  if (!email) throw new ErrorNegocio("El email es obligatorio", "email");
  const cliente = await crearCliente(email);
  return { clienteId: cliente.id };
});
// éxito:  { ok: true, clienteId: "..." }
// fallo:  { ok: false, error: "El email es obligatorio", campo: "email" }
```

#### `ipDe(headers: Headers): string | null`

La IP de quien hace el request: primera de `x-forwarded-for` (si tiene forma
de IPv4/IPv6), si no `x-real-ip` (ídem), si no `null`.

**`x-forwarded-for` lo puede escribir el CLIENTE.** Si tu request no pasa por
un proxy/CDN que lo REESCRIBA desde cero en su borde (Vercel lo hace), un
cliente puede mandar `X-Forwarded-For: 1.2.3.4` a mano y `ipDe` devuelve
`"1.2.3.4"` sin que tenga nada que ver con su IP real — el header declara, no
autentica. `ipDe` valida que el resultado TENGA FORMA de IP (usa
`node:net`, así que no anda en el runtime Edge de Next, solo en el runtime
Node), lo cual frena basura obviamente inválida, pero no una IP falsa aunque
bien formada: no uses esto para autorizar nada, solo para logs/rate-limiting
best-effort.

```ts
import { ipDe } from "@mafesoftware/seguridad/next";

ipDe(request.headers); // "203.0.113.5" | "2001:db8::1" | null
```
