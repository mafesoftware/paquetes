# Changelog

## 0.1.0

### Minor Changes

- d7471a4: Primer release del paquete (0.1.0): registro de auditoría inmutable y por
  tenant para los productos SaaS de MAFE Software — qué cambió (diff de
  antes/después), quién, cuándo, con campos sensibles redactados. Un trigger
  de Postgres bloquea `UPDATE`/`DELETE`/`TRUNCATE` sobre la tabla.
  
  - `loQueCambio(antes, despues)`: el diff entre dos versiones de una
    entidad, `{ campo, antes, despues }[]` ordenado por `campo`. Recorre
    objetos planos con rutas de puntos (`"direccion.calle"`); los arreglos se
    comparan como valor ENTERO, no elemento a elemento (documentado el
    porqué). Maneja `bigint` (por valor), `Date` (por `getTime()`), `null` vs
    `undefined` (nunca iguales — `undefined` es "clave ausente") y una clave
    agregada/quitada. Un lado ausente contra un objeto plano del otro lado se
    expande campo a campo (el caso típico de auditar una entidad recién
    creada o borrada). Nunca tira por un ciclo: esa rama queda como
    `"[ciclo]"`.
  - `redactar(obj, camposSensibles?)` / `CAMPOS_SENSIBLES_POR_DEFECTO`: copia
    profunda con cualquier CLAVE sensible tapada con `"[redactado]"`, a
    cualquier profundidad, adentro de arreglos, `Map`s, `Set`s e instancias
    de clase propia incluido. Matching por nombre normalizado (minúsculas,
    sin `_`/`-`) que IGUALA o TERMINA CON un término de la lista (no
    "contiene": `passwordHash`/`accessToken`/`clientSecret`/`x-api-key` se
    redactan, `passwordHint`/`tokenizer` no). Lista default: `contrasena`,
    `password`, `hash`, `token`, `secreto`, `secret`, `cbu`, `cvu`, `clave`,
    `api_key`, `apikey`, `totp`, `authorization` (más los plurales de la
    ronda 4 y `secreta` de P.10b). Reconoce `Buffer`/
    `TypedArray`/`ArrayBuffer`/`DataView` (`"[binario N bytes]"`), `Date`
    (ISO), `RegExp` (`String(re)`), `URL` (`origin`+`pathname`, sin
    `search`/`hash`, que pueden traer secretos), `Error` (`{ name }`
    únicamente) y cualquier objeto con `toJSON` propio (se llama y el
    resultado se redacta recursivamente) — `Map` se convierte a un OBJETO
    plano con la clave como texto (dos claves que dan el mismo texto se
    desambiguan con `" (2)"`, `" (3)"`…, en orden de inserción; ver ronda 5).
  - `serializarParaAuditoria(v)`: deja un valor listo para `jsonb` —
    `bigint` → string con sufijo `"n"`, `undefined` se descarta — sin tirar
    nunca, ni con una clave cuyo `get` tira, ni con un `Proxy` cuyas claves
    no se pueden enumerar. Mismos tipos especiales que `redactar` (binario,
    `Date`, `RegExp`, `URL`, `Error`, `toJSON`, `Map` como objeto plano),
    en el mismo orden.
  - `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency opcional;
    usa `@mafesoftware/tenant/drizzle` para la columna de tenant):
    - `tablaAuditoria({ tenant?, nombre?, columnasExtra? })`: `id`, columna
      de tenant, `entidad`/`entidad_id`/`accion`/`actor_tipo`, `actor_id`
      nullable, `antes`/`despues` (`jsonb`, nullable), `cambios` (`jsonb`, NOT
      NULL), `ip`/`user_agent`, `creado_en`. Índices no únicos `(tenant,
      entidad, entidad_id, creado_en)` y `(tenant, creado_en)`.
    - `sqlInmutabilidad(nombreTabla)`: el SQL (función `plpgsql` + triggers)
      que bloquea `UPDATE`/`DELETE`/`TRUNCATE` con un mensaje claro.
      Idempotente; valida `nombreTabla` contra `^[a-z_][a-z0-9_]*$` y contra
      un tope de 40 caracteres, TIRA si no pasa (se interpola en el DDL, y
      los identificadores derivados tienen que quedar bajo el límite de 63
      de Postgres). Documentado que frena errores de la app, no al dueño de
      la base (`session_replication_role`, `DISABLE TRIGGER`, `DROP TABLE`,
      un superusuario lo saltean). Se agrega como migración escrita a mano,
      después de la que genera drizzle-kit — este paquete no trae
      migraciones. `tablaAuditoria` valida `nombre` con la misma regla.
    - `auditar(dbOTx, tabla, entrada)`: calcula `cambios` con `loQueCambio`
      sobre los valores NORMALIZADOS (`normalizarParaDiff`, ver ronda 4) de
      `antes`/`despues`, y recién DESPUÉS redacta
      el resultado mirando CUALQUIER segmento de la ruta (no solo el
      último) — un secreto ANIDADO bajo una clave ancestro sensible (ej.
      `token.access` con `token` sensible) nunca llega sin tapar, y un
      cambio REAL en un campo sensible SÍ queda registrado en `cambios` (con
      los valores tapados, `"[redactado]"`/`"[redactado]"`), en vez de
      desaparecer por completo. Serializa los tres (`antes`/`despues`/
      `cambios`) e inserta. **Nunca tira**: devuelve `{ ok, id } | { ok:
      false, error }` y loguea un RESUMEN seguro (`entidad`/`entidadId`/
      `accion` + `code`/`message` de Postgres, SOLO de `error.cause`, nunca
      del wrapper — que trae el SQL armado y los parámetros bindeados en su
      propio `.message`) con `console.error` si falla; sin `cause` legible,
      un string genérico fijo. `resultado.error` (cuando `ok: false`) es
      `{ codigo: string | null; mensaje: string }` — `ErrorAuditoria`,
      SANITIZADO con la misma lógica que el log, nunca el error crudo de
      Drizzle/`pg` (que antes se devolvía tal cual, con el SQL/params
      incluidos si algún llamador lo mostraba o reenviaba sin saber). Dentro de una
      transacción, envuelve el insert en un `SAVEPOINT` (`tx.transaction()`
      anidado de Drizzle) para que un fallo del insert de auditoría no
      aborte la transacción externa — probado forzando un fallo (check
      constraint) y verificando que una escritura de NEGOCIO en una tabla
      SEPARADA, en la misma tx, sigue commiteando. Documentado que las
      llamadas dentro de una misma tx tienen que ser secuenciales (nunca
      `Promise.all`) y que no soporta el driver `neon-http` (sin
      `db.transaction()`).
    - `listarAuditoria(db, tabla, { tenantId, entidad?, entidadId?, actorId?,
      desde?, hasta?, pagina?, porPagina? })`: siempre filtrado por
      `tenantId`, ordenado por `creado_en DESC, id DESC`, `porPagina`
      cap-eado a `200`; `pagina`/`porPagina` con `NaN`/`Infinity` caen a los
      defaults en vez de romper la consulta.
  
  `loQueCambio`: `null` cuenta como ausente igual que `undefined` para la
  expansión campo a campo (sin dejar de ser un valor distinto de `undefined`
  en una comparación directa), y `loQueCambio(x, x)` con `x` autoreferencial
  da `[]` en vez de `"[ciclo]"` (misma referencia = sin diferencia posible).
  
  `redactar` convierte `Date` a un ISO string (no a una copia de `Date`,
  como antes) — cambio deliberado, para que dé el mismo resultado que
  `serializarParaAuditoria` en el mismo paso (las dos funciones están
  pensadas para usarse juntas).
  
  Postgres de test compartido con `packages/tenant`/`packages/numeradores`
  vía el helper de la raíz `tests/lib/postgres-de-prueba.ts`.
  `tests/drizzle/postgres.test.ts` y `tests/drizzle/postgres-inmutabilidad.test.ts`
  prueban contra Postgres real (rollback, SAVEPOINT con tabla de negocio
  separada, redacción aplicada antes de llegar a la base — incluido un
  secreto anidado, verificado con `::text` sobre el jsonb crudo —, que
  `console.error` no filtra secretos, `NaN`/`Infinity` en la paginación, el
  trigger de inmutabilidad, aislamiento entre tenants, paginación); `bun run
  test:sin-db` excluye el glob `postgres*.test.ts` (no solo
  `postgres.test.ts`) para cubrir los dos archivos de Postgres de este
  paquete.
  
  **Ronda 4** — normalización antes de diffear + endurecimiento de "nunca
  tira":
  
  - `normalizarParaDiff(v)` (nuevo export del núcleo): convierte `v` a datos
    planos tipo JSON, con las MISMAS reglas de tipos especiales que
    `serializarParaAuditoria` (`tipos-especiales.ts` compartido), pero
    **sin redactar nada**. `auditar` ahora calcula `cambios` con
    `loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues))` en
    vez de diffear los valores crudos — corrige una regresión: dos instancias
    EQUIVALENTES pero no idénticas (dos `Decimal`/`Map`/`URL`/instancias de
    clase con el mismo contenido, construidas por separado) se reportaban
    como "cambiadas" por comparar por referencia/forma interna en vez de por
    valor. `redactar`/`serializarParaAuditoria` siguen aplicándose después,
    sobre los valores crudos, como antes.
  - Los códigos de error de Postgres de clase `22` (Data Exception, ej.
    `22P02`) ecoan el valor de entrada inválido en su `message` (a diferencia
    de la clase `23`, que describe la restricción). `auditar` ahora
    reemplaza el `mensaje` por un texto genérico que conserva el código
    (`"valor inválido para la columna (22P02)"`) para esa clase completa, en
    el resultado y en el log — probado con un `tenantId` no-uuid contra
    Postgres real.
  - `redactar`/`serializarParaAuditoria`/`normalizarParaDiff` comparten ahora
    un dispatcher único (`clasificar`, en `tipos-especiales.ts`) envuelto en
    un helper `intentar` que atrapa cualquier excepción de la inspección de
    un nodo (`instanceof`, lectura de `toJSON`, lectura de `.name` de un
    `Error`, `getPrototypeOf`) y la convierte en `"[error]"` para ese nodo —
    probado con un `Proxy` cuyas trampas `getPrototypeOf`/`get` tiran, un
    `get toJSON(){throw}`, y un `Error` con getter de `name` que tira. Un
    fallo ANTES de llegar a la base (preparando la auditoría) ahora da un
    mensaje distinto (`"error preparando la auditoría"`) al de un fallo de
    Postgres (`"error de base de datos sin detalle"`).
  - `redactarCambios` (la redacción de `cambios` por segmento de ruta) se
    movió a su propio archivo para que los tests unitarios importen la
    función REAL en vez de mantener una copia (en la ronda 5 pasó a ser un
    export público del núcleo).
  - `CAMPOS_SENSIBLES_POR_DEFECTO` agrega `"passwords"`, `"tokens"` y
    `"secrets"` (los plurales NO matchean su singular con la regla "termina
    con" — `"misPasswords"` no termina en `"password"`). README documenta
    también que la clave de un `Map` queda como texto en el resultado sin
    mirar su contenido (no usar un secreto como clave de un `Map`).
  
  **Ronda 5** — `Map` como objeto, `redactarCambios` pública y "nunca tira"
  de punta a punta:
  
  - **`Map` se representa como un OBJETO plano** en `redactar`,
    `serializarParaAuditoria` y `normalizarParaDiff` (antes: arreglo de
    pares), con la clave convertida a texto seguro. Si dos claves distintas
    dan el mismo texto (el número `1` y el string `"1"`), la que llegó
    después lleva un sufijo `" (2)"`, `" (3)"`… en orden de inserción — no
    se pierde ninguna. Corrige una fuga CRÍTICA: con pares, `loQueCambio` veía
    el `Map` como una hoja y la ruta del cambio se cortaba en él (`"m"`), así
    que un valor bajo una clave sensible del `Map` (`new Map([["password",
    "x"]])`) llegaba en claro a `cambios`. Ahora la clave del `Map` es un
    segmento de la ruta (`"m.password"`) y queda
    `"[redactado]"`/`"[redactado]"`, igual que en las copias guardadas.
    `redactarCambios` trata un segmento con sufijo de colisión
    (`"password (2)"`) como sensible. Probado con el `auditar` real y un
    `dbOTx` falso que captura los parámetros (en la raíz, alta, baja, `toJSON`
    que devuelve un `Map`). Una clave `"__proto__"` (de un `Map` o de un
    objeto de `JSON.parse`) ahora se conserva como propiedad propia en vez de
    cambiar el prototipo del resultado.
  - **`redactarCambios(cambios, camposSensibles?)` es un export público del
    núcleo** (no necesita base de datos). El README documenta el pipeline
    manual (`redactarCambios(loQueCambio(normalizarParaDiff(antes),
    normalizarParaDiff(despues)))`) y advierte que lo que devuelve
    `normalizarParaDiff` nunca se guarda ni se loguea.
  - Un `Map`/`Set` cuya **iteración tira** (un `Proxy` sobre un `Map`/`Set`,
    una subclase con `entries()`/`[Symbol.iterator]` roto) queda `"[error]"`
    en las tres funciones, en vez de escaparse.
  - **`loQueCambio` nunca tira**: un nodo que no se puede inspeccionar
    (`Proxy` revocado o con `getPrototypeOf` roto, `ownKeys` que tira, getter
    que tira) queda `"[error]"`; si comparar dos hojas tira, se consideran
    distintas y el cambio se reporta.
  - El sanitizador de errores de `auditar` tampoco tira él mismo con un error
    raro (`Proxy` con trampas rotas, getter de `cause`/`code`/`message` que
    tira): cae al código `null` y/o al mensaje genérico.
  
  **P.10b** — una sola normalización de claves:
  
  - **Fuga crítica corregida**: una clave de `Map` que colisiona
    (`"password (2)"`) filtraba su valor a `cambios` cuando el `Map` quedaba
    adentro de una HOJA del diff (un arreglo, un `Set`, un cambio de tipo, una
    raíz que pasa de `null` a un arreglo): `redactarCambios` sacaba el sufijo
    de colisión al mirar la ruta, pero la rama de objeto de `redactar` no.
    Ahora hay UN solo `esClaveSensible`, usado por `redactar` (objetos y
    `Map`s) y por cada segmento de ruta de `redactarCambios`, que normaliza la
    clave así: saca el sufijo de colisión final `" (N)"`, quita acentos
    (Unicode NFD sin marcas combinantes), pasa a minúsculas y quita `_`, `-` y
    espacios; recién ahí aplica "igual o termina con". Los términos de la
    lista se normalizan igual, así que un término propio con acentos
    (`"código"`) funciona.
  - `"contraseña"`/`"Contraseña"`/`"CONTRASEÑA"` se tapan por la
    normalización (sin una segunda entrada en la lista). La lista default
    agrega `"secreta"` para cubrir `"clave_secreta"`.
  - Una clave LITERAL `"password (2)"` en un objeto plano ahora se tapa en las
    copias guardadas, igual que en `cambios` (antes las dos discrepaban).
    Tapar de más es el costo aceptado.
  - `auditar` lee `entidad`/`entidadId`/`accion` una sola vez, antes de todo;
    un getter que tira ya no hace rechazar a `auditar` desde el `catch` que
    arma el log: resuelve `{ ok: false }` con `"error preparando la
    auditoría"` y el log dice `[desconocido]`.
  - Todo probado con el `auditar` real y un `dbOTx` falso que captura los
    parámetros: ningún secreto aparece en ellos y `cambios` coincide con las
    copias guardadas.
  - Ronda de fix 1 de P.10b:
    - Un término o una clave con punto (`camposSensibles: ["api.key"]`,
      clave `"api.key"`) ya no filtra en `cambios`: `redactarCambios` prueba
      cada tramo contiguo de la ruta (`segmentos[i..j]` unidos con `"."`),
      no solo cada segmento. El punto sigue sin ser separador (`"api.key"` no
      matchea `"apikey"`, ni en las copias ni en `cambios`).
    - La normalización usa NFKD (ancho completo: `"ＰＡＳＳＷＯＲＤ"`) y quita
      los caracteres de formato invisibles `\p{Cf}` (`"pass\u200Bword"`).
    - Un término que normaliza a `""` (`""`, `"_"`, `" (2)"`) se descarta: ya
      no tapa todas las claves.
    - La lista default agrega `"secretos"` y `"secretas"`.
    - `auditar` también lee `tenantId`, `actor`, `ip` y `userAgent` una sola
      vez al principio; un getter que tira da `"error preparando la
      auditoría"`.
  - Ronda de fix 2 de P.10b:
    - La búsqueda de tramos de `redactarCambios` ya no es O(n³) sobre una
      ruta con muchos puntos: solo prueba las colas de a lo sumo `puntos + 1`
      segmentos que terminan en cada segmento (`puntos`: el término con más
      puntos, calculado una vez por lista; con la lista default es 0 y se
      mira cada segmento suelto). Una clave de 10.000 puntos o una ruta de
      4000 segmentos se auditan en milisegundos.
    - Un término con punto se evalúa también como COLA DE RUTA en las copias
      guardadas (`redactar`), con la misma cota: `["cuenta.numero"]` tapa
      `{ cuenta: { numero } }` en las copias y en `cambios`, además de la
      clave literal `"cuenta.numero"`. Los arreglos y `Set`s no suman segmento.
    - La normalización también quita los caracteres de control `\p{Cc}`
      (`"pass\u0000word"`).
    - `auditar` lee `antes`, `despues` y `camposSensibles` una sola vez con
      el resto de la entrada: el diff y las copias usan los mismos valores, y
      un getter que tira da `"error preparando la auditoría"`.
  - Ronda de fix 3 de P.10b:
    - **`PROFUNDIDAD_MAXIMA` (500), exportada.** `redactar`,
      `serializarParaAuditoria`, `normalizarParaDiff` y `loQueCambio` cortan
      en el mismo lugar: un contenedor más hondo queda `"[profundidad]"` (un
      primitivo se conserva). Antes un dato de ~1650–2600 niveles reventaba el
      stack (`RangeError`) de funciones que "nunca tiran". `loQueCambio`
      compara lo cortado como `"[profundidad]"` (dos estructuras que solo
      difieren más abajo del tope no generan cambio, igual que sus copias) y
      devuelve una copia cortada de una hoja que lo pasa. `auditar` serializa
      cada lado de cada cambio por separado, para cortar en el mismo lugar que
      las copias.
    - La raíz verdadera de `loQueCambio` lleva una marca interna no
      enumerable: una clave real `"(raiz)"` ya no se saltea la redacción por
      ruta (`["(raiz)"]`, `["(raiz).numero"]`).
    - Cada segmento de una ruta se normaliza por separado: un ancestro con
      sufijo de colisión (`"cuenta (2)"`) ya no esquiva `["cuenta.numero"]`.
    - Un `Proxy` revocado queda `"[error]"` en `redactar`/`serializar`/
      `normalizar` (antes `Array.isArray` tiraba).

### Patch Changes

- Updated dependencies [3c45bbf]
  - @mafesoftware/tenant@0.1.0

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
