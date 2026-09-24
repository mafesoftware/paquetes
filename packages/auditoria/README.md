# @mafesoftware/auditoria

Registro de auditoría inmutable y por tenant para los productos SaaS de MAFE
Software: qué cambió (diff de antes/después), quién, cuándo, con campos
sensibles redactados. Un trigger de Postgres bloquea `UPDATE`/`DELETE`/
`TRUNCATE` sobre la tabla: una vez escrita, una fila de auditoría no se
puede tocar ni desde un bug ni desde una consola de soporte.

Referencias que este paquete junta y mejora:

- store360 (`src/lib/auditoria.ts`): guardaba solo los campos que
  cambiaron, no la fila entera — buena idea, pero sin redacción y sin
  inmutabilidad a nivel de base (cualquiera con acceso de soporte podía
  `UPDATE`/`DELETE` sobre la tabla).
- ediflow (`src/lib/audit/log.ts`, `writeAudit`): nunca tira (`try/catch` +
  `console.error`), basado en `DbClient` — pero un `INSERT` que falla
  ADENTRO de una transacción deja esa transacción entera abortada, así que
  "nunca tira" no alcanzaba para que el resto del flujo de negocio
  sobreviviera. `auditar` de este paquete resuelve eso con un `SAVEPOINT`
  (ver su sección más abajo).

Núcleo **puro**: sin variables de entorno, sin framework, sin base de
datos. Lo específico de Drizzle (la tabla, el trigger de inmutabilidad, y
las funciones que escriben/leen) vive en el subpath `/drizzle`
(`drizzle-orm` como peerDependency opcional, `>=0.45 <0.46`), y usa
`@mafesoftware/tenant/drizzle` para la columna de tenant.

**Decisiones propias respecto al brief de la tarea** (revisadas y
aceptadas): el brief pedía `usuarioId` como filtro de `listarAuditoria`;
esta implementación usa `actorId` — consistente con que quien audita no
siempre es un usuario humano (`actor.tipo` puede ser `"sistema"`,
`"portal"` o `"plataforma"`, ver `tablaAuditoria`). Y `auditar`/
`listarAuditoria` reciben la tabla como segundo parámetro explícito
(`auditar(dbOTx, tabla, entrada)`, no `auditar(dbOTx, entrada)`) — igual
que `siguienteNumero`/`configurarNumerador` de
`@mafesoftware/numeradores/drizzle`, necesario para que las funciones
operen sobre CUALQUIER tabla que arme `tablaAuditoria` (nombre/columna de
tenant propios).

```bash
bun add @mafesoftware/auditoria
```

La documentación de cada función está en `src/`, con el motivo de cada
decisión al lado. Los tests (`tests/`) son la otra mitad de la
documentación — en particular `tests/drizzle/postgres*.test.ts`, que
prueban el trigger de inmutabilidad y las garantías de `auditar` contra
Postgres real.

## API

### Núcleo (`@mafesoftware/auditoria`)

#### `loQueCambio(antes: unknown, despues: unknown): { campo: string; antes: unknown; despues: unknown }[]`

El diff entre `antes` y `despues`: un `{ campo, antes, despues }` por cada
diferencia, **ordenado por `campo`** (determinístico). Recorre objetos
PLANOS recursivamente y arma la ruta de cada campo anidado con puntos
(`"direccion.calle"`); un objeto no plano (arreglo, `Date`, instancia de
una clase propia, `Map`, `Set`, ...) se compara ENTERO, nunca campo a
campo.

**Los arreglos se comparan como valor entero, no elemento a elemento** — un
arreglo no tiene una identidad de posición estable (reordenar, insertar en
el medio, sacar un elemento mueve los índices de los que quedan), así que
diffear por índice produciría "cambios" que no reflejan ninguna edición
real.

`bigint` se compara por valor; `Date` por `getTime()` (dos instancias
distintas del mismo instante son iguales); una clave agregada o quitada se
ve como su valor pasando desde/hacia `undefined`.

**Un lado ausente (`undefined` O `null`) contra un objeto plano del otro
lado se expande CAMPO A CAMPO**, no como un solo cambio con el objeto
entero — el caso típico de auditar una entidad recién CREADA (`antes`
ausente) o BORRADA (`despues` ausente); `null` cuenta igual que `undefined`
para esto (algunas apps pasan `antes: null` en vez de `antes: undefined`
al crear, las dos dan el mismo resultado). Esto **no** cambia que `null` y
`undefined` sigan siendo valores DISTINTOS entre sí en una comparación
DIRECTA: una clave con `null` explícito contra la misma clave ausente en
el otro lado sigue siendo un cambio (`antes: null, despues: undefined`).

**Nunca tira, con ningún dato.** Un nodo que no se puede inspeccionar — un
`Proxy` revocado o con la trampa `getPrototypeOf` rota, un objeto cuyas
claves no se pueden enumerar (`ownKeys` que tira), una propiedad cuyo getter
tira — queda como `"[error]"` en su lugar del diff. Si comparar dos hojas
(dos arreglos, por ejemplo) tira en algún punto, se consideran distintas y
el cambio se reporta: nunca se esconde.

**`loQueCambio(x, x)` da `[]`, nunca `"[ciclo]"`**, aunque `x` sea
autoreferencial (`x.self = x`): los dos lados son literalmente el mismo
valor, así que no hay ninguna diferencia que reportar. Dos objetos
autoreferenciales DISTINTOS (`objA !== objB`, cada uno con su propio ciclo)
sí se reportan como `"[ciclo]"` en la rama que no se puede resolver sin
recursión infinita — el corte de arriba es solo para la MISMA referencia.

```ts
import { loQueCambio } from "@mafesoftware/auditoria";

loQueCambio(
  { nombre: "Ana", direccion: { calle: "Corrientes 1", ciudad: "CABA" } },
  { nombre: "Ana", direccion: { calle: "Corrientes 2", ciudad: "CABA" } },
);
// [{ campo: "direccion.calle", antes: "Corrientes 1", despues: "Corrientes 2" }]

loQueCambio({ tags: ["a", "b"] }, { tags: ["a", "c"] });
// [{ campo: "tags", antes: ["a", "b"], despues: ["a", "c"] }] (arreglo entero, no por índice)

loQueCambio(undefined, { nombre: "Silla", precio: 100 });
// [{ campo: "nombre", antes: undefined, despues: "Silla" }, { campo: "precio", antes: undefined, despues: 100 }]
// (entidad recién creada: "antes" ausente se expande campo a campo; null se comporta igual)

loQueCambio(undefined, undefined); // []

const x: any = { a: 1 }; x.self = x;
loQueCambio(x, x); // [] (misma referencia: sin diferencia posible, aunque x sea autoreferencial)

loQueCambio({ get a() { throw new Error("roto"); } }, { a: 1 });
// [{ campo: "a", antes: "[error]", despues: 1 }] (nunca tira)
```

#### `redactar(obj, camposSensibles = CAMPOS_SENSIBLES_POR_DEFECTO)`

Una copia profunda de `obj` donde cualquier CLAVE SENSIBLE queda
reemplazada por `"[redactado]"`, a cualquier profundidad, adentro de
arreglos, `Map`s, `Set`s e instancias de clases propias incluido.

**Regla de matching: IGUAL o TERMINA CON un término de la lista (no
"contiene")**, sobre el nombre normalizado (minúsculas, sin `_`/`-`):

| Clave | ¿Se redacta? | Por qué |
|---|---|---|
| `passwordHash` / `password_hash` | Sí | normaliza a `"passwordhash"`, TERMINA en `"hash"` |
| `accessToken` / `refresh_token` | Sí | termina en `"token"` |
| `clientSecret` | Sí | termina en `"secret"` |
| `x-api-key` | Sí | normaliza a `"xapikey"`, termina en `"apikey"` |
| `passwordHint` | **No** | `"password"` es un PREFIJO ahí, no un sufijo |
| `tokenizer` | **No** | no termina en `"token"` (queda al principio) |

Un `"contiene"` en vez de `"termina con"` hubiera tapado por error
`passwordHint`/`tokenizer`.

**Límite documentado**: es matching por NOMBRE DE CLAVE, no por valor — un
secreto guardado bajo una clave NO sensible (ej. `{ notas: "la clave
temporal es Xy9$zK" }`, donde la clave es `"notas"`, no `"clave"`) **no se
detecta**. `redactar` nunca mira el contenido de un string.

**Dos límites más de la regla "termina con"**:
- **Un plural arbitrario no matchea su singular**: `"misPasswords"` NO
  termina en `"password"` — termina en `"passwords"` (con la "s"), un
  sufijo DISTINTO. Por eso la lista default incluye `"passwords"`,
  `"tokens"` y `"secrets"` como términos PROPIOS (no derivados
  automáticamente); un plural que no esté en la lista (`"apiKeys"`,
  `"secretos"` en inglés informal, ...) sigue sin matchear a menos que se
  agregue a mano en `camposSensibles`.
- **La clave de un `Map` queda como TEXTO en el resultado, sin mirar su
  CONTENIDO**: solo el NOMBRE de la clave decide si el valor de esa entrada
  se tapa (igual que con la clave de un objeto). Si una app usa un secreto
  COMO CLAVE de un `Map` (`new Map([[apiKeySecret, metadata]])`, en vez de
  `{ apiKey: secreto }`), ese secreto sale intacto en el resultado (como
  nombre de propiedad, y como segmento de la ruta en `cambios`) — no
  uses un valor sensible como clave de un `Map` que vaya a pasar por
  `redactar`/`serializarParaAuditoria`.

**Tipos especiales** (mismo tratamiento y mismo ORDEN que
`serializarParaAuditoria`, ver más abajo — el orden importa: `URL` tiene su
propio `toJSON` que devuelve el `href` COMPLETO con query/hash, así que se
resuelve ANTES del chequeo genérico de `toJSON`):

| Tipo | Resultado |
|---|---|
| `Buffer`/`TypedArray`/`ArrayBuffer`/`DataView` | `"[binario N bytes]"` (nunca el contenido) |
| `Date` | ISO string (`"[fecha-invalida]"` si es inválida) |
| `RegExp` | `String(re)`, ej. `"/abc/gi"` |
| `URL` | `origin` + `pathname`, SIN `search` ni `hash` (pueden traer secretos: `?token=...`, `#access_token=...`) |
| `Error` | `{ name }` únicamente — nunca `.message` (puede traer el valor que causó el error) |
| cualquier otro objeto con `toJSON` propio | se llama (atrapa una excepción → `"[error]"`) y el resultado se redacta recursivamente |
| `Map` | **objeto plano** con la clave como texto. Si dos claves distintas dan el mismo texto (el número `1` y el string `"1"`, o un objeto cuyo `toString` da `"password"`), la que llegó después (orden de inserción) lleva un sufijo `" (2)"`, `" (3)"`…: ninguna entrada se pierde. Una entrada cuya clave (como texto, sin sufijo) es sensible tiene su VALOR redactado. Como es un objeto, en `cambios` la clave del `Map` es un segmento más de la ruta (`"m.password"`) y la redacción por ruta la cubre. Un `Map` cuya iteración tira (un `Proxy` sobre un `Map`, una subclase con `entries()` roto) queda `"[error]"` |
| `Set` | arreglo (`"[error]"` si su iteración tira) |

**`redactar` convierte `Date` a un ISO string, no a una copia de `Date`.**
Es un cambio deliberado (no un descuido): antes, `redactar` clonaba la
`Date` (`new Date(valor.getTime())`) y `serializarParaAuditoria` la
convertía a ISO por separado — dos comportamientos distintos para el mismo
tipo, en dos funciones pensadas para usarse juntas (`serializarParaAuditoria(redactar(x))`,
como hace `auditar`). Ahora las dos dan el MISMO resultado para una
`Date`, en el mismo paso — si tu código usaba `redactar` solo (sin pasar
el resultado por `serializarParaAuditoria` después) y esperaba recibir de
vuelta un objeto `Date`, este es un cambio de comportamiento a tener en
cuenta.

Nunca tira: una referencia circular queda como `"[ciclo]"`, una clave cuyo
`get` tira queda como `"[error]"`, una clave de `Map` cuyo `toString` tira
(o un objeto sin prototipo como clave) queda como `"[clave]"`, y un objeto
cuyas claves no se pueden enumerar (un `Proxy` con una trampa `ownKeys` que
tira) queda como `"[error]"` entero.

```ts
import { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";

redactar({ usuario: "ana", contrasena: "hunter2" });
// { usuario: "ana", contrasena: "[redactado]" }

redactar({ pago: { datos: { cbu: "0000003100010000000001", monto: 100 } } });
// { pago: { datos: { cbu: "[redactado]", monto: 100 } } }

redactar({ passwordHash: "h1", accessToken: "t1", "x-api-key": "k1" });
// { passwordHash: "[redactado]", accessToken: "[redactado]", "x-api-key": "[redactado]" }

redactar({ passwordHint: "el nombre de tu mascota" });
// { passwordHint: "el nombre de tu mascota" } (NO se toca: "password" es prefijo, no sufijo)

redactar({ token: "t1", extra: "visible" }, ["token"]); // lista propia
// { token: "[redactado]", extra: "visible" }

class Usuario { constructor(public nombre: string, public password: string) {} }
redactar(new Usuario("ana", "hunter2"));
// { nombre: "ana", password: "[redactado]" } (instancia de clase: se redactan sus campos propios)

redactar(new URL("https://api.com/perfil?token=SECRETO#frag"));
// "https://api.com/perfil" (sin "?token=SECRETO" ni "#frag")

redactar(new Map<unknown, string>([[1, "hunter2"], ["1", "x"], ["contrasena", "hunter3"]]));
// { "1": "hunter2", "1 (2)": "x", contrasena: "[redactado]" } (objeto; la clave repetida como texto lleva sufijo)

redactar({ passwords: ["hunter2", "hunter3"], tokens: ["t1"], secrets: ["s1"] });
// { passwords: "[redactado]", tokens: "[redactado]", secrets: "[redactado]" } (plurales EXPLÍCITOS en la lista default)
```

#### `CAMPOS_SENSIBLES_POR_DEFECTO: readonly string[]`

La lista default de nombres de campo que tapa `redactar`/`auditar`:

```ts
import { CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";

CAMPOS_SENSIBLES_POR_DEFECTO;
// ["contrasena", "password", "passwords", "hash", "token", "tokens", "secreto", "secret", "secrets", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
```

#### `serializarParaAuditoria(v: unknown): unknown`

Deja `v` listo para `jsonb`: **nunca tira**, ni siquiera con una clave cuyo
`get` tira (queda como `"[error]"`) o cuyas claves no se pueden enumerar (un
`Proxy` con `ownKeys` roto → `"[error]"` entero). `bigint` se convierte a un
STRING con sufijo `"n"` (`123n` → `"123n"` — JSON no tiene tipo `bigint` y
`JSON.stringify(123n)` tira directo); `undefined` se descarta (la clave
desaparece de un objeto; adentro de un arreglo se convierte a `null`, no se
saca el índice). Una referencia circular queda como `"[ciclo]"`, sin
recursión infinita.

**Tipos especiales** (mismo tratamiento y mismo orden que `redactar`, ver
su sección más arriba): `Buffer`/`TypedArray`/`ArrayBuffer`/`DataView` →
`"[binario N bytes]"`; `Date` → ISO string (`"[fecha-invalida]"` si es
inválida); `RegExp` → `String(re)`; `URL` → `origin` + `pathname` (sin
`search` ni `hash`); `Error` → `{ name }` únicamente; cualquier otro objeto
con `toJSON` propio se llama y su resultado se serializa recursivamente;
`Map` se convierte a un objeto plano con la clave como texto (dos claves
que dan el mismo texto se desambiguan con `" (2)"`, `" (3)"`…, en orden de
inserción); `Set` a un arreglo (un `Map`/`Set` cuya iteración tira queda
`"[error]"`); cualquier otro objeto — plano o
instancia de clase propia — se recorre por sus campos propios enumerables.

```ts
import { serializarParaAuditoria } from "@mafesoftware/auditoria";

serializarParaAuditoria({ saldo: 123n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined });
// { saldo: "123n", vence: "2026-01-01T00:00:00.000Z" } (sin "nota")

serializarParaAuditoria([1n, undefined, 3n]);
// ["1n", null, "3n"]

serializarParaAuditoria(new Map([["a", 1n]]));
// { a: "1n" }

serializarParaAuditoria(new URL("https://api.com/x?token=SECRETO"));
// "https://api.com/x"

serializarParaAuditoria(new Error("mensaje que puede tener datos"));
// { name: "Error" } (nunca .message)
```

#### `normalizarParaDiff(v: unknown): unknown`

Convierte `v` a datos planos tipo JSON — **para comparar, no para guardar**:
a diferencia de `serializarParaAuditoria`, **nunca redacta nada** (una clave
`"password"` queda con su valor real). Usa las MISMAS reglas de tipos
especiales que `serializarParaAuditoria` (mismo módulo compartido
`tipos-especiales.ts`, mismo orden): `Buffer`/`TypedArray`/`ArrayBuffer`/
`DataView` → `"[binario N bytes]"`; `Date` → ISO string; `RegExp` →
`String(re)`; `URL` → `origin` + `pathname`; `Error` → `{ name }`; cualquier
objeto con `toJSON` propio (**instancia de clase O plano** — a diferencia de
un `JSON.stringify` nativo, que solo llama `toJSON` en objetos que lo
definen, esto también cubre un objeto LITERAL con un `toJSON` propio) → su
resultado, normalizado recursivamente; `Map` → objeto plano (mismas claves,
con el mismo sufijo de colisión, que `redactar`/`serializarParaAuditoria`);
`Set` → arreglo; `bigint` → string con sufijo `"n"`; cualquier otra instancia de
clase se recorre por sus campos propios enumerables. `null`/`undefined` se
preservan tal cual en cualquier posición (nunca se convierten a otra cosa),
justamente para no romper el manejo de "lado ausente" de `loQueCambio`.
**Nunca tira** — un dato roto (getter que tira, `Proxy` con trampas rotas,
`toJSON` que tira) da `"[error]"` en ese nodo, nunca propaga la excepción.

**Por qué existe.** `auditar` corría `loQueCambio` directo sobre los valores
CRUDOS de `entrada.antes`/`entrada.despues`. Dos instancias EQUIVALENTES
pero no idénticas — dos `Decimal` separados con el mismo `toJSON()`, dos
`Map`/`URL`/instancias de clase con el mismo contenido pero construidos por
separado (típico al leer una fila de la base y volver a construir el objeto
"nuevo" antes de guardar) — no son `===` ni tienen la misma forma interna,
así que `loQueCambio` las reportaba como CAMBIADAS aunque el dato
semánticamente fuera el mismo: una regresión de una ronda anterior, donde
`cambios` incluía entradas falsas. La solución es normalizar los DOS lados a
la misma forma plana ANTES de diffear (`loQueCambio(normalizarParaDiff(antes),
normalizarParaDiff(despues))`) y recién DESPUÉS redactar el resultado con
`redactarCambios` (ver más abajo; NUNCA con `redactar`, que no mira la ruta) — la
normalización nunca esconde un cambio real, porque compara el mismo tipo de
dato que terminará guardado (vía `serializarParaAuditoria`), solo evita
comparar por REFERENCIA lo que hay que comparar por VALOR.

```ts
import { normalizarParaDiff } from "@mafesoftware/auditoria";

class Decimal {
  constructor(private texto: string) {}
  toJSON() { return this.texto; }
}
normalizarParaDiff(new Decimal("12.50")); // "12.50"

// Un objeto PLANO con toJSON propio también lo usa (no solo instancias de clase):
normalizarParaDiff({ dni: "20111111119", toJSON: () => ({ dniEnmascarado: "***1119" }) });
// { dniEnmascarado: "***1119" }

// A diferencia de redactar/serializarParaAuditoria: nunca tapa nada.
normalizarParaDiff({ password: "hunter2" }); // { password: "hunter2" }

normalizarParaDiff(new Map([["a", 1n]])); // { a: "1n" }
```

> **Nunca guardes ni loguees lo que devuelve `normalizarParaDiff`** (ni lo
> que devuelve `loQueCambio` sobre eso): no redacta nada, así que una
> contraseña, un token o un CBU salen en claro. Es solo un paso intermedio
> para diffear. Lo que se guarda es el resultado de `redactarCambios` (y,
> para las fotos completas, `serializarParaAuditoria(redactar(...))` de los
> valores originales).

#### `redactarCambios(cambios, camposSensibles = CAMPOS_SENSIBLES_POR_DEFECTO): CambioAuditoria[]`

Redacta el resultado de `loQueCambio`. Es la MISMA función que usa `auditar`
por dentro; está en el núcleo (sin base de datos) para que una app que arma
su propio registro haga el pipeline a mano **en este orden**:

```ts
import { loQueCambio, normalizarParaDiff, redactarCambios } from "@mafesoftware/auditoria";

// 1) normalizar los dos lados  2) diffear  3) redactar el diff — recién eso se guarda/loguea
const cambios = redactarCambios(loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues)));
```

`redactar` no sirve para este paso: en un cambio el nombre del campo
sensible es el VALOR de `campo` (`{ campo: "token.access", ... }`), no una
clave. `redactarCambios` mira **cada segmento** de la ruta: si alguno es
sensible (`"token"` en `"token.access"`), cada lado DEFINIDO pasa a
`"[redactado]"` — el valor nunca se ve, pero queda registrado QUE cambió —
y un lado `undefined` (alta/baja) queda `undefined`. Un segmento con el
sufijo de colisión de un `Map` (`"password (2)"`) se evalúa también sin el
sufijo. Si ningún segmento es sensible, cada lado pasa por `redactar` (un
arreglo cambiado entero puede tener una clave sensible adentro).

```ts
redactarCambios([
  { campo: "m.password", antes: "A", despues: "B" },
  { campo: "nombre", antes: "Ana", despues: "Beto" },
  { campo: "usuarios", antes: [{ password: "x" }], despues: [] },
]);
// [
//   { campo: "m.password", antes: "[redactado]", despues: "[redactado]" },
//   { campo: "nombre", antes: "Ana", despues: "Beto" },
//   { campo: "usuarios", antes: [{ password: "[redactado]" }], despues: [] },
// ]
```

### `/drizzle` (`@mafesoftware/auditoria/drizzle`)

Requiere `drizzle-orm >=0.45 <0.46` como peerDependency **opcional**. El
núcleo (`@mafesoftware/auditoria`) no lo importa. Este paquete **no trae
migraciones**: cada app genera las suyas con drizzle-kit a partir de su
propio esquema, que usa `tablaAuditoria`, y agrega el resultado de
`sqlInmutabilidad` como una migración escrita A MANO aparte.

#### `tablaAuditoria(opciones?: { tenant?: { columna?: string; tipo?: "uuid" | "text" }; nombre?: string; columnasExtra?: Record<string, PgColumnBuilderBase> })`

La tabla de auditoría: `id` (uuid, PK), la columna de tenant
(`columnaTenant` de `@mafesoftware/tenant/drizzle`), `entidad`/
`entidad_id`/`accion` (`text`, NOT NULL), `actor_tipo` (`"usuario" |
"sistema" | "portal" | "plataforma"`), `actor_id` (nullable),
`antes`/`despues` (`jsonb`, nullable), `cambios` (`jsonb`, NOT NULL —
`[]` si no hubo `antes` ni `despues`), `ip`/`user_agent` (nullable),
`creado_en` (`timestamptz`, `defaultNow()`). Índices (NO únicos): `(tenant,
entidad, entidad_id, creado_en)` y `(tenant, creado_en)`.

Valida `nombre` con el MISMO patrón (`^[a-z_][a-z0-9_]*$`) y el mismo tope
de largo (40 caracteres) que `sqlInmutabilidad` — TIRA si no pasa — así una
tabla que esta función deja crear siempre puede recibir después el trigger
de inmutabilidad.

```ts
import { tablaAuditoria } from "@mafesoftware/auditoria/drizzle";

// Con los defaults: tabla "auditoria", columna de tenant "organizacion_id" (uuid).
export const auditoria = tablaAuditoria();

// Columna de tenant propia y otro nombre de tabla:
export const auditoriaDeFacturacion = tablaAuditoria({
  tenant: { columna: "club_id", tipo: "text" },
  nombre: "auditoria_facturacion",
});
```

#### `sqlInmutabilidad(nombreTabla: string): string`

El SQL (función `plpgsql` + triggers) que hace INMUTABLE la tabla
`nombreTabla`: `UPDATE`, `DELETE` y `TRUNCATE` fallan con `RAISE EXCEPTION`
y un mensaje claro. **No es una migración de drizzle-kit** (que no sabe
generar triggers): se agrega como una migración escrita A MANO, después de
la que generó drizzle-kit para la tabla. Idempotente (`CREATE OR REPLACE
FUNCTION`, `DROP TRIGGER IF EXISTS` antes de cada `CREATE TRIGGER`). Valida
`nombreTabla` contra `^[a-z_][a-z0-9_]*$` y TIRA si no matchea, porque se
interpola directo en el DDL (no hay placeholder posible para un nombre de
tabla/función/trigger); también tira si `nombreTabla` supera los 40
caracteres, para que los identificadores derivados (función/triggers, hasta
20 caracteres extra) queden bajo el límite de 63 de Postgres.

**Esto frena errores de la APP, no al dueño de la base — no es una barrera
de seguridad.** Cualquiera de estos lo saltea, con los privilegios
correspondientes:

- `SET session_replication_role = replica;` desactiva TODOS los triggers
  normales de la sesión.
- El DUEÑO de la tabla (o un superusuario) puede `ALTER TABLE ... DISABLE
  TRIGGER ALL`, hacer el `UPDATE`/`DELETE`, y volver a habilitarlo.
- `DROP TABLE` se lleva el trigger puesto.
- Un superusuario de Postgres puede, en general, saltear cualquier
  restricción a nivel de base.

**Recomendación**: el rol con el que corre la APP no debería ser el DUEÑO
de la tabla de auditoría (si lo es, `DISABLE TRIGGER` queda a un `ALTER
TABLE` de distancia del mismo rol, y el trigger deja de proteger ni
siquiera contra un bug de la propia app). Crear la tabla con un rol de
migraciones separado, y dar al rol de la app solo `SELECT`/`INSERT` a nivel
de permisos de Postgres (independiente de este trigger, y más fuerte: un
permiso denegado no se "desactiva" desde una sesión que no lo tiene).

```ts
import { sqlInmutabilidad } from "@mafesoftware/auditoria/drizzle";

// En una migración a mano, después de la que generó drizzle-kit:
const migracion = sqlInmutabilidad("auditoria");
// corrida contra Postgres: UPDATE/DELETE/TRUNCATE sobre "auditoria" ahora tiran
// error: La tabla "auditoria" es de solo lectura (auditoría inmutable): no se permite UPDATE en esta tabla.

sqlInmutabilidad("Auditoria; DROP TABLE x --"); // tira: nombre inválido
sqlInmutabilidad("a".repeat(41)); // tira: nombre demasiado largo
```

#### `auditar(dbOTx, tabla: TablaAuditoria, entrada): Promise<{ ok: true; id: string } | { ok: false; error: ErrorAuditoria }>`

`ErrorAuditoria` es `{ codigo: string | null; mensaje: string }`.

Calcula `cambios` con `loQueCambio` sobre `entrada.antes`/`entrada.despues`
**normalizados** con `normalizarParaDiff` (no los valores crudos — ver la
sección de `normalizarParaDiff` más arriba: evita reportar como "cambiado"
un campo cuyo valor es semánticamente el mismo pero llegó en una instancia
distinta, p. ej. dos `Decimal`/`Map`/instancias de clase equivalentes),
redacta `antes`/`despues` (los valores CRUDOS, no los normalizados) y
`cambios`, serializa los tres, e inserta.

**Cómo se evita que un secreto (cambiado o no) llegue a `cambios`.**
`cambios` se calcula sobre los valores CRUDOS — no sobre versiones ya
redactadas — y recién DESPUÉS se redacta el resultado, mirando CUALQUIER
segmento de la ruta con puntos (`"token.access"` → `["token", "access"]`),
no solo el último. Si algún segmento es sensible (`"token"` lo es, aunque
`"access"` no), el VALOR ENTERO de esa entrada se reemplaza por
`"[redactado]"` en cada lado que esté definido — nunca el valor real, pero
**sí queda registrado que ese campo CAMBIÓ**. Una versión anterior redactaba
`antes`/`despues` ENTEROS *antes* de diffear (para tapar la misma fuga);
eso hacía que los dos lados de un campo sensible llegaran a `loQueCambio`
como el MISMO string `"[redactado]"`, y un cambio real en ese campo
desaparecía de `cambios` por completo — no solo el valor, la SEÑAL de que
hubo un cambio. El diseño actual evita las dos fugas: ni el valor real ni
"nada cambió" cuando sí cambió.

**Nunca tira.** Devuelve `{ ok, ... }` y, si falla, loguea un RESUMEN
seguro con `console.error` — **nunca** el objeto de error completo: un
`DrizzleQueryError` trae, como propiedad PROPIA (`.message`), el SQL armado
y los PARÁMETROS bindeados (`"Failed query: <sql>\nparams: <valores>"`).
`auditar` **nunca** lee `.message`/`.code` del error de afuera, ni siquiera
como último recurso: solo `code`/`message` de `error.cause` (el error real
de `pg`) van al log — `message` describe la RESTRICCIÓN que falló, nunca el
valor que la violó (eso vive en `DETAIL`, que tampoco se lee). Si
`error.cause` falta o no tiene nada legible, el log usa un string genérico
fijo (`"error de base de datos sin detalle"`), nunca "lo que haya" del
error de afuera.
El sanitizador tampoco tira él mismo, aunque el error atrapado sea un
objeto raro (un `Proxy` cuyas trampas `has`/`get` tiran, un `cause`
definido como getter que tira, un `Proxy` revocado): cada lectura va
protegida y, si falla, `codigo` queda `null` y/o `mensaje` cae al genérico.

**`resultado.error` (cuando `ok: false`) es `{ codigo, mensaje }`
SANITIZADO — no el error crudo.** `codigo` es el `code` de Postgres (ej.
`"23514"`, desde `error.cause`) o `null` si no se pudo determinar;
`mensaje` es el `message` de Postgres, o el mismo string genérico fijo si
no hay uno seguro. Se arma con la MISMA función que el resumen que se
loguea, así que las dos superficies son igual de seguras: el SQL armado y
los parámetros bindeados NUNCA aparecen en ninguna de las dos. Antes,
`resultado.error` era el error crudo (con el riesgo de que un llamador lo
mostrara o lo reenviara sin saber que traía el SQL/los parámetros
adentro) — ahora es seguro de mostrar/loguear tal cual, sin que la app
tenga que armar su propio resumen.

**Los errores de Postgres clase `22` (Data Exception — `22P02` "invalid text
representation" y el resto de esa clase) tienen un `message` que ECOA el
valor de entrada que lo causó** (ej. `invalid input syntax for type uuid:
"no-es-un-uuid-valido"` incluye el string inválido tal cual se mandó, que
puede ser un dato del usuario). A diferencia de la clase `23`
(violaciones de constraint, cuyo `message` describe la RESTRICCIÓN, no el
valor), estos códigos no son seguros de mostrar/loguear tal cual: para
cualquier código que empiece con `"22"`, `resultado.error.mensaje` (y el
resumen logueado) se reemplaza por un texto genérico que conserva el código
pero no el valor — `` `valor inválido para la columna (${codigo})` `` — en
vez del `message` real de Postgres.

```ts
// tenantId inválido (columna uuid) → 22P02, sin ecoar el valor:
const resultado = await auditar(db, auditoria, {
  tenantId: "no-es-un-uuid-valido",
  entidad: "producto", entidadId, accion: "actualizar", actor: { tipo: "sistema" },
});
// resultado.error === { codigo: "22P02", mensaje: "valor inválido para la columna (22P02)" }
// (nunca "no-es-un-uuid-valido" en el mensaje ni en el log)
```

**Un fallo ANTES de llegar a la base (normalizando/redactando/serializando/
armando el SQL) da un mensaje DISTINTO al de un fallo de Postgres** —
`"error preparando la auditoría"` (con `codigo: null`), no `"error de base
de datos sin detalle"` — para no hacer parecer un problema de la base algo
que en realidad es un bug de esta función o de cómo se armó `tabla`. Este
paso previo no debería fallar en uso normal (`redactar`/`serializarParaAuditoria`/
`normalizarParaDiff` están diseñados para nunca tirar), pero una `tabla`
malformada (una columna `undefined`) sí puede hacerlo fallar antes de tocar
`dbOTx`.

El trade-off de "nunca tira" adentro de una transacción: un `INSERT` que
falla deja esa transacción ABORTADA en Postgres — un simple `try/catch` NO
alcanza, porque el `catch` atraparía el error de auditoría pero la
transacción EXTERNA quedaría inservible para el resto de las sentencias del
flujo que la llamó. La solución es un `SAVEPOINT`: `auditar` SIEMPRE llama
`dbOTx.transaction(...)` — en Drizzle, `tx.transaction()` anidado (dentro
de una transacción ya abierta) arma un `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`
en vez de una transacción nueva, así que un fallo del insert de auditoría
no aborta la transacción externa. Llamado con el `db` de nivel superior,
`.transaction()` simplemente abre una transacción normal para el insert.

**Si tu app llama a `auditar` más de una vez DENTRO de la misma
transacción, hacelo con `await` secuencial — nunca `Promise.all`.** Dos
`SAVEPOINT` concurrentes sobre la MISMA `tx` pisan el estado de transacción
uno del otro; el resultado es indefinido. **No soporta el driver
`neon-http`** (`drizzle-orm/neon-http`): ese driver no implementa
`db.transaction()` en absoluto (cada `execute` es su propio request HTTP
sin estado), así que no hay `SAVEPOINT` posible — usar `neon-serverless`
(WebSocket) o `node-postgres` si tu app necesita `auditar` dentro de una
transacción.

Con `antes` y `despues` ausentes, `cambios` queda `[]`.

```ts
import { auditar } from "@mafesoftware/auditoria/drizzle";

const resultado = await auditar(db, auditoria, {
  tenantId,
  entidad: "producto",
  entidadId: productoId,
  accion: "actualizar",
  actor: { tipo: "usuario", id: usuarioId },
  antes: productoAnterior,
  despues: productoNuevo,
});
if (!resultado.ok) {
  // resultado.error ya se logueó (resumen seguro) con console.error;
  // seguir igual, no relanzar. resultado.error = { codigo, mensaje } ya es
  // seguro para mostrar/loguear tal cual (nunca el SQL/los parámetros).
  console.log(resultado.error.codigo, resultado.error.mensaje); // ej. "23514", "new row for relation ... violates check constraint ..."
}

// Un campo sensible que CAMBIÓ queda registrado (sin el valor real):
await auditar(db, auditoria, {
  tenantId, entidad: "usuario", entidadId, accion: "actualizar", actor: { tipo: "usuario" },
  antes: { password: "A" }, despues: { password: "B" },
});
// cambios: [{ campo: "password", antes: "[redactado]", despues: "[redactado]" }]
// (se sabe que "password" cambió, nunca a qué)

// Adentro de una transacción de negocio: si auditar falla, la tx externa
// sigue viva (SAVEPOINT) y commitea el resto de su trabajo.
await db.transaction(async (tx) => {
  await tx.update(productos).set({ precio: nuevoPrecio }).where(eq(productos.id, id));
  await auditar(tx, auditoria, {
    tenantId,
    entidad: "producto",
    entidadId: id,
    accion: "actualizar",
    actor: { tipo: "usuario", id: usuarioId },
  });
});
```

#### `listarAuditoria(db, tabla: TablaAuditoria, opciones): Promise<{ filas: FilaAuditoria[]; total: number }>`

Lista filas de auditoría de UN tenant (`tenantId` siempre obligatorio, el
filtro se llama `actorId` — ver "Decisiones propias respecto al brief" más
arriba), con filtros opcionales por `entidad`/`entidadId`/`actorId`/
`desde`/`hasta`, paginado (`pagina` base 1, `porPagina` por defecto `50`,
cap-eado a `200` aunque se pida más). Siempre ordenado por `creado_en DESC,
id DESC`. `pagina`/`porPagina` que lleguen `NaN`/`Infinity`/`-Infinity`
(típico de `Number(queryParam)` sobre un string sin validar) caen a sus
defaults en vez de romper la consulta con un `LIMIT`/`OFFSET` inválido.

```ts
import { listarAuditoria } from "@mafesoftware/auditoria/drizzle";

const { filas, total } = await listarAuditoria(db, auditoria, {
  tenantId,
  entidad: "producto",
  entidadId: productoId,
  pagina: 1,
  porPagina: 20,
});
```

## Postgres para los tests de `/drizzle`

`tests/drizzle/postgres.test.ts` prueba `auditar`/`listarAuditoria` contra
Postgres real: inserción, rollback (una tx que revierte no deja fila),
`SAVEPOINT` (un fallo forzado del insert de auditoría, adentro de una tx,
no aborta esa tx externa — probado con una escritura de NEGOCIO en una
tabla SEPARADA de auditoría, para confirmar que el `SAVEPOINT` protege
cualquier trabajo previo de la tx, no solo otra fila de auditoría),
redacción aplicada correctamente (verificado leyendo el `jsonb` CRUDO con
`::text`): un secreto ANIDADO bajo una clave ancestro sensible no aparece
NUNCA, pero un cambio en un campo sensible SÍ queda registrado en
`cambios` (con los valores tapados, no ausente — la regresión que corrigió
esta ronda), que `console.error` nunca loguea el error completo ni valores
de la entrada (spía sobre `console.error`, silenciado en los tests de
fallo para no ensuciar la salida), `pagina`/`porPagina` con
`NaN`/`Infinity`, aislamiento entre tenants y paginación, y (ronda 4, M-a)
un `tenantId` no-uuid contra la columna uuid real de la tabla de prueba →
Postgres devuelve `22P02` real, y `resultado.error.mensaje` es el texto
genérico (`"valor inválido para la columna (22P02)"`, sin el valor
inválido ni la palabra "uuid" adentro, ni en el resultado ni en lo
logueado).
`tests/drizzle/auditar-log-seguro.test.ts` (sin Postgres real — un `dbOTx`
falso alcanza) prueba que el log nunca cae al `.message` del error de
AFUERA (que trae el SQL + params) ni siquiera cuando falta `error.cause`, y
(ronda 4, M-b) que un fallo ANTES de `dbOTx.transaction` (una `tabla` rota,
armada a mano, sin la columna `tenantId`) da `{ codigo: null, mensaje:
"error preparando la auditoría" }` — nunca el genérico de fallo de base —
y que el `dbOTx` (que tiraría si se llegara a llamar) nunca se toca.
`tests/redaccion-anidada.test.ts` (núcleo, sin Postgres) prueba la misma
lógica de redacción de `cambios` importando la función REAL
`redactarCambios` (desde la ronda 5, export público del núcleo en
`src/redactar-cambios.ts` — el test la importa de `src/index.ts`, como una
app), armando el pipeline completo
`loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues))` +
`redactarCambios`, más los tipos especiales (`Buffer`, `URL`, `Error`,
`toJSON`, claves de `Map` rotas, `Proxy` con `ownKeys` roto) en
`tests/redactar.test.ts`/`tests/serializar.test.ts`, y (ronda 4) una
sección de regresión dedicada a instancias EQUIVALENTES pero no idénticas
(`Decimal`/`Map`/`URL`/instancia de clase construidos por separado con el
mismo contenido → sin entrada en `cambios`; un objeto plano con `toJSON`
propio que enmascara un dni igual en ambos lados → sin entrada falsa).
`tests/normalizar-para-diff.test.ts` (núcleo, sin Postgres) prueba
`normalizarParaDiff` por tipo especial, ciclos, y "nunca tira" (`Proxy` con
trampas rotas, `get toJSON(){throw}`, `Error` con getter de `name` que
tira). Ronda 5: `tests/drizzle/auditar-captura.test.ts` (sin Postgres: un
`dbOTx` falso que captura la consulta compilada con `PgDialect`) corre el
`auditar` real con `Map`s bajo/como claves sensibles (en la raíz, en alta y
baja, devueltos por un `toJSON`, con claves que colisionan) y confirma que
ningún secreto aparece en los parámetros, que `cambios` trae la entrada
`"m.password"` tapada y que las copias guardadas coinciden, más que el
sanitizador del catch nunca tira con errores raros (`Proxy` con trampas
rotas, getter de `cause` que tira, `Proxy` revocado).
`tests/iteracion-rota.test.ts` prueba `Map`/`Set` cuya iteración tira en
las tres funciones, y `tests/lo-que-cambio-nunca-tira.test.ts` que
`loQueCambio` no tira con nodos no inspeccionables.
`tests/drizzle/postgres-inmutabilidad.test.ts`
prueba que el trigger de `sqlInmutabilidad` rechaza
`UPDATE`/`DELETE`/`TRUNCATE`. No hay mock que valga para lo que sí
necesita Postgres real: son comportamientos de la base (un `SAVEPOINT`
real, un trigger real, un código `SQLSTATE` real), no lógica de la app en
el vacío.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, esos archivos FALLAN
con un mensaje claro (no se saltean en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz), compartida
con `packages/tenant` y `packages/numeradores`. `tests/drizzle/config.test.ts`
(verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye los archivos
`postgres*.test.ts`.
