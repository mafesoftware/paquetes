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
  profunda con cualquier CLAVE sensible (minúsculas, sin `_`/`-`) tapada
  con `"[redactado]"`, a cualquier profundidad. Lista default:
  `contrasena`, `password`, `hash`, `token`, `secreto`, `secret`, `cbu`,
  `cvu`, `clave`, `api_key`, `apikey`, `totp`, `authorization`.
- `serializarParaAuditoria(v)`: deja un valor listo para `jsonb` —
  `bigint` → string con sufijo `"n"`, `Date` → ISO, `undefined` se
  descarta — sin tirar nunca.
- `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency opcional;
  usa `@mafesoftware/tenant/drizzle` para la columna de tenant):
  - `tablaAuditoria({ tenant?, nombre?, columnasExtra? })`: `id`, columna
    de tenant, `entidad`/`entidad_id`/`accion`/`actor_tipo`, `actor_id`
    nullable, `antes`/`despues` (`jsonb`, nullable), `cambios` (`jsonb`, NOT
    NULL), `ip`/`user_agent`, `creado_en`. Índices no únicos `(tenant,
    entidad, entidad_id, creado_en)` y `(tenant, creado_en)`.
  - `sqlInmutabilidad(nombreTabla)`: el SQL (función `plpgsql` + triggers)
    que bloquea `UPDATE`/`DELETE`/`TRUNCATE` con un mensaje claro.
    Idempotente; valida `nombreTabla` contra `^[a-z_][a-z0-9_]*$` y TIRA si
    no matchea (se interpola en el DDL). Se agrega como migración escrita a
    mano, después de la que genera drizzle-kit — este paquete no trae
    migraciones.
  - `auditar(dbOTx, tabla, entrada)`: calcula `cambios`, redacta y
    serializa `antes`/`despues`/`cambios`, e inserta. **Nunca tira**:
    devuelve `{ ok, id } | { ok: false, error }` y loguea con
    `console.error` si falla. Dentro de una transacción, envuelve el
    insert en un `SAVEPOINT` (`tx.transaction()` anidado de Drizzle) para
    que un fallo del insert de auditoría no aborte la transacción externa
    — probado forzando un fallo (check constraint) y verificando que el
    resto del trabajo de la tx sigue commiteando.
  - `listarAuditoria(db, tabla, { tenantId, entidad?, entidadId?, actorId?,
    desde?, hasta?, pagina?, porPagina? })`: siempre filtrado por
    `tenantId`, ordenado por `creado_en DESC, id DESC`, `porPagina`
    cap-eado a `200`.

Postgres de test compartido con `packages/tenant`/`packages/numeradores`
vía el helper de la raíz `tests/lib/postgres-de-prueba.ts`.
`tests/drizzle/postgres.test.ts` y `tests/drizzle/postgres-inmutabilidad.test.ts`
prueban contra Postgres real (rollback, SAVEPOINT, redacción aplicada
antes de llegar a la base, el trigger de inmutabilidad, aislamiento entre
tenants, paginación); `bun run test:sin-db` ahora excluye el glob
`postgres*.test.ts` (antes solo `postgres.test.ts`) para cubrir los dos
archivos.
