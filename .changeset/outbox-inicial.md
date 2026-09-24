---
"@mafesoftware/outbox": minor
---

Primer release del paquete (0.1.0): outbox transaccional para correo y
WhatsApp — la app encola un mensaje en la MISMA transacción que el hecho de
negocio que lo dispara (`encolar`, exige transacción) y un cron aparte lo
procesa (`procesarOutbox`) con reintentos, backoff con jitter y `FOR UPDATE
SKIP LOCKED`. El correo/WhatsApp nunca se manda DENTRO de la transacción de
negocio.

- **Núcleo puro** (sin DB, sin framework, sin `process.env`):
  - `decidir(mensaje, ahora)`: `"enviar" | "reintentar_luego" | "descartar"
    | "destrabar" | "esperar"` según `estado`/`intentos`/`programadoPara`/
    `proximoIntentoEn`/`bloqueadoHasta` — la misma regla, en JS puro, que
    implementa en SQL la consulta de reclamo de `procesarOutbox`.
  - `backoff(intento, { base?, factor?, tope?, jitter?, aleatorio? })`:
    milisegundos con crecimiento exponencial y jitter, `aleatorio`
    inyectable para tests deterministas. Valida las opciones y tira
    `ErrorOutbox("opciones_invalidas")` si no tienen sentido.
  - `clasificarResultado(resultado)`: `"ok" | "transitorio" | "permanente"`.
    Transitorio: `red`, `limite`, y cualquier categoría NO catalogada
    (default seguro: nunca se descarta un mensaje real por una categoría
    nueva sin enumerar). Permanente: `credenciales`, `rechazado`,
    `facturacion`, `plantilla`, `numero`, `ventana` — las mismas categorías
    de `@mafesoftware/correo`/`@mafesoftware/kapso-wa`, sin importar
    ninguno de los dos paquetes (`categoria` es `string`, no una unión
    literal atada a un proveedor). `ventana` (la ventana de servicio de 24h
    de WhatsApp) es permanente PARA EL TEXTO LIBRE que la violó — la app
    tiene que mandar una plantilla en su lugar, documentado en el README.
  - `transporteCorreo({ enviar, remitente, render })` /
    `transporteWhatsApp({ credencialesDe, enviar, parametrosDe? })`: adaptan
    `@mafesoftware/correo`/`@mafesoftware/kapso-wa` a la forma `Transporte`
    que usa `procesarOutbox`, **sin depender de ninguno de los dos paquetes
    en tiempo de ejecución** — la función real que manda se inyecta.
    `transporteWhatsApp` busca las credenciales POR TENANT
    (`credencialesDe(tenantId)`, cada uno tiene su propio número); sin
    credenciales, `categoria: "credenciales"` sin intentar el envío.
  - `ErrorOutbox` (`codigo: "requiere_transaccion" | "opciones_invalidas"`):
    el único error que tira este paquete.
- **`/drizzle`** (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
  opcional; usa `@mafesoftware/tenant/drizzle` para la columna de tenant):
  - `tablaOutbox({ tenant?, nombre?, columnasExtra? })`: la tabla de la
    cola (`canal`, `destino`, `plantilla`, `datos` jsonb,
    `clave_idempotencia`, `estado`, `intentos`/`max_intentos`,
    `programado_para`, `proximo_intento_en`, `bloqueado_hasta`,
    `ultimo_error_categoria`/`ultimo_error_codigo` — nunca el error crudo
    del proveedor —, `id_externo`, `enviado_en`). Único índice `(tenant,
    clave_idempotencia)`; índice `(estado, proximo_intento_en)`.
  - `encolar(tx, tabla, { tenantId, canal, destino, plantilla, datos?,
    claveIdempotencia, programadoPara?, maxIntentos? })`: **exige
    transacción** (`ErrorOutbox("requiere_transaccion")` si no) e
    **idempotente** por `(tenantId, claveIdempotencia)` (`INSERT ... ON
    CONFLICT DO NOTHING`, devuelve `{ id, nuevo: false }` con el id
    existente si ya había una fila, SIN tocarla). `programadoPara` por
    defecto se calcula con el reloj de JS al llamar a `encolar` (no `now()`
    de Postgres): `procesarOutbox` compara contra su propio `ahora()`
    (también JS, inyectable) — mezclar las dos fuentes de reloj en la MISMA
    comparación se rompe con el drift de reloj real entre el host y el
    contenedor de Postgres de test de esta máquina (Colima), reproducido
    escribiendo los tests de este paquete.
  - `procesarOutbox({ db, tabla, transportes: { correo?, whatsapp? }, lote?,
    ahora?, leaseMs? })`: reclama hasta `lote` (`20` por defecto) filas
    debidas con un único `WITH ... SELECT ... FOR UPDATE SKIP LOCKED ...
    UPDATE ... RETURNING` (transacción corta), llama al `Transporte` de
    cada canal FUERA de esa transacción, y registra el resultado en su
    propia transacción corta por fila. Nunca tira por un fallo de
    `Transporte` (excepción o resultado `{ ok: false }`, tratado como
    transitorio); sí propaga un fallo de la base (no hay forma segura de
    "tratar como transitorio" un fallo del que no se sabe si la fila quedó
    reclamada). Un canal sin `Transporte` configurado descarta sus mensajes
    con `categoria: "credenciales"` (problema de despliegue, no de
    reintento). `leaseMs` (`600_000` = 10 min por defecto): una fila
    `"procesando"` cuyo lease venció (worker caído a mitad de camino) se
    reclama de nuevo, contando como un intento más. Devuelve `{ reclamados,
    enviados, reintentar, fallidos, descartados }`.

Postgres de test compartido con el resto de los paquetes `/drizzle` de este
monorepo (`tests/lib/postgres-de-prueba.ts`). `tests/drizzle/postgres.test.ts`
prueba contra Postgres real: idempotencia de `encolar`, rollback de la
transacción que encola, `encolar` fuera de transacción, reintento con
backoff tras un fallo transitorio (con `ahora` inyectado), `fallido` al
agotar `maxIntentos`, descarte inmediato en cada categoría permanente
(`credenciales`/`rechazado`/`facturacion`/`ventana`), reclamo de una fila
`"procesando"` con el lease vencido (y que NO se reclama con el lease
vigente), `programado_para` futuro sin enviar, un `Transporte` que tira
tratado como transitorio, y — el test central de esta tarea — dos
`procesarOutbox` concurrentes contra la misma cola: nunca mandan el mismo
mensaje dos veces (prueba dura, garantizada por `SKIP LOCKED`) y de verdad
se solapan en el tiempo (prueba con ventanas de tiempo reales de un
transporte lento, no solo "los dos terminaron rápido" — cada corrida limita
su propio lote a la mitad de los mensajes debidos, así que las DOS
necesariamente reclaman filas sea cual sea el orden real de ejecución).
`bun run test:sin-db` excluye `postgres*.test.ts`. Cobertura del núcleo
≥95% (statements/branches/functions/lines).
