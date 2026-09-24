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
    Transitorio: `red`, `limite`, `conflicto_idempotencia` (HTTP 409 de
    Resend, backoff más largo — ver `procesarOutbox`), y cualquier
    categoría NO catalogada (default seguro: nunca se descarta un mensaje
    real por una categoría nueva sin enumerar). Permanente: `credenciales`,
    `rechazado`,
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
    (`credencialesDe(tenantId)`, cada uno tiene su propio número, puede ser
    async y siempre se espera); sin credenciales, `categoria: "credenciales"`
    sin intentar el envío. `render`/`parametrosDe` que tiran se clasifican
    `{ categoria: "plantilla", codigo: "render" }` (permanente).
  - `ErrorOutbox` (`codigo: "requiere_transaccion" | "opciones_invalidas"`):
    el único error que tira este paquete.
- **`/drizzle`** (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
  opcional; usa `@mafesoftware/tenant/drizzle` para la columna de tenant):
  - `tablaOutbox({ tenant?, nombre?, columnasExtra? })`: la tabla de la
    cola (`canal`, `destino`, `plantilla`, `datos` jsonb,
    `clave_idempotencia`, `estado`, `intentos`/`max_intentos`,
    `programado_para`, `proximo_intento_en`, `bloqueado_hasta`,
    `ultimo_error_categoria`/`ultimo_error_codigo` — nunca el error crudo
    del proveedor, `codigo` recortado a 64 caracteres —, `id_externo`,
    `enviado_en`). Único índice `(tenant, clave_idempotencia)`; índice
    PARCIAL `(estado, proximo_intento_en, programado_para) WHERE estado in
    ('pendiente', 'procesando')` — cubre exactamente la consulta de
    reclamo, sin crecer con el historial terminado.
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
    ahora?, leaseMs?, timeoutMs?, concurrencia? })`: reclama hasta `lote`
    (`20` por defecto) filas debidas con un único `WITH ... SELECT ... FOR
    UPDATE SKIP LOCKED ... UPDATE ... RETURNING` (transacción corta), llama
    al `Transporte` de cada canal FUERA de esa transacción (tope de
    `concurrencia` simultáneos, `5` por defecto; `timeoutMs` por intento,
    `Math.floor(leaseMs / 2)` por defecto), y registra el resultado en su
    propia transacción corta por fila — CERROJADA por el lease exacto con
    el que se reclamó (`estado = 'procesando' and bloqueado_hasta =
    <lease>`), para que un worker "zombi" nunca pise lo que otro worker ya
    haya escrito (se cuenta en `perdidos`). **Nunca tira**: ni por un fallo
    de `Transporte` (excepción o timeout, tratado como transitorio), ni por
    un fallo de la BASE (reclamo o registro, atrapado y contado en
    `errores`/`ultimoError`, solo el código de Postgres, nunca mensaje ni
    parámetros). Un canal sin `Transporte` configurado descarta sus
    mensajes con `categoria: "credenciales"`. `leaseMs` (`600_000` = 10 min
    por defecto): una fila `"procesando"` cuyo lease venció se reclama de
    nuevo, contando como un intento más — salvo que ya agotó `maxIntentos`
    a fuerza de leases vencidos sucesivos, en cuyo caso se cierra directo a
    `"fallido"` (`codigo: "lease_agotado"`) sin llamar a ningún `Transporte`.
    Devuelve `{ reclamados, enviados, reintentar, fallidos, descartados,
    perdidos, liberados, errores, advertencias, ultimoError? }` (`liberados`
    y `advertencias`: ver "Ronda de fix 2"/"Ronda de fix 3" más abajo).
    **Entrega al menos una vez, no exactamente una vez** —
    `MensajeParaEnviar.claveIdempotencia`
    (`${tenantId}:${claveIdempotencia}`) existe para que el proveedor
    deduplique; `transporteCorreo` la reenvía como header `Idempotency-Key`
    de Resend (nuevo en `@mafesoftware/correo`, changeset aparte).
  - `purgarOutbox({ db, tabla, estados?, antesDe })`: borra filas
    TERMINALES (`"enviado"`/`"descartado"`/`"fallido"`, los únicos que
    acepta) con `actualizado_en` anterior a `antesDe`; devuelve
    `{ eliminadas }`.

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

**Ronda de fix 1** (revisión que reprodujo dos bugs de entrega contra
Postgres real antes de esta tarea considerarse cerrada):

- **Crítico — escrituras sin cerrojo:** un worker "zombi" (lease vencido,
  `Transporte` lento) podía sobreescribir con datos viejos una fila que
  OTRO worker ya había cerrado bien (`"enviado"` volvía a `"pendiente"` con
  intentos ya gastados). Arreglado con fencing por lease (ver
  `procesarOutbox` arriba) — reproducido primero con el escenario exacto de
  la revisión, confirmado el bug, después el fix.
- **Crítico — `credencialesDe` async sin `await`:** una `Promise` sin
  resolver es un objeto truthy, así que el chequeo de "sin credenciales"
  nunca disparaba y `enviar` recibía la `Promise` en vez de las
  credenciales reales. Arreglado (`transporteWhatsApp` arriba).
- **Importante:** entrega al menos una vez documentada explícitamente (se
  había afirmado, incorrectamente, que no se duplicaba); `claveIdempotencia`
  nueva en `MensajeParaEnviar`, threaded a Resend; timeout por intento
  (`timeoutMs`, `AbortSignal`); `maxIntentos` respetado también en el
  bucle de reclamos-por-lease-vencido (`"lease_agotado"`, antes crecía sin
  tope); concurrencia acotada con semántica `allSettled`; `procesarOutbox`
  nunca tira NI por fallos de la base; reparto entre tenants documentado
  como ausente (antes se afirmaba, incorrectamente, que estaba
  documentado); `purgarOutbox` nuevo; índice parcial para la consulta de
  reclamo (antes no-parcial, crecía con el historial).
- **Menor:** semántica de reloj documentada (sin referencias a notas de
  máquina específicas); `ultimo_error_codigo` recortado a 64 caracteres;
  `render`/`parametrosDe` que tiran se clasifican permanentes
  (`codigo: "render"`) en vez de transitorios genéricos.

**Ronda de fix 2** (re-revisión: I4 quedó parcial, más un Importante nuevo):

- **Importante — la cola del pool rompía el límite del lease.** Con
  `concurrencia` acotada, las filas de un mismo reclamo (que comparten UN
  solo `bloqueado_hasta`) no se procesan todas al mismo tiempo — una podía
  esperar su turno mientras el lease de TODO el lote seguía corriendo, y
  para cuando le tocaba, ya casi no quedaba margen: si el intento se
  hacía igual, otro worker podía reclamarla y mandarla A LA VEZ (doble
  envío real, reproducido contra Postgres con el escenario exacto de la
  revisión: lote 4, concurrencia 1, lease 1000 ms, timeout 400 ms,
  `Transporte` colgado, un segundo worker arrancando a los 1100 ms).
  Arreglado: antes de llamar al `Transporte`, se recalcula cuánto lease
  queda; si no alcanza margen seguro (`<= timeoutMs`), la fila se LIBERA
  sola (cerrojada, `"pendiente"` de nuevo, `intentos - 1` porque el intento
  nunca se gastó — nuevo balde `liberados` en el resumen) en vez de
  arriesgarse; si sí alcanza, el timeout efectivo de ESE intento se recorta
  a lo que realmente queda de lease. De paso se encontró (con Postgres
  real) que `bloqueado_hasta`, leído por SQL crudo (`tx.execute`, no el
  query builder), vuelve como `string`, no como `Date` — se normaliza una
  vez al reclamar.
  - Se detectó un bug de test (no del paquete): la primera versión de la
    prueba de este escenario medía "no hay dos invocaciones casi
    simultáneas" (una tolerancia de milisegundos), que pasaba igual con el
    código VIEJO (con bug) porque las dos invocaciones quedaban separadas
    por cientos de ms — no detectaba el problema real (que el MISMO
    `Transporte`, para la MISMA fila, fuera invocado por DOS workers
    DISTINTOS, sin importar cuánto tiempo los separara). Reescrita para
    verificar exactamente eso.
- `Transporte` (núcleo) ahora recibe un segundo argumento,
  `{ señal: AbortSignal }`; `transporteCorreo`/`transporteWhatsApp` la
  reenvían a `enviar`. `@mafesoftware/correo` (`enviarCorreo`) acepta una
  `señal` opcional y la pasa al `fetch` (changeset propio).
  `@mafesoftware/kapso-wa` NO la acepta (arma su propio
  `AbortController` interno, sin forma de inyectar uno externo) —
  documentado, no modificado. Documentado en todos lados que abortar por
  timeout NO deshace un envío que el proveedor ya haya aceptado del otro
  lado (parte de "entrega al menos una vez").
- La consulta de reclamo distingue ahora `"lease_agotado"` (venía
  `"procesando"`, el caso real) de `"intentos_agotados"` (venía
  `"pendiente"`, salvaguarda que no debería pasar en el flujo normal) —
  antes los dos usaban el mismo código. `decidir` (núcleo) alineado: una
  fila `"procesando"` con el lease vencido Y los intentos agotados ahora da
  `"descartar"` (antes daba `"destrabar"`, que implica "dale otra
  vuelta" — ya no hay otra vuelta). Nuevo test de PARIDAD que corre el
  mismo conjunto de fixtures por `decidir()` y por la consulta de reclamo
  real contra Postgres, y verifica que dan la misma respuesta.
- `"conflicto_idempotencia"` (HTTP 409 de Resend — la MISMA
  `Idempotency-Key` usada con un cuerpo distinto) nueva categoría
  transitoria, con un backoff de al menos 60 s (más largo que el resto,
  incluso en el primer intento) — la causa más probable es una carrera
  contra el propio caché de idempotencia del proveedor.
  `encolar` valida que `claveIdempotencia` mida entre 1 y 200 caracteres
  (junto con `tenantId` compone la clave real, y Resend limita su header a
  256).
- **OUT OF SCOPE, arreglado de paso:** el conteo de filas afectadas por un
  `UPDATE`/`DELETE` (usado para el fencing y para `purgarOutbox`) ahora
  cae a `rows.length` (vía `RETURNING`) cuando el driver no expone
  `rowCount` (node-postgres siempre lo tiene; algún otro driver, como
  ciertos modos de neon-serverless, puede no traerlo) — sin este
  fallback, esos drivers hubieran hecho que CUALQUIER escritura pareciera
  "no afectó nada" (todo reportado como `perdidos`, en silencio). Probado
  con un `db` de test que envuelve `execute()` y le saca `rowCount` a
  propósito.

**Ronda de fix 3** (re-revisión de la ronda 2: todo lo de esa ronda quedó
bien atado, pero el propio fix abrió dos huecos de configuración, y el test
de L1 pasaba por el motivo equivocado):

- **Importante — `leaseMs`/`timeoutMs` podían configurarse de forma
  insegura (I1+I2).** La validación de la ronda 2 solo exigía `timeoutMs <
  leaseMs` — dejaba pasar, por ejemplo, `leaseMs: 60_000, timeoutMs:
  59_980` (el ejemplo exacto de la revisión): con eso, "Cola del pool y
  lease" (ver el JSDoc de `procesarOutbox`) casi no tiene margen real para
  decidir si alcanza o no, y el timeout efectivo que le quedaba a un
  intento podía terminar siendo de milisegundos — un timeout "espurio".
  Ahora:
  - `timeoutMs` tiene que ser `<= leaseMs / 2` (antes, alcanzaba con `<
    leaseMs`) y `leaseMs` tiene que ser `>= 5000` — las dos, nuevas
    `ErrorOutbox("opciones_invalidas")`.
  - El margen para intentar (en vez de liberar) ahora es `timeoutMs + 1000`
    (antes, `timeoutMs` a secas): con esto, cuando SÍ se intenta, el
    timeout efectivo (`min(timeoutMs, restante - 1000)`) da SIEMPRE
    `timeoutMs` exacto — nunca un resto corto — y el propio clamp tiene un
    piso de `1000 ms` (antes, `1 ms`) como defensa adicional.
  - Nuevo campo `advertencias: string[]` en el resumen (siempre presente,
    `[]` si no hay ninguna, JAMÁS logueado por el paquete): si `leaseMs <
    timeoutMs * ceil(lote / concurrencia)` (el peor caso de cuánto puede
    tardar la ÚLTIMA fila del lote en llegar a su turno con la
    `concurrencia` configurada), no se tira — se avisa. Con los valores
    por defecto (`lote: 20`, `concurrencia: 5`, `timeoutMs:
    leaseMs / 2`) esta advertencia SIEMPRE aparece (`olas = 4`,
    `timeoutMs * 4 = leaseMs * 2 > leaseMs`); quien use `procesarOutbox`
    con lotes grandes y baja concurrencia probablemente la va a ver seguido
    — es información, no un error, y el resumen la trae para que cada
    caller decida (loguearla, ignorarla, ajustar sus opciones).
- **M1 — `bloqueadoHasta` inválido ya no se intenta enviar.** La
  normalización string->Date de `reclamarLote` (ronda 2) no puede tirar
  ante un valor que no puede parsear — da un "Invalid Date"
  (`.getTime()` es `NaN`, nunca una excepción). Sin guarda, `NaN` colado en
  la cuenta de margen de lease (`NaN < minimoRestante` es siempre `false`)
  hacía que se intentara igual el Transporte con un timeout también `NaN`.
  Ahora se chequea antes: si no es un `Date` válido, la fila se cuenta
  `perdidos` sin tocar ningún Transporte.
- **L1, test reescrito.** El test de la ronda 2 usaba timing de pared real
  (lease 1000 ms, un `setTimeout` de 1100 ms para arrancar el segundo
  worker) — con la nueva validación (`leaseMs >= 5000`) esos valores ya ni
  siquiera pasan la validación, y aparte el test pasaba por un motivo más
  débil del que hacía falta. Reescrito con un reloj (`ahora`) inyectado y
  DETERMINÍSTICO en los dos workers (nada de tiempo real de pared): un
  worker A (lote 4, concurrencia 1, lease 6000 ms, timeout 2000 ms)
  intenta las primeras 2 filas de su cola y LIBERA las otras 2 (ya no les
  queda margen de lease para cuando les toca el turno); un worker B,
  arrancando justo en ese instante simulado, reclama EXACTAMENTE esas 2
  filas liberadas. El test verifica, explícitamente: `resumenA.liberados >
  0`; que el conjunto de filas invocadas por A y por B no se solapa; y que
  A invocó el Transporte SOLO para las 2 filas que sí tenían margen, B SOLO
  para las 2 liberadas (nunca al revés). **Prueba de mutación** (hecha a
  mano para esta ronda, documentada en el reporte): se reemplazó
  temporalmente la liberación de `liberarFila` por una llamada directa al
  Transporte — el test FALLÓ como se esperaba — y se restauró el código
  correcto, confirmando que vuelve a pasar. Nuevo test más chico en el
  mismo `describe`, con un reloj inyectado, que corrobora que un
  `timeoutEfectivoMs` con una configuración válida nunca es "sub-segundo
  espurio" — mide con la señal `AbortSignal` real cuánto tardó de verdad en
  abortarse.
- **M2 — el test de paridad (`decidir()` vs. la consulta SQL real, ronda
  2) ya no repite a mano el observable esperado de cada fixture.** Antes,
  cada fixture traía `decisionEsperada` Y `observableEsperado` escritos por
  separado — dos fuentes de verdad que podían divergir sin que nada lo
  marcara. Ahora `observableEsperado` se DERIVA de `decisionEsperada` con
  una única función (`observableEsperadoDe`), que también necesita el
  `estado` ORIGINAL de la fixture porque `"descartar"` es ambiguo: significa
  cosas distintas para una fila YA terminal (no tocada, ni la ve la
  consulta de reclamo) que para una fila ACTIVA con los intentos agotados
  (la propia consulta la cierra a `"fallido"` ahí mismo, sin Transporte).
  Se agregaron 3 fixtures nuevas de borde INCLUSIVO — `bloqueadoHasta ==
  AHORA`, `programadoPara == AHORA`, `proximoIntentoEn == AHORA` — los tres
  puntos donde tanto `decidir()` como la consulta SQL usan `<=`, nunca `<`.
- **M3 — ver el changeset de `@mafesoftware/correo`** (`.changeset/correo-idempotency-key.md`):
  ahora deja explícito que un 409 de Resend ANTES mapeaba a `"rechazado"`
  (permanente) y AHORA mapea a `"conflicto_idempotencia"` (transitorio), y
  que ese cambio agrega un miembro a la unión `CategoriaErrorCorreo`.
