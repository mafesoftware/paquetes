---
"@mafesoftware/tenant": minor
---

Primer release del paquete (0.1.0): resolución de tenant, slugs y FK
compuesta para los productos multi-tenant de MAFE Software.

- `normalizarHost(host)`: minúsculas, sin puerto, sin punto final, sin
  `www.` adelante. IPv6 entre corchetes (`"[::1]:3000"` → `"[::1]"`) se
  reconoce como un bloque, no se corta por el primer `":"`.
- `validarDominioBase(dominioBase)`: `dominioBase` normalizado igual que un
  host; tira `ErrorTenant` (`codigo: "dominio_base_invalido"`) si queda
  vacío — error de programación, no un host que mandó alguien.
- `slugDeHost(host, dominioBase, reservados?)`: el slug de un subdominio de
  `dominioBase`, o `null` para la apex, un subdominio de más de un nivel,
  un slug reservado, `*.vercel.app`, punycode (`xn--...`) o cualquier
  etiqueta que no pase `validarSlug`. Funciona con `dominioBase =
  "localhost"` para E2E sin DNS. `reservados` propio se compara sin
  distinguir mayúsculas (se normaliza solo). Tira `ErrorTenant` si
  `dominioBase` es inválido.
- `RESERVADOS`: el piso común de slugs que ninguna organización puede
  tomar en ningún producto (`www`, `app`, `admin`, `api`, `portal`,
  `plataforma`, `mail`, `login`, `webhook`...). `ReadonlySet`;
  `slugDeHost`/`validarSlug` aceptan una lista propia en su lugar.
- `validarSlug(s, reservados?)`: 3 a 40 caracteres, `[a-z0-9-]`, sin guion
  al borde, sin `--`, no reservado (case-insensitive, reservados propios
  con mayúsculas se normalizan solos), solo ASCII. Nunca tira: `{ ok: true,
  slug } | { ok: false, motivo, sugerencia? }`, con `sugerencia`
  normalizada (minúsculas, sin acentos) cuando hay una razonable — nunca
  para un slug reservado.
- `resolverTenant({ host, dominioBase, reservados?, sesion, buscarPorSlug,
  buscarPorSesion })`: recibe el host CRUDO y lo convierte en slug con
  `slugDeHost` adentro (nunca hay que normalizar a mano ni pasarle el host
  directo a la búsqueda inyectada). Cruza slug y sesión: coinciden → esa
  organización; difieren → `null`; solo el slug resuelve → la organización
  del host (páginas públicas); solo sesión (host apex/desconocido/reservado)
  → `null`, **nunca** una organización por defecto. `dominioBase` inválido
  tira `ErrorTenant` siempre, incluso sin host. **Fail closed**: si
  `buscarPorSlug`/`buscarPorSesion` tiran, el error se propaga tal cual, sin
  convertirse en `null`.
- `conTenant(id, fn)` / `tenantDelContexto()`: contexto de tenant con
  `AsyncLocalStorage`, para callbacks fuera de una request normal
  (webhooks, crons, seeds).
- `ErrorTenant` (`codigo: CodigoErrorTenant`): el único error que tira este
  paquete.
- `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
  opcional): `columnaTenant(nombre?, tipo?)`, `unicoConTenant({ tenant,
  id })` y `fkTenant({ columnas, columnasPadre, nombre?, onDelete?,
  onUpdate? })` arman la FK compuesta `(tenant, padreId) → padre(tenant,
  id)` (spec 06 §3.1, regla 2): Postgres rechaza con `foreign_key_violation`
  (23503) que una fila hija apunte al padre de otra organización. El
  default de `onDelete` es `"no action"` (como Postgres); `"cascade"` es un
  opt-in explícito. El nombre por defecto de la FK es corto y
  determinístico (`${tablaHija}_${columnaPadre}_tenant_fk`, truncado con un
  hash de 8 caracteres si supera los 63 que permite Postgres) — no el que
  arma drizzle solo (concatena tabla + ambas columnas + tabla padre + ambas
  columnas padre, que en catálogos reales pasa el límite y Postgres trunca
  en silencio, con riesgo de colisión entre dos FKs).
  Probado contra Postgres real en `tests/drizzle/postgres.test.ts`, con el
  DDL generado del MISMO esquema de Drizzle que arman estas tres funciones
  (`drizzle-kit/api`, `generateDrizzleJson` + `generateMigration` —
  `drizzle-kit` como devDependency de test), no de SQL escrito a mano;
  esquema aislado por corrida, limpiado al final. `tests/drizzle/config.test.ts`
  verifica la configuración de tabla (columnas, unique, FK y su nombre) sin
  tocar Postgres. El paquete no trae migraciones; DDL de referencia en
  `sql/ejemplo.sql`.
- Property-based tests (fast-check):
  `slugDeHost(normalizarHost(`${slug}.${base}`), base) === slug` para todo
  slug válido y no reservado que genera fast-check; `normalizarHost` es
  idempotente.
