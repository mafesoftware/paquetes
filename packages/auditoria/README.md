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
distintas del mismo instante son iguales); `null` y `undefined` son SIEMPRE
distintos (`undefined` significa "la clave está ausente", no "sin valor");
una clave agregada o quitada se ve como su valor pasando desde/hacia
`undefined`. **Un lado ausente (`undefined`) contra un objeto plano del
otro lado se expande CAMPO A CAMPO**, no como un solo cambio con el objeto
entero — el caso típico de auditar una entidad recién CREADA (`antes`
ausente) o BORRADA (`despues` ausente). Nunca tira por una referencia
circular: esa rama se reporta como `"[ciclo]"`.

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
// (entidad recién creada: "antes" ausente se expande campo a campo)

loQueCambio(undefined, undefined); // []
```

#### `redactar(obj, camposSensibles = CAMPOS_SENSIBLES_POR_DEFECTO)`

Una copia profunda de `obj` donde cualquier CLAVE cuyo nombre (minúsculas,
sin `_`/`-`) matchee `camposSensibles` queda reemplazada por
`"[redactado]"`, a cualquier profundidad, adentro de arreglos incluido.
`"API-Key"`, `"apiKey"` y `"api_key"` matchean el mismo nombre normalizado.
Nunca tira por una referencia circular (esa rama queda como `"[ciclo]"`).

```ts
import { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";

redactar({ usuario: "ana", contrasena: "hunter2" });
// { usuario: "ana", contrasena: "[redactado]" }

redactar({ pago: { datos: { cbu: "0000003100010000000001", monto: 100 } } });
// { pago: { datos: { cbu: "[redactado]", monto: 100 } } }

redactar({ token: "t1", extra: "visible" }, ["token"]); // lista propia
// { token: "[redactado]", extra: "visible" }
```

#### `CAMPOS_SENSIBLES_POR_DEFECTO: readonly string[]`

La lista default de nombres de campo que tapa `redactar`/`auditar`:

```ts
import { CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";

CAMPOS_SENSIBLES_POR_DEFECTO;
// ["contrasena", "password", "hash", "token", "secreto", "secret", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
```

#### `serializarParaAuditoria(v: unknown): unknown`

Deja `v` listo para `jsonb`: **nunca tira**. `bigint` se convierte a un
STRING con sufijo `"n"` (`123n` → `"123n"` — JSON no tiene tipo `bigint` y
`JSON.stringify(123n)` tira directo); `Date` se convierte a su ISO string;
`undefined` se descarta (la clave desaparece de un objeto; adentro de un
arreglo se convierte a `null`, no se saca el índice). Una referencia
circular queda como `"[ciclo]"`, sin recursión infinita.

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
tabla/función/trigger).

```ts
import { sqlInmutabilidad } from "@mafesoftware/auditoria/drizzle";

// En una migración a mano, después de la que generó drizzle-kit:
const migracion = sqlInmutabilidad("auditoria");
// corrida contra Postgres: UPDATE/DELETE/TRUNCATE sobre "auditoria" ahora tiran
// error: La tabla "auditoria" es de solo lectura (auditoría inmutable): no se permite UPDATE en esta tabla.

sqlInmutabilidad("Auditoria; DROP TABLE x --"); // tira: nombre inválido
```

#### `auditar(dbOTx, tabla: TablaAuditoria, entrada): Promise<{ ok: true; id: string } | { ok: false; error: unknown }>`

Calcula `cambios` con `loQueCambio(entrada.antes, entrada.despues)`,
redacta y serializa `antes`/`despues`/`cambios`, e inserta.

**Nunca tira.** Devuelve `{ ok, ... }` y, si falla, loguea con
`console.error` — una falla de auditoría no tiene que tirar abajo la
operación de negocio que la disparó. El trade-off: adentro de una
transacción, un `INSERT` que falla deja esa transacción ABORTADA en
Postgres — un simple `try/catch` NO alcanza, porque el `catch` atraparía el
error de auditoría pero la transacción EXTERNA quedaría inservible para el
resto de las sentencias del flujo que la llamó. La solución es un
`SAVEPOINT`: `auditar` SIEMPRE llama `dbOTx.transaction(...)` — en Drizzle,
`tx.transaction()` anidado (dentro de una transacción ya abierta) arma un
`SAVEPOINT`/`ROLLBACK TO SAVEPOINT` en vez de una transacción nueva, así
que un fallo del insert de auditoría no aborta la transacción externa.
Llamado con el `db` de nivel superior, `.transaction()` simplemente abre
una transacción normal para el insert.

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

Lista filas de auditoría de UN tenant (`tenantId` siempre obligatorio),
con filtros opcionales por `entidad`/`entidadId`/`actorId`/`desde`/`hasta`,
paginado (`pagina` base 1, `porPagina` por defecto `50`, cap-eado a
`200` aunque se pida más). Siempre ordenado por `creado_en DESC, id DESC`.

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
no aborta esa tx externa), redacción aplicada ANTES de llegar a la base (se
verifica leyendo el `jsonb` crudo), aislamiento entre tenants y
paginación. `tests/drizzle/postgres-inmutabilidad.test.ts` prueba que el
trigger de `sqlInmutabilidad` rechaza `UPDATE`/`DELETE`/`TRUNCATE`. No hay
mock que valga para ninguno de los dos: son comportamientos de Postgres
(un `SAVEPOINT` real, un trigger real), no lógica de la app en el vacío.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, esos archivos FALLAN
con un mensaje claro (no se saltean en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz), compartida
con `packages/tenant` y `packages/numeradores`. `tests/drizzle/config.test.ts`
(verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye los archivos
`postgres*.test.ts`.
