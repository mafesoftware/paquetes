# @mafesoftware/outbox

Outbox transaccional para correo y WhatsApp: la app encola un mensaje
(`encolar`) en la MISMA transacción que el hecho de negocio que lo dispara
(un pedido creado, una cuota vencida) y un cron aparte lo procesa
(`procesarOutbox`) con reintentos, backoff con jitter y `FOR UPDATE SKIP
LOCKED` — el correo o el WhatsApp NUNCA se mandan DENTRO de la transacción
de negocio (un proveedor caído no puede colgar ni abortar la operación
real), y nunca se pierde un aviso porque el proceso se cayó justo después de
confirmar la fila principal.

**Entrega AL MENOS UNA VEZ, no exactamente una vez.** `FOR UPDATE SKIP
LOCKED` evita que DOS workers tengan la MISMA fila reclamada (con un lease
vigente) a la vez — no evita que un worker le pida al proveedor que mande el
mensaje, se caiga ANTES de registrar el resultado, y que otro worker la
reclame de nuevo más tarde y la mande OTRA VEZ (justo lo que se espera que
pase: si no, un worker caído perdería el mensaje para siempre). La única
defensa real contra ESE duplicado es que el proveedor reconozca una clave de
idempotencia propia — por eso `transporteCorreo` pasa
`MensajeParaEnviar.claveIdempotencia` como header `Idempotency-Key` de
Resend (ver `@mafesoftware/correo`). **Lo mismo vale para un timeout**: si
`procesarOutbox` aborta la `señal` de un intento porque tardó más que
`timeoutMs`, el proveedor puede haber recibido el pedido igual y entregarlo
más tarde — abortar corta el pedido de ESTE lado, no lo deshace del otro.
Ver "Entrega al menos una vez" en el JSDoc de `procesarOutbox` para el
detalle completo, incluida la protección contra que un worker "zombi" pise
lo que otro ya escribió (fencing por lease) y contra que la cola del pool
(`concurrencia`) haga que una fila se intente mandar con el lease ya casi
vencido.

La entrega usa los paquetes que ya existen en este monorepo — nunca los
reimplementa:

- `@mafesoftware/correo` (Resend): nunca tira, devuelve resultados
  categorizados (`credenciales`, `rechazado`, `limite`, `red`), y acepta
  `claveIdempotencia` (header `Idempotency-Key`).
- `@mafesoftware/kapso-wa` (WhatsApp): credenciales POR LLAMADA (cada
  tenant/desarrollador tiene su propio número), categorías propias
  (`credenciales`, `rechazado`, `facturacion`, `plantilla`, `numero`,
  `ventana`, además de `red`/`limite`). **No tiene clave de idempotencia
  propia** — un reintento de WhatsApp puede llegarle dos veces al
  destinatario; ver el JSDoc de `transporteWhatsApp`.

`transporteCorreo`/`transporteWhatsApp` los adaptan a la forma `Transporte`
que usa `procesarOutbox` — **sin depender de ninguno de los dos paquetes en
tiempo de ejecución**: la función real que manda (`enviarCorreo`,
`enviarPlantilla`) se inyecta, así que este paquete ni siquiera los importa.

Núcleo **puro**: sin variables de entorno, sin framework, sin base de
datos. Lo específico de Drizzle (la tabla y las operaciones que la usan)
vive en el subpath `/drizzle` (`drizzle-orm` como peerDependency opcional,
`>=0.45 <0.46`), y usa `@mafesoftware/tenant/drizzle` para la columna de
tenant.

```bash
bun add @mafesoftware/outbox
```

La documentación de cada función está en `src/`, con el motivo de cada
decisión al lado. Los tests (`tests/`) son la otra mitad de la
documentación — en particular `tests/drizzle/postgres.test.ts`, que prueba
las garantías de concurrencia (`FOR UPDATE SKIP LOCKED`, fencing por lease,
dos `procesarOutbox` a la vez) contra Postgres real.

## API

### Núcleo (`@mafesoftware/outbox`)

#### `decidir(mensaje: MensajeParaDecidir, ahora: Date): Decision`

Qué corresponde hacer con una fila de la cola en `ahora`:
`"enviar" | "reintentar_luego" | "descartar" | "destrabar" | "esperar"` — la
misma regla, en JS puro, que implementa en SQL la consulta de reclamo de
`procesarOutbox` (misma comparación `<=` inclusive para el lease vencido en
las dos). Nunca tira.

```ts
import { decidir } from "@mafesoftware/outbox";

const ahora = new Date("2026-09-24T12:00:00Z");

decidir(
  { estado: "pendiente", intentos: 0, maxIntentos: 5, programadoPara: new Date("2026-09-24T11:00:00Z"), proximoIntentoEn: null, bloqueadoHasta: null },
  ahora,
); // "enviar"

decidir(
  { estado: "procesando", intentos: 1, maxIntentos: 5, programadoPara: ahora, proximoIntentoEn: null, bloqueadoHasta: new Date("2026-09-24T11:45:00Z") },
  ahora,
); // "destrabar": el lease venció, el worker que la tenía se cayó
```

#### `backoff(intento: number, opciones?: OpcionesBackoff): number`

Cuánto esperar (ms) antes del intento número `intento` (0-based), con
crecimiento exponencial y jitter. `{ base?, factor?, tope?, jitter?,
aleatorio? }`, todas opcionales (`30_000` / `2` / `3_600_000` / `0.2` /
`Math.random` por defecto). Valida las opciones y tira `ErrorOutbox` si no
tienen sentido.

```ts
import { backoff } from "@mafesoftware/outbox";

backoff(0); // ~30_000 ± 20% (24_000..36_000)
backoff(1); // ~60_000 ± 20%: se duplicó
backoff(10); // 3_600_000 ± 20%: recortado al tope de 1h

// Determinista para tests: aleatorio fijo en el centro del rango da jitter 0.
backoff(2, { base: 1000, factor: 3, tope: 10_000, jitter: 0, aleatorio: () => 0.5 }); // 9_000
```

#### `clasificarResultado(resultado: ResultadoTransporte): ClaseResultado`

Clasifica el resultado de un `Transporte` en `"ok" | "transitorio" |
"permanente"`. Transitorio: `red`, `limite`, `conflicto_idempotencia` (HTTP
409 de Resend: la misma `Idempotency-Key` con un cuerpo distinto — ver
`@mafesoftware/correo`) y cualquier categoría NO catalogada (default
seguro, ver el JSDoc). Permanente: `credenciales`, `rechazado`,
`facturacion`, `plantilla`, `numero`, `ventana`.

```ts
import { clasificarResultado } from "@mafesoftware/outbox";

clasificarResultado({ ok: true, idExterno: "msg_123" }); // "ok"
clasificarResultado({ ok: false, categoria: "red" }); // "transitorio"
clasificarResultado({ ok: false, categoria: "ventana" }); // "permanente": mandar una plantilla, no reintentar el texto libre
```

`CATEGORIAS_TRANSITORIAS`/`CATEGORIAS_PERMANENTES` (`ReadonlySet<string>`)
son las listas que usa por dentro — públicas para quien quiera iterarlas
(ej. un test propio, o un panel de admin que agrupe por clase).

#### `transporteCorreo(opciones: OpcionesTransporteCorreo): Transporte`

Adapta `@mafesoftware/correo` a `Transporte`. `{ enviar, remitente, render
}`: `enviar` es la función que de verdad manda (normalmente `enviarCorreo`
con la `apiKey` ya aplicada por closure — recibe `claveIdempotencia`, que
`enviarCorreo` reenvía como header `Idempotency-Key` a Resend), `render`
arma `{ asunto, html?, texto? }` a partir de `plantilla`/`datos` del
mensaje. Si `render` tira, se clasifica `{ ok: false, categoria: "plantilla",
codigo: "render" }` (PERMANENTE: el mismo mensaje mal armado no se arregla
reintentando) — `enviar`, en cambio, no tiene try/catch propio, porque
`procesarOutbox` ya atrapa cualquier excepción de un `Transporte` como
transitorio. `contexto.señal` se reenvía tal cual a `enviar` (como
`opciones.señal`) — `(o) => enviarCorreo({ ...o, apiKey })` ya la pasa sola
al `fetch` de Resend. Valida las opciones al construirlo.

```ts
import { transporteCorreo } from "@mafesoftware/outbox";
import { enviarCorreo } from "@mafesoftware/correo";

const correo = transporteCorreo({
  remitente: "Mi Club <no-reply@miclub.com.ar>",
  enviar: (o) => enviarCorreo({ ...o, apiKey: apiKeyDeResend }), // apiKeyDeResend: leída de la config de la app
  render: (mensaje) => {
    if (mensaje.plantilla === "bienvenida") {
      const { nombre } = mensaje.datos as { nombre: string };
      return { asunto: `Hola, ${nombre}!`, html: `<p>Bienvenido, ${nombre}.</p>` };
    }
    throw new Error(`plantilla desconocida: ${mensaje.plantilla}`); // -> descartado sin reintentar
  },
});

const resultado = await correo(
  { id, tenantId, canal: "correo", destino: "socio@mail.com", plantilla: "bienvenida", datos: { nombre: "Ana" }, claveIdempotencia: `${tenantId}:bienvenida-${id}` },
  { señal: new AbortController().signal },
);
```

#### `transporteWhatsApp(opciones: OpcionesTransporteWhatsApp): Transporte`

Adapta `@mafesoftware/kapso-wa` a `Transporte`. `{ credencialesDe, enviar,
parametrosDe? }`: `credencialesDe(tenantId)` busca las credenciales DEL
TENANT (cada uno tiene su propio número) — **puede ser async**, y SIEMPRE
se espera (`await`) antes de usarla (una versión anterior de este paquete
tenía el bug de no esperarla: una `Promise` sin resolver es un objeto
TRUTHY, así que el chequeo de "sin credenciales" nunca disparaba). `null`/
`undefined` (resuelto) da `categoria: "credenciales"` sin intentar el
envío; si `credencialesDe` RECHAZA, se trata como `"transitorio"` (`codigo:
"credenciales_excepcion"`). `enviar` siempre manda una PLANTILLA (nunca
texto libre: la ventana de 24h no se puede garantizar para un mensaje que
se procesa minutos u horas después) y recibe `claveIdempotencia` como
quinto argumento y `contexto.señal` como sexto — `kapso-wa` hoy no hace
nada con ninguno de los dos (sus funciones arman su propio
`AbortController` interno, sin aceptar una señal externa, y no tiene
mecanismo de idempotencia propio) — se pasan igual por si tu propio
`enviar` sabe qué hacer con ellos. Si `parametrosDe` tira, se clasifica
igual que `render` en `transporteCorreo` (`{ ok: false, categoria:
"plantilla", codigo: "render" }`, permanente).

```ts
import { transporteWhatsApp } from "@mafesoftware/outbox";
import { enviarPlantilla, type Credenciales } from "@mafesoftware/kapso-wa";

const whatsapp = transporteWhatsApp({
  credencialesDe: (tenantId) => buscarCredencialesDelTenant(tenantId), // async: undefined si el tenant no configuró WhatsApp
  enviar: (cred, destino, plantilla, parametros) => enviarPlantilla(cred as Credenciales, destino, plantilla, parametros as string[]),
  parametrosDe: (mensaje) => [(mensaje.datos as { turno: string }).turno],
});

const resultado = await whatsapp(
  { id, tenantId, canal: "whatsapp", destino: "5491122334455", plantilla: "gf_turno_manana", datos: { turno: "10:00" }, claveIdempotencia: `${tenantId}:turno-${id}` },
  { señal: new AbortController().signal },
);
```

#### `ErrorOutbox`

El único error que tira este paquete (siempre por un error de
PROGRAMACIÓN): `codigo: "requiere_transaccion" | "opciones_invalidas"`.
`procesarOutbox` es la excepción: nunca tira, ni siquiera esto — ver su
entrada más abajo.

```ts
import { encolar, ErrorOutbox } from "@mafesoftware/outbox/drizzle";

try {
  await encolar(db, outbox, { ... }); // "db" no es una transacción
} catch (error) {
  if (error instanceof ErrorOutbox) error.codigo; // "requiere_transaccion"
}
```

### `/drizzle` (`@mafesoftware/outbox/drizzle`)

Requiere `drizzle-orm >=0.45 <0.46` (peerDependency opcional); usa
`@mafesoftware/tenant/drizzle` para la columna de tenant. Este paquete NO
trae migraciones — ver `sql/ejemplo.sql` para el DDL equivalente.

#### `tablaOutbox(opciones?: OpcionesTablaOutbox): TablaOutbox`

La tabla de la cola: `id`, la columna de tenant, `canal`, `destino`,
`plantilla`, `datos` (`jsonb`), `clave_idempotencia`, `estado`, `intentos`/
`max_intentos`, `programado_para`, `proximo_intento_en`, `bloqueado_hasta`,
`ultimo_error_categoria`/`ultimo_error_codigo` (nunca el error crudo,
`codigo` recortado a 64 caracteres), `id_externo`, `enviado_en`,
`creado_en`/`actualizado_en`. Único índice `(tenant, clave_idempotencia)`;
índice PARCIAL `(estado, proximo_intento_en, programado_para) WHERE estado
in ('pendiente', 'procesando')` — cubre exactamente el `WHERE`/`ORDER BY`
de la consulta de reclamo de `procesarOutbox`, sin crecer con el historial
terminado (`purgarOutbox` lo borra).

**No filtra por tenant al reclamar** — dos tenants/productos que comparten
la MISMA tabla compiten por el mismo `lote` en cada corrida, sin reparto
justo garantizado. Si eso importa, usá tablas separadas
(`tablaOutbox({ nombre })`) por tenant/producto.

```ts
import { tablaOutbox } from "@mafesoftware/outbox/drizzle";

// Con los defaults: tabla "outbox", columna de tenant "organizacion_id" (uuid).
export const outbox = tablaOutbox();

// Con una columna de tenant propia y otro nombre de tabla:
export const avisos = tablaOutbox({ tenant: { columna: "club_id", tipo: "text" }, nombre: "avisos" });
```

#### `encolar(tx: DbCliente, tabla: TablaOutbox, opciones: OpcionesEncolar): Promise<ResultadoEncolar>`

Encola un mensaje. **Exige transacción** (tira
`ErrorOutbox("requiere_transaccion")` si no) — el mensaje solo se debe
encolar si la transacción del hecho de negocio que lo dispara confirma.
**Idempotente** por `(tenantId, claveIdempotencia)`: `INSERT ... ON
CONFLICT DO NOTHING`; devuelve `{ id, nuevo: false }` con el id de la fila
EXISTENTE si ya había una. `claveIdempotencia` tiene que medir entre 1 y
200 caracteres — junto con `tenantId` compone la clave que se le manda al
proveedor (`${tenantId}:${claveIdempotencia}`, ver `MensajeParaEnviar`), y
Resend limita su header `Idempotency-Key` a 256. `programadoPara` (si no
se pasa) se calcula con el reloj de JS, no `now()` de Postgres — ver
"Reloj: JS, no de Postgres" en el JSDoc de `tablaOutbox`.

```ts
import { encolar } from "@mafesoftware/outbox/drizzle";

await db.transaction(async (tx) => {
  await tx.insert(pedidos).values({ id: pedidoId, ... });
  const { id, nuevo } = await encolar(tx, outbox, {
    tenantId,
    canal: "correo",
    destino: cliente.email,
    plantilla: "confirmacion_pedido",
    datos: { pedidoId },
    claveIdempotencia: `confirmacion-pedido-${pedidoId}`,
  });
  // nuevo === false si esta función corrió dos veces para el mismo pedido
  // (ej. un reintento de la request) — el aviso se encola una sola vez.
});
```

#### `procesarOutbox(opciones: OpcionesProcesarOutbox): Promise<ResumenProcesarOutbox>`

Procesa hasta `lote` (`20` por defecto) mensajes debidos: los reclama de
forma atómica (`FOR UPDATE SKIP LOCKED`), llama al `Transporte` de cada
canal (con un tope de `concurrencia` simultáneos, `5` por defecto, y un
`timeoutMs` por intento, `Math.min(60_000, Math.floor(leaseMs / 2))` por
defecto — `60_000`, 1 min, con `leaseMs` en su propio default o más
grande), y registra el resultado — CERROJADO por el lease con el que se
reclamó (ver "Entrega al menos una vez" arriba): si otro worker ya reclamó
la fila de nuevo, el registro se descarta sin pisar nada (`perdidos`),
nunca vuelve la fila a un estado anterior.

`leaseMs` (`600_000` — 10 min — por defecto) tiene que ser un entero finito
`>= 5000`; `timeoutMs`, un entero finito `>= 1000` y `<= leaseMs / 2` (si
no, `ErrorOutbox("opciones_invalidas")`). El default de `timeoutMs`
NUNCA puede violar esa cota por sí solo (el `Math.min` lo garantiza para
cualquier `leaseMs`), así que customizar SOLO `leaseMs` (sin pasar
`timeoutMs`) nunca tira por esto — con un `leaseMs` chico, el default cae
a `Math.floor(leaseMs / 2)` en vez del tope de `60_000`. Las dos
validaciones existen para que "Cola del pool y lease" (abajo) tenga margen
real para decidir "alcanza" o "no alcanza", en vez de un timeout efectivo
de milisegundos.

**Cola del pool y lease.** Todas las filas de un reclamo comparten el mismo
`bloqueado_hasta`, pero con `concurrencia` limitada no todas se procesan al
mismo tiempo — una fila puede esperar su turno mientras otras, antes en la
cola, siguen "en vuelo". Si a una fila le toca el turno cuando ya casi no
le queda lease (menos de `timeoutMs + 1000` ms), `procesarOutbox` NO
intenta mandarla: la libera sola (`"pendiente"`, `intentos - 1`, debida de
nuevo ya mismo — cuenta en `liberados`, o en `perdidos` si para cuando se
escribe esto otro worker ya la reclamó). La fila liberada **conserva su
lugar en la cola** (`proximo_intento_en` no se mueve hacia adelante: queda
en `least(coalesce(proximo_intento_en, programado_para), <momento del
reclamo>)`), así que la próxima corrida la toma antes que lo que llegó
después — nunca pasa hambre bajo carga sostenida. Si sí alcanza el margen, el
intento corre con el `timeoutMs` configurado (nunca un resto corto — por
construcción, el margen exigido para intentar ya deja siempre ese margen).
Sin esto, un lote con `concurrencia` baja y filas lentas podía terminar con
DOS workers mandando la MISMA fila a la vez — reproducido contra Postgres
real.

Si `leaseMs` es corto frente al PEOR caso de esta cola (`timeoutMs *
ceil(lote / concurrencia) + 1000`), `procesarOutbox` no tira — agrega un mensaje a
`resumen.advertencias` (`[]` si no hay ninguno). Nunca se loguea por su
cuenta (ni `console.warn` ni ninguna otra forma): es información para quien
llama, para que decida qué hacer con ella (loguearla, subir `leaseMs`/
`concurrencia`, bajar `lote`, o ignorarla). Con los valores por defecto del
paquete esto NO se dispara (`60_000 * ceil(20 / 5) + 1000 = 241_000 <=
600_000`).

**Nunca tira** — ni por un fallo de `Transporte` (excepción, o que no
responda en el timeout efectivo: los dos se tratan como `"transitorio"`),
NI por un fallo de la BASE (el reclamo del lote, o el registro/liberación
de una fila): se atrapan, se cuentan en `errores`, y el código de Postgres
(nunca el mensaje ni los parámetros) queda en `ultimoError`.

Una fila `"procesando"` cuyo lease venció (`bloqueado_hasta <= ahora`,
inclusive) se reclama de nuevo (`"destrabar"`) — salvo que ya agotó
`maxIntentos` a fuerza de leases vencidos sucesivos (un worker que SIEMPRE
se cae, o SIEMPRE tarda más que el lease): ahí se cierra directo a
`"fallido"` (`codigo: "lease_agotado"`, o `"intentos_agotados"` si venía
`"pendiente"` — salvaguarda) sin llamar a ningún `Transporte` de nuevo —
sin este chequeo, `maxIntentos` no significaría nada para ese caso.

Un fallo `"conflicto_idempotencia"` (ver `clasificarResultado`) agenda su
reintento con un backoff más largo — al menos 60 s, incluso en el primer
intento.

Devuelve `{ reclamados, enviados, reintentar, fallidos, descartados,
perdidos, liberados, errores, advertencias, ultimoError? }`.

```ts
import { procesarOutbox, transporteCorreo, transporteWhatsApp } from "@mafesoftware/outbox/drizzle";

const resumen = await procesarOutbox({
  db,
  tabla: outbox,
  transportes: {
    correo: transporteCorreo({ remitente, enviar, render }),
    whatsapp: transporteWhatsApp({ credencialesDe, enviar: enviarPlantillaAdaptado }),
  },
  lote: 50,
  concurrencia: 10,
});
// { reclamados: 12, enviados: 10, reintentar: 1, fallidos: 0, descartados: 1, perdidos: 0, liberados: 0, errores: 0, advertencias: [] }
```

#### `purgarOutbox(opciones: OpcionesPurgarOutbox): Promise<ResultadoPurgarOutbox>`

Borra filas TERMINALES (`"enviado"`/`"descartado"`/`"fallido"`, los únicos
estados que acepta) cuyo `actualizado_en` sea anterior a `antesDe` — para
que la cola no crezca sin límite. Este paquete no purga solo: hay que
correrla vos (un cron aparte, o al final del que corre `procesarOutbox`).
Pasar `"pendiente"`/`"procesando"` en `estados` tira
`ErrorOutbox("opciones_invalidas")` — purgar trabajo activo borraría un
mensaje real sin haberlo mandado.

```ts
import { purgarOutbox } from "@mafesoftware/outbox/drizzle";

// Borra lo terminado hace más de 30 días.
const { eliminadas } = await purgarOutbox({
  db,
  tabla: outbox,
  antesDe: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
});

// Solo lo enviado con éxito (conserva descartado/fallido para diagnóstico):
await purgarOutbox({ db, tabla: outbox, estados: ["enviado"], antesDe: haceUnaSemana });
```
