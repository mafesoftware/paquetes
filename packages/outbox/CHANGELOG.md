# Changelog

## 0.1.0

### Minor Changes

- 6277872: Primer release del paquete (0.1.0): outbox transaccional para correo y
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
      `Math.min(60_000, Math.floor(leaseMs / 2))` por defecto), y registra el
      resultado en su
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
      perdidos, liberados, errores, advertencias, ultimoError? }` (ver
      "Cola del pool y lease" más abajo).
      **Entrega al menos una vez, no exactamente una vez** —
      `MensajeParaEnviar.claveIdempotencia`
      (`${tenantId}:${claveIdempotencia}`) existe para que el proveedor
      deduplique; `transporteCorreo` la reenvía como header `Idempotency-Key`
      de Resend (nuevo en `@mafesoftware/correo`, changeset aparte).
    - `purgarOutbox({ db, tabla, estados?, antesDe })`: borra filas
      TERMINALES (`"enviado"`/`"descartado"`/`"fallido"`, los únicos que
      acepta) con `actualizado_en` anterior a `antesDe`; devuelve
      `{ eliminadas }`.
  
  **Detalles de `procesarOutbox`:**
  
  - **Opciones validadas** (`ErrorOutbox("opciones_invalidas")`): `lote` y
    `concurrencia` enteros `>= 1`; `leaseMs` entero finito `>= 5000`;
    `timeoutMs` entero finito `>= 1000` y `<= leaseMs / 2`. El default de
    `timeoutMs` nunca viola esas cotas, así que customizar solo `leaseMs`
    nunca tira.
  - **Cola del pool y lease.** Las filas de un reclamo comparten un solo
    `bloqueado_hasta`, pero con `concurrencia` acotada no todas empiezan a la
    vez. Justo antes de llamar al `Transporte` se recalcula cuánto lease
    queda: si es menos de `timeoutMs + 1000`, la fila se LIBERA sin llamar a
    nada (`"pendiente"`, `intentos - 1`, cerrojada — cuenta en `liberados`)
    en vez de arriesgar que otro worker la reclame y la mande a la vez. La
    fila liberada conserva su lugar FIFO en la cola (`proximo_intento_en` no
    avanza: queda en `least(coalesce(proximo_intento_en, programado_para),
    <momento del reclamo>)`), así que no pasa hambre bajo carga sostenida.
    Si sí alcanza el margen, el intento corre con el `timeoutMs` configurado
    entero.
  - **`advertencias: string[]`** (siempre presente, nunca logueado por el
    paquete): avisa si `leaseMs < timeoutMs * ceil(lote / concurrencia) +
    1000` — el peor caso en que la última fila del lote llega a su turno sin
    margen y se libera. Con los valores por defecto no aparece.
  - **Bucle de caídas acotado:** una fila `"procesando"` con el lease vencido
    y `maxIntentos` agotado se cierra a `"fallido"` en el reclamo mismo
    (`codigo: "lease_agotado"`; `"intentos_agotados"` como salvaguarda para
    una `"pendiente"` agotada), sin llamar a ningún `Transporte`. `decidir`
    da `"descartar"` en ese caso, con la misma regla (test de paridad contra
    la consulta SQL real, incluidos los bordes inclusivos `<=`).
  - **`"conflicto_idempotencia"`** (HTTP 409 de Resend) es transitorio con
    un backoff de al menos 60 s, incluso en el primer intento.
  - **`Transporte` recibe `{ señal: AbortSignal }`**, que se aborta al
    vencer el timeout; `transporteCorreo`/`transporteWhatsApp` la reenvían a
    `enviar` (`@mafesoftware/kapso-wa` hoy no la acepta). Abortar no deshace
    un envío que el proveedor ya haya aceptado.
  - Un `bloqueado_hasta` que no se pueda leer como fecha válida cuenta como
    `perdidos` sin tocar ningún `Transporte`. El conteo de filas afectadas
    cae a `rows.length` (vía `RETURNING`) si el driver no trae `rowCount`.
  
  Postgres de test compartido con el resto de los paquetes `/drizzle` de este
  monorepo (`tests/lib/postgres-de-prueba.ts`). `tests/drizzle/postgres.test.ts`
  prueba contra Postgres real: idempotencia de `encolar`, rollback de la
  transacción que encola, `encolar` fuera de transacción, reintento con
  backoff tras un fallo transitorio (con `ahora` inyectado), `fallido` al
  agotar `maxIntentos`, descarte inmediato en cada categoría permanente
  (`credenciales`/`rechazado`/`facturacion`/`ventana`), reclamo de una fila
  `"procesando"` con el lease vencido (y que NO se reclama con el lease
  vigente), `programado_para` futuro sin enviar, un `Transporte` que tira
  tratado como transitorio, liberación sin inanición bajo carga sostenida
  (orden FIFO), y — el test central de esta tarea — dos
  `procesarOutbox` concurrentes contra la misma cola: nunca mandan el mismo
  mensaje dos veces (prueba dura, garantizada por `SKIP LOCKED`) y de verdad
  se solapan en el tiempo (prueba con ventanas de tiempo reales de un
  transporte lento, no solo "los dos terminaron rápido" — cada corrida limita
  su propio lote a la mitad de los mensajes debidos, así que las DOS
  necesariamente reclaman filas sea cual sea el orden real de ejecución).
  `bun run test:sin-db` excluye `postgres*.test.ts`. Cobertura del núcleo
  ≥95% (statements/branches/functions/lines).

### Patch Changes

- Updated dependencies [3c45bbf]
  - @mafesoftware/tenant@0.1.0

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
