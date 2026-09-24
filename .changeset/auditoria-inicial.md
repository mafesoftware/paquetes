---
"@mafesoftware/auditoria": minor
---

Primer release del paquete (0.1.0): registro de auditoría inmutable y por
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
  `api_key`, `apikey`, `totp`, `authorization`. Reconoce `Buffer`/
  `TypedArray`/`ArrayBuffer`/`DataView` (`"[binario N bytes]"`), `Date`
  (ISO), `RegExp` (`String(re)`), `URL` (`origin`+`pathname`, sin
  `search`/`hash`, que pueden traer secretos), `Error` (`{ name }`
  únicamente) y cualquier objeto con `toJSON` propio (se llama y el
  resultado se redacta recursivamente) — `Map` se convierte a un ARREGLO
  de pares `[String(clave), valor]`, no un objeto (evita perder entradas
  cuando dos claves distintas normalizan al mismo string).
- `serializarParaAuditoria(v)`: deja un valor listo para `jsonb` —
  `bigint` → string con sufijo `"n"`, `undefined` se descarta — sin tirar
  nunca, ni con una clave cuyo `get` tira, ni con un `Proxy` cuyas claves
  no se pueden enumerar. Mismos tipos especiales que `redactar` (binario,
  `Date`, `RegExp`, `URL`, `Error`, `toJSON`, `Map` como arreglo de pares),
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
    sobre los valores CRUDOS de `antes`/`despues`, y recién DESPUÉS redacta
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
    un string genérico fijo. `resultado.error` (cuando `ok: false`) sigue
    siendo el error CRUDO — documentado que puede traer datos sensibles y
    que nunca hay que mostrarlo/loguearlo tal cual. Dentro de una
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
