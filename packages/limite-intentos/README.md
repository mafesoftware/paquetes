# @mafesoftware/limite-intentos

Freno a la fuerza bruta en el ingreso (login/attempt throttling), persistido
**siempre en Postgres** — nunca en memoria: en Vercel cada request puede
caer en otra instancia (y las funciones se reciclan), así que un contador en
RAM se reinicia solo y no frena nada.

Se cuenta por **cuenta** (`claveCuenta`) y por **IP** (`claveIp`) — las dos
hacen falta:

- Por cuenta frena el ataque clásico: mil contraseñas contra un mail.
- Por IP frena el *spraying*: una contraseña ("club2026") contra mil mails
  distintos, que no mueve ningún contador por cuenta.

Núcleo **puro**: sin variables de entorno, sin framework, sin base de
datos. Lo específico de Drizzle (la tabla y las tres operaciones que la
usan) vive en el subpath `/drizzle` (`drizzle-orm` como peerDependency
opcional, `>=0.45 <0.46`).

```bash
bun add @mafesoftware/limite-intentos
```

## API

### Núcleo (`@mafesoftware/limite-intentos`)

#### `claveCuenta(email: string): string`

La clave (PK de la tabla) de una CUENTA: baja a minúsculas y recorta
espacios antes de prefijar con `"cuenta:"`, para que variar mayúsculas o
espacios no sirva para evadir el freno. Tira `ErrorLimiteIntentos` si
`email` está vacío.

```ts
import { claveCuenta } from "@mafesoftware/limite-intentos";

claveCuenta("  Ana@Club.com "); // "cuenta:ana@club.com"
```

#### `claveIp(ip: string): string`

La clave de una IP: recorta espacios y prefija con `"ip:"` — NO baja a
minúsculas (una IPv4/IPv6 no gana nada normalizando el caso). Queda en su
propio espacio de nombres, separado de `claveCuenta`: el mismo texto nunca
choca entre las dos. Tira `ErrorLimiteIntentos` si `ip` está vacía.

```ts
import { claveIp } from "@mafesoftware/limite-intentos";

claveIp("203.0.113.7"); // "ip:203.0.113.7"
```

#### `ErrorLimiteIntentos`

El único error que tira este paquete, siempre por un error de programación
(una clave vacía, o una opción numérica que no es un entero finito
positivo) — nunca por datos que mandó quien intenta iniciar sesión.
`codigo: "opciones_invalidas"`.

```ts
import { ErrorLimiteIntentos, claveCuenta } from "@mafesoftware/limite-intentos";

try {
  claveCuenta("");
} catch (error) {
  if (error instanceof ErrorLimiteIntentos) error.codigo; // "opciones_invalidas"
}
```

### Drizzle (`@mafesoftware/limite-intentos/drizzle`)

#### `tablaIntentos(opciones?: { nombre?; columnasExtra? }): TablaIntentos`

La tabla del freno: `clave` (`text`, PRIMARY KEY — `claveCuenta(email)` o
`claveIp(ip)`), `contador` (`integer`, default `0`), `ventana_desde`
(`timestamptz`, default `now()`), `bloqueado_hasta` (`timestamptz`,
nullable) y `actualizado_en` (`timestamptz`, default `now()`).

Sin columna de tenant: ninguna función de este paquete recibe ni escribe un
`tenantId` — todas operan solo por `clave`. Si tu app necesita filtrar o
reportar por tenant, agregala vos como una columna más en `columnasExtra`
(este paquete no la va a tocar).

```ts
import { tablaIntentos } from "@mafesoftware/limite-intentos/drizzle";

// Con los defaults: tabla "limite_intentos".
export const limiteIntentos = tablaIntentos();

// Con otro nombre de tabla:
export const limiteIntentosTienda = tablaIntentos({ nombre: "limite_intentos_tienda" });
```

#### `registrarIntento(db, tabla, { clave, maximo, ventanaMs, bloqueoMs, ahora? }): Promise<{ permitido; restantes; desbloqueaEn }>`

Registra UN intento fallido para `clave` y devuelve si, después de este
registro, se puede seguir intentando. **No exige transacción**: es una
única sentencia SQL atómica (`INSERT ... ON CONFLICT (clave) DO UPDATE`),
así que se puede llamar con `db` directo o con una `tx`.

**Ventana fija con auto-reinicio**: si `ventana_desde` es anterior a
`ahora - ventanaMs`, arranca una ventana nueva (`contador = 1`,
`ventana_desde = ahora`); si la ventana sigue vigente, incrementa
`contador`. En los dos casos, si el `contador` resultante llega a
`maximo`, fija `bloqueado_hasta = ahora + bloqueoMs` — y si sigue llegando
fuerza bruta dentro del bloqueo (y de la ventana), cada intento nuevo
**extiende** `bloqueado_hasta`, en vez de vencer a mitad de un ataque
sostenido.

**El bloqueo no se limpia solo**: `bloqueado_hasta` se queda con la fecha
fijada aunque ya haya pasado — lo que cambia es que una lectura posterior
(`registrarIntento` o `consultarIntento`) la compara contra un `ahora` más
nuevo y ya no la encuentra "en el futuro". Sin cron de "desbloqueo".

**Atómico bajo concurrencia**, con un único `INSERT ... ON CONFLICT DO
UPDATE`: dos llamadas concurrentes para la MISMA `clave` se serializan una
detrás de la otra en el lock de esa fila — ninguna pisa el incremento de la
otra (probado con 20 llamadas verdaderamente concurrentes contra Postgres
real, cada una con su propia conexión de un pool de 20+, en
`tests/drizzle/postgres.test.ts`).

**Valida antes de tocar la base**: `clave` no puede estar vacía;
`maximo`/`ventanaMs`/`bloqueoMs` tienen que ser enteros finitos `>= 1` —
todo tira `ErrorLimiteIntentos("opciones_invalidas")`.

```ts
import { registrarIntento } from "@mafesoftware/limite-intentos/drizzle";
import { claveCuenta } from "@mafesoftware/limite-intentos";

const { permitido, restantes, desbloqueaEn } = await registrarIntento(db, limiteIntentos, {
  clave: claveCuenta(email),
  maximo: 10,
  ventanaMs: 15 * 60_000,
  bloqueoMs: 15 * 60_000,
});
if (!permitido) {
  // "Demasiados intentos, probá de nuevo después de desbloqueaEn"
}
```

#### `consultarIntento(db, tabla, { clave, ahora? }): Promise<{ contador; ventanaDesde; bloqueado; desbloqueaEn }>`

Lee el estado de `clave` SIN escribir nada — no cuenta como un intento.
Pensada para chequear ANTES de intentar autenticar (evita gastar el costo
de comparar contraseña con bcrypt/argon2 en una cuenta ya bloqueada). No
recibe `maximo`: `bloqueado`/`desbloqueaEn` salen únicamente de comparar
`bloqueado_hasta` contra `ahora`. Si la clave nunca registró ningún
intento, devuelve `{ contador: 0, ventanaDesde: null, bloqueado: false,
desbloqueaEn: null }`.

```ts
import { consultarIntento } from "@mafesoftware/limite-intentos/drizzle";
import { claveCuenta } from "@mafesoftware/limite-intentos";

const { bloqueado, desbloqueaEn } = await consultarIntento(db, limiteIntentos, { clave: claveCuenta(email) });
if (bloqueado) {
  // "Demasiados intentos, probá de nuevo después de desbloqueaEn" — sin llegar a comparar la contraseña.
}
```

#### `limpiarIntentos(db, tabla, clave): Promise<void>`

Borra la fila de `clave` — se llama cuando el intento SALIÓ BIEN (login
correcto), para que la cuenta/IP arranque limpia la próxima vez que alguien
se equivoque. No limpia la IP automáticamente al limpiar la cuenta (una IP
puede tener muchas cuentas detrás): quien llama decide si también quiere
limpiar `claveIp(ip)`.

```ts
import { limpiarIntentos } from "@mafesoftware/limite-intentos/drizzle";
import { claveCuenta } from "@mafesoftware/limite-intentos";

// Login correcto: limpia el contador de la cuenta (no el de la IP).
await limpiarIntentos(db, limiteIntentos, claveCuenta(email));
```

## Flujo completo

```ts
import { tablaIntentos, registrarIntento, consultarIntento, limpiarIntentos } from "@mafesoftware/limite-intentos/drizzle";
import { claveCuenta, claveIp } from "@mafesoftware/limite-intentos";

export const limiteIntentos = tablaIntentos();

async function ingresar(email: string, contrasena: string, ip: string) {
  const cuenta = claveCuenta(email);
  const ipClave = claveIp(ip);

  // 1) Chequear ANTES de comparar contraseña (evita el costo de bcrypt en una cuenta ya bloqueada).
  const previo = await consultarIntento(db, limiteIntentos, { clave: cuenta });
  if (previo.bloqueado) throw new Error("demasiados intentos");

  const credencialesOk = await verificarContrasena(email, contrasena);
  if (!credencialesOk) {
    // 2) Falló: registrar por cuenta Y por IP.
    const [porCuenta] = await Promise.all([
      registrarIntento(db, limiteIntentos, { clave: cuenta, maximo: 10, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000 }),
      registrarIntento(db, limiteIntentos, { clave: ipClave, maximo: 30, ventanaMs: 15 * 60_000, bloqueoMs: 15 * 60_000 }),
    ]);
    throw new Error(porCuenta.permitido ? "credenciales inválidas" : "demasiados intentos");
  }

  // 3) Login correcto: limpiar el contador de la cuenta (la IP se deja como está).
  await limpiarIntentos(db, limiteIntentos, cuenta);
}
```

## Postgres para los tests de `/drizzle`

`tests/drizzle/postgres.test.ts` prueba las garantías de concurrencia
contra Postgres real — no hay mock que valga para el bloqueo de fila que
las sostiene: 10 fallos que bloquean con el reloj inyectado, el bloqueo que
se extiende si sigue llegando fuerza bruta, el desbloqueo (por lectura,
sin escritura) una vez que pasa `bloqueoMs`, el reinicio de ventana sin
llegar al máximo, cuenta e IP independientes, 20 llamadas VERDADERAMENTE
concurrentes sobre la misma clave (contador final exactamente 20, probado
con un pool de 20+ conexiones y también con `pg_sleep` sosteniendo el lock
de fila para confirmar contención real), `limpiarIntentos` y las
validaciones. El DDL que
ejecuta no está escrito a mano: sale del MISMO esquema de Drizzle que arma
`tablaIntentos` (`tests/drizzle/esquema.ts`), generado con
`drizzle-kit/api` — igual que `sql/ejemplo.sql`.

Levantalo con `docker compose up -d db_test` desde la raíz del monorepo
antes de correr `bun run test` — si no está arriba, ese archivo FALLA con
un mensaje claro (no se saltea en silencio). La conexión la arma
`poolDePrueba()` (`tests/lib/postgres-de-prueba.ts` en la raíz).
`tests/drizzle/config.test.ts` (la verificación estructural con
`getTableConfig`, sin tocar la base) corre siempre, con o sin Docker. `bun
run test:sin-db` excluye solo `postgres.test.ts`.

El aislamiento entre corridas es por NOMBRE DE TABLA en `public` (la firma
pública de `tablaIntentos` no tiene un parámetro de schema de Postgres),
igual que `packages/numeradores`.
