---
"@mafesoftware/tenant": minor
---

Primer release del paquete (0.1.0): resolución de tenant, slugs y FK
compuesta para los productos multi-tenant de MAFE Software.

- `normalizarHost(host)`: minúsculas, sin puerto, sin punto final, sin
  `www.` adelante.
- `slugDeHost(host, dominioBase, reservados?)`: el slug de un subdominio de
  `dominioBase`, o `null` para la apex, un subdominio de más de un nivel,
  un slug reservado, `*.vercel.app`, punycode (`xn--...`) o cualquier
  etiqueta que no pase `validarSlug`. Funciona con `dominioBase =
  "localhost"` para E2E sin DNS.
- `RESERVADOS`: el piso común de slugs que ninguna organización puede
  tomar en ningún producto (`www`, `app`, `admin`, `api`, `portal`,
  `plataforma`, `mail`, `login`, `webhook`...). `ReadonlySet`;
  `slugDeHost`/`validarSlug` aceptan una lista propia en su lugar.
- `validarSlug(s, reservados?)`: 3 a 40 caracteres, `[a-z0-9-]`, sin guion
  al borde, sin `--`, no reservado (case-insensitive), solo ASCII. Nunca
  tira: `{ ok: true, slug } | { ok: false, motivo, sugerencia? }`, con
  `sugerencia` normalizada (minúsculas, sin acentos) cuando hay una
  razonable — nunca para un slug reservado.
- `resolverTenant({ host, sesion, buscarPorHost, buscarPorSesion })`: cruza
  host y sesión (búsquedas inyectadas por la app). Coinciden → esa
  organización; difieren → `null`; solo host → la del host (páginas
  públicas); solo sesión (host apex/desconocido) → `null`, **nunca** una
  organización por defecto.
- `conTenant(id, fn)` / `tenantDelContexto()`: contexto de tenant con
  `AsyncLocalStorage`, para callbacks fuera de una request normal
  (webhooks, crons, seeds).
- `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
  opcional): `columnaTenant(nombre?, tipo?)`, `unicoConTenant({ tenant,
  id })` y `fkTenant({ columnas, columnasPadre, onDelete?, onUpdate? })`
  arman la FK compuesta `(tenant, padreId) → padre(tenant, id)` (spec 06
  §3.1, regla 2): Postgres rechaza con `foreign_key_violation` (23503)
  que una fila hija apunte al padre de otra organización. Probado contra
  Postgres real en `tests/drizzle/postgres.test.ts` (esquema aislado por
  corrida, limpiado al final). El paquete no trae migraciones; DDL de
  referencia en `sql/ejemplo.sql`.
- Property-based tests (fast-check):
  `slugDeHost(normalizarHost(`${slug}.${base}`), base) === slug` para todo
  slug válido y no reservado que genera fast-check; `normalizarHost` es
  idempotente.
