---
"@mafesoftware/limite-intentos": minor
---

Primer release del paquete (0.1.0): freno a la fuerza bruta en el ingreso
(login/attempt throttling), persistido siempre en Postgres — nunca en
memoria, porque las instancias de Vercel no comparten memoria. Se cuenta
por cuenta y por IP, con upsert atómico por clave.

- **Núcleo puro** (sin DB, sin framework, sin `process.env`):
  - `claveCuenta(email)`: baja a minúsculas y recorta espacios antes de
    prefijar con `"cuenta:"`.
  - `claveIp(ip)`: recorta espacios y prefija con `"ip:"` (sin bajar a
    minúsculas). Espacio de nombres separado de `claveCuenta` — el mismo
    texto nunca choca entre las dos.
  - `ErrorLimiteIntentos` (`codigo: "opciones_invalidas"`): el único error
    que tira este paquete.
- **`/drizzle`** (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
  opcional; sin dependencia de `@mafesoftware/tenant`):
  - `tablaIntentos({ nombre?, tenant?, columnasExtra? })`: `clave` (`text`,
    PRIMARY KEY), `contador` (`integer`, default `0`), `ventana_desde`
    (`timestamptz`, default `now()`), `bloqueado_hasta` (`timestamptz`,
    nullable), `actualizado_en`. La columna de tenant es opcional en dos
    sentidos (no existe si no se pide; si se pide, queda NULLABLE, a
    diferencia de `columnaTenant` de `@mafesoftware/tenant/drizzle`) —
    login pasa la mayoría de las veces sin tenant conocido todavía, y
    ninguna función de este paquete la toca.
  - `registrarIntento(db, tabla, { clave, maximo, ventanaMs, bloqueoMs,
    ahora? })`: registra un intento fallido con un único `INSERT ... ON
    CONFLICT (clave) DO UPDATE` — ventana fija con auto-reinicio
    (`contador`/`ventana_desde` se reinician solos cuando pasa `ventanaMs`
    sin llegar a `maximo`), bloqueo que se RENUEVA mientras siga llegando
    fuerza bruta dentro de la ventana. No exige transacción (una única
    sentencia atómica). Devuelve `{ permitido, restantes, desbloqueaEn }`.
    Probado con 20 llamadas VERDADERAMENTE concurrentes sobre la misma
    clave (pool de 20+ conexiones, más una prueba con `pg_sleep`
    sosteniendo el lock de fila para confirmar solapamiento real): el
    contador final es exactamente 20.
  - `consultarIntento(db, tabla, { clave, ahora? })`: lectura pura (no
    cuenta como intento); `bloqueado`/`desbloqueaEn` salen de comparar
    `bloqueado_hasta` contra `ahora` — sin cron de "desbloqueo": el bloqueo
    se considera vencido apenas `ahora` lo supera, sin ninguna escritura.
  - `limpiarIntentos(db, tabla, clave)`: borra la fila (login correcto). No
    limpia la IP automáticamente al limpiar la cuenta.

Postgres de test compartido con el resto de los paquetes `/drizzle` de este
monorepo (`tests/lib/postgres-de-prueba.ts`). Cobertura del núcleo
100% (statements/branches/functions/lines).
