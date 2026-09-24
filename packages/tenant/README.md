# @mafesoftware/tenant

Resolución de tenant (organización) para los productos multi-tenant de MAFE
Software: qué slug pide un host, qué slugs no puede tomar una organización
nueva, de qué organización es una request cuando hay que cruzar host y
sesión, un contexto con `AsyncLocalStorage` para pasar el tenant sin
arrastrarlo por parámetro, y — en el subpath `/drizzle` — la FK compuesta que
hace que la BASE, no solo el código, rechace una fila hija que apunta al
padre de otra organización.

Centraliza lo que `club.ts` de gestionflow y `tenant.ts` de store360
reimplementaban cada uno con su propia variante (y sin la FK compuesta,
ninguno de los dos).

Parte de la familia de paquetes de MAFE Software: **puro** en el núcleo —
sin `process.env`, sin framework, sin base de datos; las búsquedas
(`resolverTenant`) entran por parámetro. Lo específico de Drizzle vive aparte,
en el subpath `/drizzle` (`drizzle-orm` como peerDependency opcional,
`>=0.45 <0.46`).

```bash
bun add @mafesoftware/tenant
```

La documentación de cada función está en `src/`, con el motivo de cada
decisión al lado. Los tests (`tests/`) son la otra mitad de la
documentación.

## API

### Núcleo (`@mafesoftware/tenant`)

#### `normalizarHost(host: string): string`

El host de una request, limpio: minúsculas, sin puerto, sin el punto final y
sin el `"www."` de adelante.

```ts
import { normalizarHost } from "@mafesoftware/tenant";

normalizarHost("WWW.Demo.MAFE.app:3300."); // "demo.mafe.app"
normalizarHost("[::1]:3000"); // "[::1]" (IPv6 entre corchetes: el puerto es lo de después del "]")
```

#### `validarDominioBase(dominioBase: string): string`

`dominioBase` normalizado igual que un host (mismas reglas de arriba — un
`dominioBase = "www.mafe.app"` se trata igual que `"mafe.app"`). Tira
`ErrorTenant` (`codigo: "dominio_base_invalido"`) si queda vacío después de
normalizar: es un error de PROGRAMACIÓN (la app no configuró su dominio), no
un host que mandó alguien. La usan `slugDeHost` y `resolverTenant`
internamente; se expone por si una app quiere validar su configuración al
arrancar.

```ts
import { validarDominioBase, ErrorTenant } from "@mafesoftware/tenant";

validarDominioBase("mafe.app"); // "mafe.app"
validarDominioBase(""); // tira ErrorTenant (codigo: "dominio_base_invalido")
```

#### `slugDeHost(host: string, dominioBase: string, reservados?: ReadonlySet<string>): string | null`

El slug de organización que pide `host` bajo `dominioBase`, o `null` si no es
un subdominio válido de una organización: la apex, un subdominio de más de
un nivel, un slug reservado, `*.vercel.app`, punycode (`xn--...`), o
cualquier etiqueta que no pase `validarSlug`. `reservados` es
`RESERVADOS` por defecto; se puede pasar una lista propia (más larga, en
cualquier combinación de mayúsculas/minúsculas — se normaliza sola). Tira
`ErrorTenant` si `dominioBase` es inválido (ver `validarDominioBase`).

```ts
import { slugDeHost } from "@mafesoftware/tenant";

slugDeHost("demo.mafe.app", "mafe.app"); // "demo"
slugDeHost("DEMO.MAFE.APP:443", "mafe.app"); // "demo" (mayúsculas y puerto no importan)
slugDeHost("mafe.app", "mafe.app"); // null (apex, no es ninguna organización)
slugDeHost("admin.mafe.app", "mafe.app"); // null (reservado)
slugDeHost("panel.demo.mafe.app", "mafe.app"); // null (dos niveles)
slugDeHost("preview-x1.vercel.app", "mafe.app"); // null
slugDeHost("demo.localhost:3300", "localhost"); // "demo" (para E2E sin DNS)
```

#### `RESERVADOS: ReadonlySet<string>`

Los slugs que ninguna organización puede tomar en ningún producto:
`www`, `app`, `admin`, `api`, `portal`, `plataforma`, `static`, `assets`,
`cdn`, `mail`, `smtp`, `imap`, `pop`, `ftp`, `ns`, `ns1`, `ns2`, `dev`,
`staging`, `test`, `demo-app`, `status`, `help`, `soporte`, `ayuda`, `blog`,
`docs`, `login`, `registro`, `ingresar`, `auth`, `oauth`, `cuenta`, `panel`,
`webhook`, `webhooks`, `cron`. Un producto puede necesitar más (nombres de
sus propias pantallas): pasale una lista más larga a `slugDeHost`/
`validarSlug`, esta es el piso común.

```ts
import { RESERVADOS } from "@mafesoftware/tenant";

RESERVADOS.has("admin"); // true

const propios = new Set([...RESERVADOS, "facturacion"]);
```

#### `validarSlug(s: string, reservados?: ReadonlySet<string>): { ok: true; slug: string } | { ok: false; motivo; sugerencia? }`

¿`s` sirve como slug de organización? Puro: no consulta si ya está tomado,
solo si tiene la FORMA correcta — 3 a 40 caracteres, `[a-z0-9-]`, sin guion
al principio/final, sin `--`, no reservado (case-insensitive) y solo ASCII.
`motivo` es uno de `"longitud" | "caracteres_invalidos" | "guion_borde" |
"guion_doble" | "reservado" | "no_ascii"`. `sugerencia` es un candidato
normalizado (minúsculas, sin acentos, separadores colapsados a un `"-"`)
cuando hay uno razonable — nunca para `"reservado"`.

```ts
import { validarSlug } from "@mafesoftware/tenant";

validarSlug("torres-del-parque"); // { ok: true, slug: "torres-del-parque" }
validarSlug("Admin"); // { ok: false, motivo: "reservado" }
validarSlug("-demo-"); // { ok: false, motivo: "guion_borde", sugerencia: "demo" }
validarSlug("a"); // { ok: false, motivo: "longitud" }
validarSlug("mi--tenant"); // { ok: false, motivo: "guion_doble", sugerencia: "mi-tenant" }
validarSlug("Construcción"); // { ok: false, motivo: "no_ascii", sugerencia: "construccion" }
validarSlug("Mi Constructora"); // { ok: false, motivo: "caracteres_invalidos", sugerencia: "mi-constructora" }
```

#### `resolverTenant(opciones: OpcionesResolverTenant): Promise<string | null>`

De qué organización es esta request, cruzando host y sesión. Recibe el host
CRUDO (`opciones.host`) y `dominioBase`; adentro llama a `slugDeHost` para
sacar el slug — nunca hace falta (ni conviene) normalizar el host a mano
antes de llamar. Las dos búsquedas (`buscarPorSlug`, `buscarPorSesion`) las
inyecta la app — este paquete no toca ninguna base.

- Host y sesión resuelven al MISMO id → esa organización.
- Resuelven a ids DISTINTOS → `null` (evita que la cookie de una
  organización sirva en la dirección de otra).
- Solo el host resuelve → la organización del host (páginas públicas).
- Solo la sesión resuelve (host apex/desconocido/ausente) → `null`. **Nunca
  hay una organización por defecto.**
- Ninguna resuelve → `null`.
- `dominioBase` inválido (vacío/en blanco) → tira `ErrorTenant`, siempre,
  incluso sin host (ver `validarDominioBase`).
- Si `buscarPorSlug`/`buscarPorSesion` tiran (la base no responde, por
  ejemplo), el error se propaga tal cual — **fail closed**, nunca se
  convierte en `null`.

```ts
import { resolverTenant } from "@mafesoftware/tenant";

const tenantId = await resolverTenant({
  // x-forwarded-host es el host real en Vercel/detrás de un proxy; host es
  // el respaldo para desarrollo local. Nunca lo parsees vos: slugDeHost ya
  // lo hace adentro.
  host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  dominioBase: "mafe.app",
  sesion: sesion?.user?.tenantId ?? null,
  buscarPorSlug: (slug) => db.tenantIdDeSlug(slug),
  buscarPorSesion: (id) => db.tenantIdSiExiste(id),
});
if (!tenantId) notFound();
```

#### `conTenant<T>(id: string, fn: () => Promise<T>): Promise<T>`

Corre `fn` con `id` como el tenant del contexto (`AsyncLocalStorage`) para
toda la cadena async que dispare. Pensado para callbacks que no corren
dentro de una request normal: un webhook que llega al dominio de la
plataforma y ya validó de qué organización es, un cron, un script de seed.

```ts
import { conTenant } from "@mafesoftware/tenant";

await conTenant(tenantIdValidado, async () => {
  await procesarWebhookDeMercadoPago(payload); // adentro, tenantDelContexto() === tenantIdValidado
});
```

#### `tenantDelContexto(): string | null`

El tenant del contexto actual, o `null` fuera de un `conTenant`. Nunca tira.

```ts
import { tenantDelContexto } from "@mafesoftware/tenant";

tenantDelContexto(); // null, o el id que puso el conTenant más cercano
```

#### `ErrorTenant`

El único error que tira este paquete (`slugDeHost`, `validarDominioBase`,
`resolverTenant` con un `dominioBase` inválido). `codigo` distingue el
motivo sin parsear el mensaje: hoy solo `"dominio_base_invalido"`.

```ts
import { ErrorTenant } from "@mafesoftware/tenant";

try {
  slugDeHost("demo.mafe.app", "");
} catch (error) {
  if (error instanceof ErrorTenant) error.codigo; // "dominio_base_invalido"
}
```

### `/drizzle` (`@mafesoftware/tenant/drizzle`)

Requiere `drizzle-orm >=0.45 <0.46` como peerDependency **opcional**. El
núcleo (`@mafesoftware/tenant`) no lo importa. Este paquete **no trae
migraciones**: cada app genera las suyas con drizzle-kit a partir de su
propio esquema. DDL de referencia (para consumidores sin Drizzle):
`sql/ejemplo.sql`.

#### `columnaTenant(nombre = "organizacion_id", tipo: "uuid" | "text" = "uuid")`

La columna de tenant de una tabla, `NOT NULL` siempre. El nombre y el tipo
son parámetros porque cada app nombra distinto su columna de tenant y
algunas todavía la tienen como `text` en vez de `uuid`.

```ts
import { pgTable, uuid, text } from "drizzle-orm/pg-core";
import { columnaTenant } from "@mafesoftware/tenant/drizzle";

export const proyectos = pgTable("proyectos", {
  id: uuid("id").primaryKey(),
  organizacionId: columnaTenant(), // uuid "organizacion_id" not null
  nombre: text("nombre").notNull(),
});
```

#### `unicoConTenant(t: { tenant: AnyPgColumn; id: AnyPgColumn })`

El índice único `(tenant, id)` que necesita toda tabla PADRE para que sus
hijas puedan referenciarla con `fkTenant` — Postgres exige que una FK apunte
a una clave (primary key o unique) de la tabla referenciada, y `(tenant,
id)` como PAR no es una por sí sola aunque `id` ya sea primary key.

```ts
import { pgTable, uuid, text } from "drizzle-orm/pg-core";
import { columnaTenant, unicoConTenant } from "@mafesoftware/tenant/drizzle";

export const proyectos = pgTable(
  "proyectos",
  {
    id: uuid("id").primaryKey(),
    organizacionId: columnaTenant(),
    nombre: text("nombre").notNull(),
  },
  (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
);
```

#### `fkTenant(opciones: OpcionesFkTenant)`

La FK compuesta `(tenant, padreId) → padre(tenant, id)` que hace que
Postgres RECHACE que una fila hija apunte al padre de OTRA organización
(spec 06 §3.1, regla 2) — una FK simple sobre `padreId` deja pasar
perfecto una fila con `tenant = B` que apunta a un padre de `tenant = A`.
Va en el `extraConfig` de la tabla hija. `onDelete`/`onUpdate` son
opcionales: `"no action"` por defecto (el mismo default de Postgres —
borrar el padre falla si tiene hijos, no los arrastra); `onDelete:
"cascade"` es un **opt-in** explícito para cuando sí querés que borrar el
padre borre sus hijos. `nombre` también es opcional: si no se pasa, se
arma uno corto y determinístico (`${tablaHija}_${columnaPadre}_tenant_fk`,
truncado con hash si aun así supera los 63 caracteres que permite
Postgres) — no el que arma drizzle solo, que concatena tabla + ambas
columnas + tabla padre + ambas columnas padre y fácilmente pasa el
límite.

Ejemplo completo, padre `proyectos` + hija `unidades`:

```ts
import { pgTable, uuid, text } from "drizzle-orm/pg-core";
import { columnaTenant, unicoConTenant, fkTenant } from "@mafesoftware/tenant/drizzle";

export const proyectos = pgTable(
  "proyectos",
  {
    id: uuid("id").primaryKey(),
    organizacionId: columnaTenant(),
    nombre: text("nombre").notNull(),
  },
  (t) => [unicoConTenant({ tenant: t.organizacionId, id: t.id })],
);

export const unidades = pgTable(
  "unidades",
  {
    id: uuid("id").primaryKey(),
    organizacionId: columnaTenant(),
    proyectoId: uuid("proyecto_id").notNull(),
    nombre: text("nombre").notNull(),
  },
  (t) => [
    fkTenant({
      columnas: { tenant: t.organizacionId, padreId: t.proyectoId },
      columnasPadre: { tenant: proyectos.organizacionId, id: proyectos.id },
      // Sin onDelete: default "no action" — borrar un proyecto con
      // unidades falla, no las arrastra. Para cascada explícita:
      // onDelete: "cascade".
    }),
  ],
);

// insert into unidades (organizacion_id, proyecto_id, ...)
// values ('<org B>', '<id de un proyecto de org A>', ...)
// -> falla: foreign_key_violation (código 23503)
```

## Postgres para los tests de `/drizzle`

`tests/drizzle/postgres.test.ts` prueba la FK compuesta contra un Postgres
real (no hay mock que valga para un `foreign_key_violation`). El DDL que
ejecuta no está escrito a mano: sale del MISMO esquema de Drizzle que arma
`columnaTenant`/`unicoConTenant`/`fkTenant` (`tests/drizzle/esquema.ts`),
generado con `drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`)
— así el test ejercita de verdad lo que este paquete produce, no una
reimplementación paralela que podría desincronizarse.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, ese archivo FALLA con un
mensaje que lo dice (no se saltea en silencio; la conexión la arma
`poolDePrueba()`, `tests/lib/postgres-de-prueba.ts` en la raíz, compartido
con `packages/numeradores`). `tests/drizzle/config.test.ts`
(la verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye solo
`postgres.test.ts` — el resto de `/drizzle` y de los tests del paquete
corren igual.
