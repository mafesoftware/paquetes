# Changelog

## 0.1.0

### Minor Changes

- 8983113: Primer release del paquete (0.1.0): números correlativos SIN huecos
  (recibos, órdenes de pago, órdenes de compra) por tenant + ámbito + tipo,
  seguros con transacciones concurrentes.
  
  - `formatearNumero(n, { prefijo?, relleno?, sufijo? })`: rellena con ceros a
    la izquierda hasta `relleno` dígitos SIN truncar (a diferencia del `lpad`
    de Postgres, que store360 usó mal en producción — ver el JSDoc de la
    función).
  - `esChoqueDeUnico(error)`: detecta un choque de índice único (`23505`) en
    la cadena de `error.cause` (hasta 10 niveles) y adentro de un
    `AggregateError.errors`.
  - `conReintento(fn, { intentos?, esReintentable?, espera? })`: reintento con
    backoff y jitter para un error reintentable (choque de único por
    defecto); `espera` inyectable para tests deterministas.
  - `ErrorNumeradores` (`codigo: CodigoErrorNumeradores`): el único error que
    tira este paquete (`"requiere_transaccion"` | `"retroceso_no_permitido"`).
  - `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency opcional;
    usa `@mafesoftware/tenant/drizzle` para la columna de tenant):
    - `tablaNumeradores({ tenant?, nombre?, columnasExtra? })`: la tabla
      `(tenant, ambito, tipo)` que guarda el próximo número, con único índice
      sobre esas tres columnas. `ambito` es `""` para "sin ámbito", nunca
      `NULL` (documentado el porqué).
    - `siguienteNumero(tx, tabla, { tenantId, ambito?, tipo })`: el próximo
      número, atómico bajo concurrencia (`INSERT ... ON CONFLICT DO UPDATE
      ... RETURNING proximo - 1`, una sola ida a la base). **Exige
      transacción** (`tx instanceof PgTransaction` de `drizzle-orm/pg-core`,
      válido para node-postgres y neon-serverless) — tira
      `ErrorNumeradores("requiere_transaccion")` si se llama con `db` a
      secas, porque el número solo debe consumirse si la transacción que lo
      pide confirma. Probado con 100 transacciones concurrentes (pool de al
      menos 20 conexiones) dando exactamente `1..100` sin huecos ni
      repetidos, y con 50 transacciones donde cada 3ra hace rollback: los
      números COMMITEADOS quedan contiguos desde 1.
    - `configurarNumerador(tx, tabla, { tenantId, ambito?, tipo, prefijo?,
      relleno?, proximo? })`: crea o reconfigura un numerador (alta de
      talonario, migración de un talonario que ya emitió números fuera del
      sistema). Nunca permite bajar `proximo` por debajo del valor actual
      (`ErrorNumeradores("retroceso_no_permitido")`, chequeo atómico, sin
      ventana de carrera).
  
  Postgres de test compartido con `packages/tenant` vía el helper de la raíz
  `tests/lib/postgres-de-prueba.ts` (nuevo: antes esa lógica de conexión
  estaba duplicada dentro de `packages/tenant/tests/drizzle/postgres.test.ts`,
  ahora la usan los dos paquetes).

### Patch Changes

- Updated dependencies [3c45bbf]
  - @mafesoftware/tenant@0.1.0

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
