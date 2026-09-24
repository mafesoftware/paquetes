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
| `Map` | arreglo de pares `[String(clave), valor]` — **no un objeto**: dos claves de `Map` distintas (ej. el número `1` y el string `"1"`) pueden normalizar al MISMO nombre de propiedad, y un objeto perdería una en silencio. Un par cuya clave (ya convertida a texto) es sensible tiene su VALOR redactado |
| `Set` | arreglo |

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

redactar(new Map([[1, "hunter2"], ["contrasena", "hunter3"]]));
// [["1", "hunter2"], ["contrasena", "[redactado]"]] (arreglo de pares, no objeto)
```

#### `CAMPOS_SENSIBLES_POR_DEFECTO: readonly string[]`

La lista default de nombres de campo que tapa `redactar`/`auditar`:

```ts
import { CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";

CAMPOS_SENSIBLES_POR_DEFECTO;
// ["contrasena", "password", "hash", "token", "secreto", "secret", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
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
`Map` se convierte a un arreglo de pares `[String(clave), valor]` (no un
objeto — evita perder entradas cuando dos claves distintas normalizan al
mismo string); `Set` a un arreglo; cualquier otro objeto — plano o
instancia de clase propia — se recorre por sus campos propios enumerables.

```ts
import { serializarParaAuditoria } from "@mafesoftware/auditoria";

serializarParaAuditoria({ saldo: 123n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined });
// { saldo: "123n", vence: "2026-01-01T00:00:00.000Z" } (sin "nota")

serializarParaAuditoria([1n, undefined, 3n]);
// ["1n", null, "3n"]

serializarParaAuditoria(new Map([["a", 1n]]));
// [["a", "1n"]] (arreglo de pares, no objeto)

serializarParaAuditoria(new URL("https://api.com/x?token=SECRETO"));
// "https://api.com/x"

serializarParaAuditoria(new Error("mensaje que puede tener datos"));
// { name: "Error" } (nunca .message)
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

#### `auditar(dbOTx, tabla: TablaAuditoria, entrada): Promise<{ ok: true; id: string } | { ok: false; error: unknown }>`

Calcula `cambios` con `loQueCambio` sobre los valores CRUDOS de
`entrada.antes`/`entrada.despues`, redacta `antes`/`despues`/`cambios`,
serializa los tres, e inserta.

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

**`resultado.error` (cuando `ok: false`) es el error CRUDO**, no un
resumen — puede traer el SQL/params igual que arriba. Se devuelve así por
si un llamador necesita inspeccionarlo en código (ej. reintentar según
`error.cause.code`), pero eso significa que **nunca hay que
loguearlo/mostrarlo tal cual** a un usuario final o a un sistema externo.
Si tu app necesita mostrar o reenviar el motivo de un fallo, armá tu propio
resumen seguro (mismo patrón que el interno de `auditar`) en vez de asumir
que `resultado.error` ya es seguro para mostrar.

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
  // seguir igual, no relanzar — y nunca mostrar resultado.error tal cual.
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
`NaN`/`Infinity`, aislamiento entre tenants y paginación.
`tests/drizzle/auditar-log-seguro.test.ts` (sin Postgres real — un `dbOTx`
falso alcanza) prueba que el log nunca cae al `.message` del error de
AFUERA (que trae el SQL + params) ni siquiera cuando falta `error.cause`.
`tests/redaccion-anidada.test.ts` (núcleo, sin Postgres) prueba la misma
lógica de redacción de `cambios` con las funciones exportadas del núcleo,
más los tipos especiales (`Buffer`, `URL`, `Error`, `toJSON`, claves de
`Map` rotas, `Proxy` con `ownKeys` roto) en `tests/redactar.test.ts`/
`tests/serializar.test.ts`. `tests/drizzle/postgres-inmutabilidad.test.ts`
prueba que el trigger de `sqlInmutabilidad` rechaza
`UPDATE`/`DELETE`/`TRUNCATE`. No hay mock que valga para lo que sí
necesita Postgres real: son comportamientos de la base (un `SAVEPOINT`
real, un trigger real), no lógica de la app en el vacío.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, esos archivos FALLAN
con un mensaje claro (no se saltean en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz), compartida
con `packages/tenant` y `packages/numeradores`. `tests/drizzle/config.test.ts`
(verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye los archivos
`postgres*.test.ts`.
