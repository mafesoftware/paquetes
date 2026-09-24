# @mafesoftware/numeradores

Números correlativos SIN huecos (recibos, órdenes de pago, órdenes de
compra) por tenant + ámbito + tipo, seguros con muchas transacciones
concurrentes.

Ninguna de las 5 implementaciones que había repetidas en los productos de
MAFE Software garantizaba eso bajo concurrencia real:

- store360 (`src/lib/numeracion.ts`): `max + 1` calculado en la misma
  sentencia del `insert`, con reintento manual si chocaba el índice único.
  Funciona, pero cada pantalla que numeraba (checkout web, venta de
  mostrador, cobro a cuenta) copiaba su propio bucle de reintento a mano —
  y una de esas copias tenía solo 3 intentos y sin espera entre uno y otro,
  justo la combinación insuficiente bajo carga documentada en ese mismo
  archivo.
- ediflow (`liquidation/confirm.ts`): un contador de fila (`couponSeq`) más
  un lock consultivo (`pg_advisory_xact_lock`) — funciona, pero atado a un
  solo caso de uso (cupones de liquidación), sin ámbito ni reutilización.

Este paquete junta lo que funcionaba de cada una (el patrón atómico de
store360, sin el reintento copiado a mano en cada pantalla) en una sola
implementación, genérica por `(tenant, ámbito, tipo)` y con la garantía
explícita de "100 transacciones concurrentes piden el mismo número → salen
exactamente 1..100, sin huecos ni repetidos" — algo que ninguna de las 5
probaba.

Núcleo **puro**: sin variables de entorno, sin framework, sin base de
datos. Lo específico de Drizzle (la tabla y las dos operaciones atómicas
que la usan) vive en el subpath `/drizzle` (`drizzle-orm` como
peerDependency opcional, `>=0.45 <0.46`), y usa
`@mafesoftware/tenant/drizzle` para la columna de tenant.

```bash
bun add @mafesoftware/numeradores
```

La documentación de cada función está en `src/`, con el motivo de cada
decisión al lado. Los tests (`tests/`) son la otra mitad de la
documentación — en particular `tests/drizzle/postgres.test.ts`, que prueba
las garantías de concurrencia contra Postgres real.

## API

### Núcleo (`@mafesoftware/numeradores`)

#### `formatearNumero(n: bigint, opciones?: { prefijo?: string; relleno?: number; sufijo?: string }): string`

Rellena `n` con ceros a la izquierda hasta `relleno` dígitos y le pone
`prefijo`/`sufijo` alrededor. **Nunca trunca** — a diferencia del `lpad` de
Postgres, que si el texto ya es más largo que el ancho pedido lo CORTA
(`lpad('10000', 4, '0')` da `'1000'`, no `'10000'`). Ese bug vivía en
`numeracion.ts` de store360 (con un comentario que afirmaba lo contrario) y
truncó números reales en producción. Acá `relleno` es un piso, nunca un
techo: usa `String.prototype.padStart`, que solo agrega ceros, jamás corta.

```ts
import { formatearNumero } from "@mafesoftware/numeradores";

formatearNumero(7n, { relleno: 4 }); // "0007"
formatearNumero(699401n, { prefijo: "R-", relleno: 4 }); // "R-699401" (NO "R-9940": no trunca)
formatearNumero(3n, { prefijo: "OP-", relleno: 6, sufijo: "-A" }); // "OP-000003-A"
formatearNumero(42n); // "42" (sin opciones)
```

#### `esChoqueDeUnico(error: unknown): boolean`

¿Es `error` (en cualquier punto de su cadena) un choque de índice único de
Postgres (`23505`, `unique_violation`)? Mira `code`, no el texto del
mensaje (que viene traducido según la configuración regional del
servidor). Camina la cadena de `error.cause` hasta 10 niveles — los
drivers y ORMs envuelven el error original en uno propio (`"Failed
query: …"`) y dejan el de Postgres en `cause`, así que mirar solo
`error.code` a secas nunca lo encuentra — y también baja adentro de un
`AggregateError.errors` (con la cadena de `cause` de cada uno).

**`siguienteNumero` de este paquete NO produce este error** (su
`INSERT ... ON CONFLICT DO UPDATE` absorbe el choque adentro de la misma
sentencia, nunca llega a violar el índice — ver `esFallaDeSerializacion`
para el fallo real de `siguienteNumero` bajo concurrencia). Sigue sirviendo
para el patrón más viejo de `max + 1` + insert (el de `numeracion.ts` de
store360) o cualquier otro insert con una clave única calculada antes de
escribir.

```ts
import { esChoqueDeUnico } from "@mafesoftware/numeradores";

try {
  await db.insert(tabla).values(fila); // clave única calculada antes de escribir
} catch (error) {
  if (esChoqueDeUnico(error)) {
    // reintentar: dos transacciones calcularon el mismo valor único
  }
  throw error;
}
```

#### `esFallaDeSerializacion(error: unknown): boolean`

¿Es `error` (en cualquier punto de su cadena) una falla de serialización de
Postgres — `40001` (`serialization_failure`) o `40P01`
(`deadlock_detected`)? Misma caminata de `cause`/`AggregateError` que
`esChoqueDeUnico`. Son dos motivos distintos: `40001` necesita aislamiento
`REPEATABLE READ`/`SERIALIZABLE` (no pasa bajo `READ COMMITTED`, el default
de Postgres y para el que `siguienteNumero` está pensado); `40P01`
(deadlock) en cambio puede pasar bajo CUALQUIER aislamiento, incluido
`READ COMMITTED` — no depende del nivel de aislamiento, depende del ORDEN
en que dos transacciones toman locks. Si una transacción llama a
`siguienteNumero` para VARIAS filas (más de un `(tenant, ambito, tipo)`) y
otra transacción concurrente las pide en el orden contrario, Postgres
puede abortar a una de las dos con `40P01`. Cuando pasa cualquiera de los
dos, TODA la transacción queda abortada, no solo la sentencia — hay que
reintentar la transacción ENTERA, y si tu app numera más de una fila por
transacción, además conviene un orden de bloqueo consistente entre los
flujos que puedan competir (reduce la chance de deadlock, no la elimina).

```ts
import { esFallaDeSerializacion } from "@mafesoftware/numeradores";

try {
  await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }), {
    isolationLevel: "serializable",
  });
} catch (error) {
  if (esFallaDeSerializacion(error)) {
    // hay que reintentar la transacción ENTERA, no solo esta llamada — ver conReintento
  }
  throw error;
}
```

#### `conReintento<T>(fn: () => Promise<T>, opciones?: { intentos?: number; esReintentable?: (error: unknown) => boolean; espera?: (intento: number) => Promise<void> }): Promise<T>`

Llama a `fn` y, si tira un error reintentable (`esChoqueDeUnico` por
defecto), vuelve a llamarla con una espera creciente y con jitter entre
intentos, hasta `intentos` veces en total (`5` por defecto). La espera con
jitter es parte del mecanismo, no un detalle: sin ella, los perdedores de
una carrera reintentarían todos juntos sobre la misma foto y volverían a
chocar entre sí. `espera` es inyectable para tests deterministas.

Con `siguienteNumero` bajo `READ COMMITTED` (el uso típico, default de
`db.transaction(...)`) pidiendo **una sola fila por transacción**, no hace
falta reintentar nada: el bloqueo de fila del `INSERT ... ON CONFLICT` ya
serializa a las transacciones concurrentes sin que ninguna falle (lo
prueban los tests de concurrencia contra Postgres real). **Eso no quiere
decir que `READ COMMITTED` esté libre de fallas**: un deadlock (`40P01`)
puede pasar bajo cualquier aislamiento si una transacción numera VARIAS
filas y otra concurrente las pide en el orden contrario (ver
`esFallaDeSerializacion` más arriba) — ahí también hace falta
`conReintento`. Y con `REPEATABLE READ`/`SERIALIZABLE` explícito, siempre
hay que envolver la **transacción entera**, no la llamada a
`siguienteNumero` sola (una transacción abortada por Postgres rechaza
cualquier sentencia posterior hasta que termina):

```ts
import { conReintento, esChoqueDeUnico, esFallaDeSerializacion } from "@mafesoftware/numeradores";
import { siguienteNumero } from "@mafesoftware/numeradores/drizzle";

// READ COMMITTED (default), UNA sola fila por transacción: no hace falta conReintento.
const { numero, formateado } = await db.transaction((tx) =>
  siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
);

// READ COMMITTED pero numerando MÁS DE UNA fila en la misma transacción:
// un deadlock (40P01) es posible aunque sea READ COMMITTED — conReintento
// con el mismo predicado combinado, y pedir los números siempre en el
// mismo orden en todos los flujos que puedan competir.
const { recibo, ordenPago } = await conReintento(
  () =>
    db.transaction(async (tx) => ({
      recibo: await siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
      ordenPago: await siguienteNumero(tx, numeradores, { tenantId, tipo: "orden_pago" }),
    })),
  { esReintentable: (e) => esChoqueDeUnico(e) || esFallaDeSerializacion(e) },
);

// SERIALIZABLE explícito: conReintento envuelve TODA la transacción.
const { numero: numeroSerializable } = await conReintento(
  () =>
    db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }), {
      isolationLevel: "serializable",
    }),
  { intentos: 8, esReintentable: (e) => esChoqueDeUnico(e) || esFallaDeSerializacion(e) },
);
```

#### `ErrorNumeradores`

El único error que tira este paquete (`siguienteNumero`,
`configurarNumerador`). `codigo` distingue el motivo sin parsear el
mensaje: `"requiere_transaccion"`, `"retroceso_no_permitido"`,
`"proximo_invalido"` o `"relleno_invalido"`.

```ts
import { ErrorNumeradores } from "@mafesoftware/numeradores";

try {
  await siguienteNumero(db, numeradores, { tenantId, tipo: "recibo" }); // db, no tx
} catch (error) {
  if (error instanceof ErrorNumeradores) error.codigo; // "requiere_transaccion"
}
```

### `/drizzle` (`@mafesoftware/numeradores/drizzle`)

Requiere `drizzle-orm >=0.45 <0.46` como peerDependency **opcional**. El
núcleo (`@mafesoftware/numeradores`) no lo importa. Este paquete **no trae
migraciones**: cada app genera las suyas con drizzle-kit a partir de su
propio esquema, que usa `tablaNumeradores`.

#### `tablaNumeradores(opciones?: { tenant?: { columna?: string; tipo?: "uuid" | "text" }; nombre?: string; columnasExtra?: Record<string, PgColumnBuilderBase> })`

La tabla que guarda, por `(tenant, ambito, tipo)`, el próximo número a
entregar. La columna de tenant sale de `columnaTenant` de
`@mafesoftware/tenant/drizzle` (mismos defaults: `"organizacion_id"`,
`uuid`). `ambito` es `text NOT NULL default ""` — **`""` significa "sin
ámbito", nunca `NULL`**: un índice único de Postgres trata cada `NULL`
como distinto de cualquier otro, así que dos filas "sin ámbito" del mismo
tenant y tipo NO chocarían si la columna admitiera `NULL`; con `""` fijo,
el único índice sí las distingue como la MISMA fila.
`siguienteNumero`/`configurarNumerador` reciben `ambito?: string | null` y
convierten `null`/`undefined` a `""` antes de tocar la base — la app nunca
necesita saber este detalle. Único índice sobre `(tenant, ambito, tipo)`,
que es lo que hace atómico el `siguienteNumero` de abajo.

```ts
import { tablaNumeradores } from "@mafesoftware/numeradores/drizzle";

// Defaults: tabla "numeradores", columna de tenant "organizacion_id" (uuid).
export const numeradores = tablaNumeradores();

// Columna de tenant propia y otro nombre de tabla:
export const numeradoresDeFacturacion = tablaNumeradores({
  tenant: { columna: "club_id", tipo: "text" },
  nombre: "numeradores_facturacion",
});
```

#### `siguienteNumero(tx, tabla: TablaNumeradores, opciones: { tenantId: string; ambito?: string | null; tipo: string }): Promise<{ numero: bigint; formateado: string }>`

El próximo número correlativo para `(tenantId, ambito, tipo)`.

**Exige transacción**: `tx` tiene que ser la que entrega
`db.transaction(async (tx) => ...)`, no el `db` de nivel superior — si no,
tira `ErrorNumeradores("requiere_transaccion")`. El número solo se
considera consumido cuando esa transacción confirma: si se pudiera llamar
fuera de una, un rollback más adelante en el mismo flujo (por ejemplo,
falló insertar el comprobante) dejaría el número gastado sin nada que lo
use — un hueco. La detección es `is(tx, PgTransaction)` (de `drizzle-orm`,
no `tx instanceof PgTransaction`: `is()` compara por `entityKind` en vez de
la identidad del constructor, así que no falla si terminan instalándose dos
copias de `drizzle-orm` — un caso real en monorepos con hoisting parcial).
`PgTransaction` es la clase abstracta de `drizzle-orm/pg-core` de la que
heredan tanto `NodePgTransaction` (node-postgres) como `NeonTransaction`
(neon-serverless). No es una heurística contra la base: un `SELECT
current_setting('transaction_isolation')` no distingue una transacción
propia de la implícita de una sola sentencia, y algo como `SELECT
txid_current_if_assigned()` depende de qué conexión física del pool
ejecuta esa consulta en particular, sin garantía de que sea la misma que
después numera. **Lo que ninguna detección en tiempo de ejecución puede
atrapar:** una `tx` guardada y reusada DESPUÉS de que termine el callback
de `db.transaction(...)` — sigue "siendo" una `PgTransaction`, pero la
conexión física ya volvió al pool. Nunca guardes ni reuses una `tx` fuera
del callback que la recibió.

**Atómico bajo concurrencia**: un único `INSERT ... ON CONFLICT (tenant,
ambito, tipo) DO UPDATE SET proximo = proximo + 1 RETURNING proximo - 1`.
La primera llamada para una combinación nueva crea la fila con `proximo =
2` y devuelve `1`; las siguientes incrementan `proximo` y devuelven el
valor anterior. Se prefirió esto a `SELECT ... FOR UPDATE` + `UPDATE`
porque da las MISMAS garantías (la fila queda bloqueada para cualquier
otra transacción concurrente hasta que esta termina) en una sola ida a la
base en vez de dos. Probado con 100 transacciones concurrentes (cada una
en su propia conexión de un pool de al menos 20) pidiendo el mismo
`(tenant, ambito, tipo)`: dan exactamente `1..100`, sin huecos ni
repetidos (`tests/drizzle/postgres.test.ts`). También probado con 50
transacciones donde cada 3ra hace rollback: los números COMMITEADOS
quedan contiguos desde 1 — el rollback de Postgres deshace el incremento
entero, así que el número que había tomado esa transacción queda
disponible para la próxima que confirme. Y con un test que sostiene el
lock de fila con `pg_sleep` (mezclando rollbacks) y mide el tiempo total,
para probar que la serialización es CONTENCIÓN REAL sobre la fila, no una
casualidad del test.

**Pensada para `READ COMMITTED`**, el aislamiento default de Postgres: ahí
dos transacciones que compiten por LA MISMA fila nunca fallan entre sí, la
segunda simplemente espera a que la primera termine. **Eso no significa
que `READ COMMITTED` esté libre de fallas**: un deadlock (`40P01`) puede
pasar bajo CUALQUIER aislamiento si una transacción numera VARIAS filas
distintas (más de un `(tenant, ambito, tipo)`) y otra transacción
concurrente las pide en el orden contrario — mantené un orden de bloqueo
consistente entre los flujos que puedan competir, y envolvé la transacción
con `conReintento` igual que bajo aislamientos más estrictos. Bajo
`REPEATABLE READ`/`SERIALIZABLE` hay además otra falla: la que pierde la
carrera por una fila puede ABORTAR con `40001` en vez de esperar
(`esFallaDeSerializacion` detecta los dos códigos), y hay que reintentar la
transacción ENTERA con `conReintento` (ver su sección más arriba y el test
con `SERIALIZABLE` en `tests/drizzle/postgres.test.ts`). **No tira
`esChoqueDeUnico`**: el `ON CONFLICT DO UPDATE` absorbe ese choque adentro
de la misma sentencia.

```ts
import { siguienteNumero } from "@mafesoftware/numeradores/drizzle";

const { numero, formateado } = await db.transaction((tx) =>
  siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
);
// numero: 1n, 2n, 3n, ... (bigint)
// formateado: usa el prefijo/relleno configurados en la fila (ver configurarNumerador)

// Con ámbito (una serie por sucursal, por ejemplo):
await db.transaction((tx) => siguienteNumero(tx, numeradores, { tenantId, ambito: "sucursal-2", tipo: "recibo" }));

// Sin transacción: tira ErrorNumeradores("requiere_transaccion")
await siguienteNumero(db, numeradores, { tenantId, tipo: "recibo" }); // ❌
```

#### `configurarNumerador(tx, tabla: TablaNumeradores, opciones: { tenantId: string; ambito?: string | null; tipo: string; prefijo?: string; relleno?: number; proximo?: bigint }): Promise<void>`

Crea o reconfigura el numerador de `(tenantId, ambito, tipo)`: `prefijo`,
`relleno` y, sobre todo, `proximo`. Pensado para dar de alta un talonario
nuevo o para migrar un talonario que ya emitió números fuera del sistema
(papel, otro sistema).

**Es un merge parcial, no un reemplazo completo.** El campo que NO se pasa
conserva lo que la fila YA TENÍA — solo si la fila es nueva, los campos
omitidos toman el default de la columna (`""`/`0`/`1n`). Si fuera un
reemplazo completo, migrar `proximo` de un talonario que ya tenía
`prefijo: "R-"` configurado (sin volver a pasar `prefijo`) borraría el
prefijo en silencio — es exactamente el bug que reportó la revisión de esta
tarea. Es un único `INSERT ... ON CONFLICT DO UPDATE` con
`coalesce(<valor nuevo o null si se omitió>, <valor por defecto o actual de
la fila>)` en cada campo.

**Nunca baja `proximo`**: hacerlo generaría números repetidos con los que
ya se emitieron. Si `proximo` se pasa y es MENOR al valor actual de la
fila, tira `ErrorNumeradores("retroceso_no_permitido")` y no cambia NADA —
ni siquiera `prefijo`/`relleno` (todo-o-nada). Pasar el mismo valor que ya
tiene (o no pasar `proximo`) no es un retroceso: se acepta (idempotente —
re-correr el mismo seed dos veces no falla). El chequeo es atómico (el
`WHERE` del `DO UPDATE` compara contra la fila actual dentro de la misma
sentencia), no un `SELECT` seguido de un `UPDATE` condicional en la app:
entre esas dos sentencias podría meterse un `siguienteNumero` concurrente
que avanza `proximo`, y el `UPDATE` de la app lo pisaría sin que nadie se
entere.

**Valida antes de tocar la base**: `proximo` (si se pasa) tiene que ser
`>= 1n` (`ErrorNumeradores("proximo_invalido")`); `relleno` (si se pasa)
tiene que ser un entero `>= 0` (`ErrorNumeradores("relleno_invalido")`).

No exige transacción (a diferencia de `siguienteNumero`): es una sola
sentencia atómica, se puede llamar con `db` directo.

```ts
import { configurarNumerador, ErrorNumeradores } from "@mafesoftware/numeradores/drizzle";

// Alta de un talonario nuevo, con prefijo y relleno.
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "R-", relleno: 4 });

// Migrar ESE MISMO talonario: en papel ya llegó al 500, el próximo es 501.
// prefijo/relleno NO se pasan de nuevo, así que se conservan ("R-"/4) — el
// siguiente número sale "R-0501", no "0501".
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 501n });

// Reconfigurar SOLO el prefijo de un talonario ya en uso: proximo no se
// toca (nunca es un retroceso, porque no se está tocando).
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "REC-" });

// Re-correr el mismo seed (mismos valores) es idempotente: no falla.
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 501n });

// Intentar bajarlo (ya está en 501, piden volver a 10):
try {
  await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 10n });
} catch (error) {
  if (error instanceof ErrorNumeradores) error.codigo; // "retroceso_no_permitido"
}

// proximo/relleno inválidos:
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", proximo: 0n }); // ErrorNumeradores("proximo_invalido")
await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", relleno: -1 }); // ErrorNumeradores("relleno_invalido")
```

## Postgres para los tests de `/drizzle`

`tests/drizzle/postgres.test.ts` prueba las garantías de concurrencia
contra Postgres real — no hay mock que valga para el bloqueo de fila, el
comportamiento de rollback y las fallas de serialización que las
sostienen: 100 transacciones concurrentes bajo `READ COMMITTED` (gapless
1..100), 50 con rollbacks mezclados (committed gapless), un `pg_sleep`
sosteniendo el lock para probar contención real (no una casualidad de
scheduling), 20 transacciones concurrentes bajo `SERIALIZABLE` con
`conReintento` envolviendo la transacción entera, ámbitos/tenants
independientes, la secuencia de migración documentada arriba (prefijo se
conserva), un `proximo` por encima de 2_147_483_647 (el máximo de un int4
— sin el cast explícito a `::bigint`, Postgres infiere mal el tipo del
parámetro y `configurarNumerador` tira `22003` tanto insertando como
actualizando), y las validaciones de `configurarNumerador`. El DDL que ejecuta
no está escrito a mano: sale del MISMO esquema de Drizzle que arma
`tablaNumeradores` (`tests/drizzle/esquema.ts`), generado con
`drizzle-kit/api` (`generateDrizzleJson` + `generateMigration`) — igual que
`sql/ejemplo.sql`, la referencia para consumidores sin Drizzle.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, ese archivo FALLA con
un mensaje claro (no se saltea en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz),
compartida con `packages/tenant`. `tests/drizzle/config.test.ts` (la
verificación estructural con `getTableConfig`, sin tocar la base) corre
siempre, con o sin Docker. `bun run test:sin-db` excluye solo
`postgres.test.ts`.

A diferencia de `packages/tenant` (que aísla cada corrida con su propio
`pgSchema`), acá el aislamiento entre corridas es por NOMBRE DE TABLA en
`public`: la firma pública de `tablaNumeradores` no tiene un parámetro de
schema de Postgres, y agregarle uno solo para este test reimplementaría la
tabla en vez de ejercitar la real (ver el comentario en
`tests/drizzle/esquema.ts`).
