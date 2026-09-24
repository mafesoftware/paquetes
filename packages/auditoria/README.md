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

Nunca tira: una referencia circular queda como `"[ciclo]"`, una clave cuyo
`get` tira queda como `"[error]"`.

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
`get` tira (queda como `"[error]"`). `bigint` se convierte a un STRING con
sufijo `"n"` (`123n` → `"123n"` — JSON no tiene tipo `bigint` y
`JSON.stringify(123n)` tira directo); `Date` se convierte a su ISO string;
`undefined` se descarta (la clave desaparece de un objeto; adentro de un
arreglo se convierte a `null`, no se saca el índice); `Map` se convierte a
un objeto de entradas (clave `String(clave)`); `Set` a un arreglo;
cualquier otro objeto — plano o instancia de clase propia — se recorre por
sus campos propios enumerables. Una referencia circular queda como
`"[ciclo]"`, sin recursión infinita.

```ts
import { serializarParaAuditoria } from "@mafesoftware/auditoria";

serializarParaAuditoria({ saldo: 123n, vence: new Date("2026-01-01T00:00:00.000Z"), nota: undefined });
// { saldo: "123n", vence: "2026-01-01T00:00:00.000Z" } (sin "nota")

serializarParaAuditoria([1n, undefined, 3n]);
// ["1n", null, "3n"]
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

Redacta `antes`/`despues`, calcula `cambios` con `loQueCambio` **sobre lo
YA redactado**, serializa los tres, e inserta.

**Por qué se redacta ANTES de diffear (no después).** La primera versión
calculaba `cambios = loQueCambio(entrada.antes, entrada.despues)` con los
valores CRUDOS y redactaba recién después, mirando solo el último segmento
de cada ruta — un secreto ANIDADO bajo una clave ancestro sensible (ej.
`{ token: { access: "AAA1" } }`, donde `"token"` es sensible pero
`"access"` no) llegaba a la base SIN TAPAR. El fix: `redactar` corre sobre
`antes`/`despues` ENTEROS (mira TODOS los ancestros de una ruta) ANTES de
llamar a `loQueCambio`, que nunca llega a ver el secreto. **Consecuencia
aceptada**: si un valor sensible CAMBIÓ, como los dos lados quedan
`"[redactado]"` antes de diffear, `cambios` no muestra que hubo un cambio
ahí en absoluto — se prioriza no filtrar el secreto por sobre mostrar que
existió un cambio en un campo sensible.

**Nunca tira.** Devuelve `{ ok, ... }` y, si falla, loguea un RESUMEN
seguro con `console.error` — **nunca** el objeto de error completo: un
`DrizzleQueryError` trae, como propiedades PROPIAS, el SQL armado y los
PARÁMETROS bindeados (`console.error(msg, error)` filtraría cualquier valor
insertado, redactado o no, al log de la app). Solo `entidad`/`entidadId`/
`accion` de la propia entrada, más `code`/`message` del error de Postgres
(`error.cause`) van al log — `message` describe la RESTRICCIÓN que falló,
nunca el valor que la violó (eso vive en `DETAIL`, que tampoco se lee).

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
  // resultado.error ya se logueó con console.error; seguir igual, no relanzar.
}

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
redacción aplicada ANTES de llegar a la base (verificado leyendo el `jsonb`
CRUDO con `::text`, incluido un secreto ANIDADO bajo una clave ancestro
sensible — el caso que se filtraba antes del fix estructural), que
`console.error` nunca loguea el error completo ni valores de la entrada
(spía sobre `console.error`, silenciado en los tests de fallo para no
ensuciar la salida), `pagina`/`porPagina` con `NaN`/`Infinity`, aislamiento
entre tenants y paginación. `tests/drizzle/postgres-inmutabilidad.test.ts`
prueba que el trigger de `sqlInmutabilidad` rechaza
`UPDATE`/`DELETE`/`TRUNCATE`. No hay mock que valga para ninguno de los
dos: son comportamientos de Postgres (un `SAVEPOINT` real, un trigger
real), no lógica de la app en el vacío.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, esos archivos FALLAN
con un mensaje claro (no se saltean en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz), compartida
con `packages/tenant` y `packages/numeradores`. `tests/drizzle/config.test.ts`
(verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye los archivos
`postgres*.test.ts`.
