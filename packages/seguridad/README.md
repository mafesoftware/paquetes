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
`false` si difieren en largo, sin tirar.

```ts
import { compararEnTiempoConstante } from "@mafesoftware/seguridad";

compararEnTiempoConstante(tokenRecibido, tokenGuardado); // true | false
```

#### `cifrar(textoPlano: string, clave: Clave): string`

Cifra con AES-256-GCM. `clave` es un string en base64 (32 bytes, como lo
devuelve `openssl rand -base64 32`) o un `Uint8Array` ya decodificado.
Devuelve `"v1:<iv>:<tag>:<datos>"`, todo en base64 — **el mismo formato que
`fiscalCifrado.ts` de store360**, así que migrar es pasarle la misma clave de
32 bytes, sin volver a cifrar nada. Tira `ErrorSeguridad` (`codigo:
"clave_invalida"`) si la clave no tiene 32 bytes.

```ts
import { cifrar } from "@mafesoftware/seguridad";

const clave = process.env.CIFRADO_CLAVE!; // 32 bytes en base64, decidido por la app
cifrar("certificado o token a guardar"); // ❌ falta la clave
cifrar("certificado o token a guardar", clave);
// "v1:qk3F.../base64-iv:.../base64-tag:.../base64-datos"
```

#### `descifrar(guardado: string, clave: Clave): string`

La inversa de `cifrar`. Tira `ErrorSeguridad`:

- `codigo: "formato_invalido"` — no tiene el formato `v1:<iv>:<tag>:<datos>`,
  o el prefijo no es `"v1"`.
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

```ts
import { crearPase } from "@mafesoftware/seguridad";

const token = crearPase(
  {
    proposito: "reset-password",
    sujeto: usuario.id,
    venceEn: Date.now() + 30 * 60_000, // media hora
    sello: selloDePassword(usuario.passwordHash), // lo deriva la app
  },
  process.env.AUTH_SECRET!,
);
// "<payload base64url>.<firma base64url>" — esto va en el link del mail
```

#### `verificarPase(token, secreto, opciones): ResultadoPase`

**Nunca tira**: `{ ok: true, sujeto }` o `{ ok: false, motivo }`, con
`motivo` en `"formato" | "firma" | "vencido" | "proposito" | "sello"`.
`selloActual` se recalcula del estado ACTUAL (hay que leerlo de la base
antes de llamar): si no coincide con el que se firmó, el pase murió aunque
no haya vencido — por ejemplo, porque la contraseña ya se cambió.

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

El único error que tira este paquete: `codigo` distingue una clave mal
configurada de un dato alterado, sin parsear el mensaje. Ver `cifrar` /
`descifrar` arriba.

### `/next` (`@mafesoftware/seguridad/next`)

Requiere `next >= 16` como peerDependency (opcional: si el paquete no se usa,
`next` no hace falta instalado).

#### `politicaCsp(nonce: string, extras?: ExtrasCsp): string`

La CSP completa, lista para el header `Content-Security-Policy`. `extras`
agrega fuentes a una directiva existente (o una directiva nueva) sin pisar la
base.

```ts
import { politicaCsp } from "@mafesoftware/seguridad/next";

politicaCsp(nonce);
// "default-src 'self'; script-src 'self' 'nonce-...' 'strict-dynamic'; ..."

politicaCsp(nonce, { "style-src": ["https://fonts.googleapis.com"] });
```

#### `generarNonce(): string`

Un nonce de request: 16 bytes al azar, en base64.

```ts
import { generarNonce } from "@mafesoftware/seguridad/next";

const nonce = generarNonce(); // distinto en cada request
```

#### `cabecerasSeguridad(): Record<string, string>`

Las cabeceras que no dependen del request: `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`,
`Strict-Transport-Security`.

```ts
import { cabecerasSeguridad } from "@mafesoftware/seguridad/next";

for (const [nombre, valor] of Object.entries(cabecerasSeguridad())) {
  response.headers.set(nombre, valor);
}
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

Envuelve una server action. `ErrorNegocio` se convierte en
`{ ok: false, error, campo? }`; el éxito se mezcla en `{ ok: true, ...resultado }`;
`redirect()`/`notFound()` de Next se vuelven a tirar tal cual (nunca se
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

La IP de quien hace el request: primera de `x-forwarded-for`, si no
`x-real-ip`, si no `null`. Recortada de espacios.

```ts
import { ipDe } from "@mafesoftware/seguridad/next";

ipDe(request.headers); // "203.0.113.5" | null
```
