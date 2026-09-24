# CLAUDE.md — `mafesoftware/paquetes`

Monorepo de paquetes npm compartidos `@mafesoftware/*` (bun workspaces). Público, MIT.
No confundir con los repos consumidores (store360, gestionflow, ediflow, consult360,
Padel360, distrigo, azife…): acá **no** se toca ningún proyecto consumidor, ni sus
`workspace:*` — eso es responsabilidad de la migración de cada uno, fuera de este
repo.

## Cuentas

- **GitHub**: org `mafesoftware`. `gh` puede tener varias cuentas cargadas a la vez;
  no alcanza con que una esté "Active" en `gh auth status" — para pushear hay que
  vaciar la cadena de credenciales y forzar la cuenta del repo:
  ```sh
  T=$(gh auth token -u mafesoftware)
  git -c credential.helper= \
    -c http.https://github.com/.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$T" | base64)" \
    push origin main
  ```
- **npm**: usuario/org `mafe-software`, scope `@mafesoftware`. Publicación por
  **changesets** con **npm trusted publishing (OIDC) + provenance** al mergear a
  `main` (no token en texto plano). Detalle del flujo completo: tarea P.2.
- Commits: autor `MFSoftware <mafesoftware@gmail.com>` (pasar `-c user.name=... -c
  user.email=...` si el git config local no lo tiene por defecto), mensajes en
  español. No pushear ni publicar salvo que se pida explícitamente.

## Reglas de diseño de un paquete (vinculantes — spec 06 §3)

1. **Núcleo puro**: sin base de datos, sin framework, sin `process.env`; toda
   dependencia externa (fetch, reloj, feriados, almacenamiento) se **inyecta por
   parámetro** ("puertos"). Así el paquete sirve a proyectos con Drizzle, Prisma,
   postgres.js o SQL crudo por igual.
2. **Subpath `/drizzle`** (opcional): fábricas de tablas parametrizadas por la
   columna de tenant (`{ columna, tabla, tipo: "uuid"|"text" }`) con
   `columnasExtra`; las funciones reciben un `DbClient` (`db | tx`). `drizzle-orm`
   es **peerDependency** (`>=0.45 <0.46`). El paquete **no trae migraciones** —
   cada app las genera con drizzle-kit.
3. **Subpath `/next`** (opcional): helpers para Next; `next`/`react` como peer
   **solo ahí**. **Subpath `/pruebas`**: fixtures e invariantes exportadas para
   que cada app corra los mismos chequeos sobre sus datos.
4. **DDL de referencia** en `sql/` para consumidores sin Drizzle.
5. Funciones que **exigen transacción** lo dicen en su tipo (no en un comentario)
   y fallan ruidosamente si el driver no la soporta.
6. **Cobertura ≥ 95%** en el núcleo puro; **property-based tests** (fast-check)
   para toda lógica de plata.
7. Versionado **0.x** (un minor puede romper); cada cambio con su **changeset**.
   README con **API real y un ejemplo por función exportada**; CHANGELOG.
8. Nada de reglas comerciales, precios ni textos propios de un producto dentro de
   un paquete — eso vive en el producto que lo consume.

Plata: centavos en `bigint`; factores como string decimal de 8 dígitos; redondeo
medio hacia arriba solo al final; repartos por mayor resto (no por mayor peso).

## Cómo agregar un paquete

```sh
bun scripts/nuevo-paquete.ts <nombre>
```

Valida que `<nombre>` sea kebab-case en minúsculas y que no exista ya. Genera
`packages/<nombre>` con la estructura estándar: `package.json` (exports → `dist`,
`files: [dist, README.md, CHANGELOG.md, sql]`, `publishConfig.access: "public"`,
`publishConfig.provenance: true`), `src/index.ts`, `tests/`, `tsconfig.build.json`,
`README.md` (con sección `## API`) y `CHANGELOG.md`.

El resultado debe pasar `tests/estructura.test.ts` (`bun run test`), que recorre
`packages/*` y hace cumplir las reglas de diseño de arriba: núcleo sin
`drizzle-orm`/`next`/`react`/`@aws-sdk`/`process.env` (salvo en `src/drizzle/` y
`src/next/`), README con `## API`, CHANGELOG, `exports`/`files` apuntando a `dist`,
licencia MIT.

Antes de publicar: completar la lógica real en `src/index.ts`, el README con la
API real y un ejemplo por función, y el CHANGELOG. `bun run build && bun run
lint:paquetes` deben quedar en verde (`publint` + `attw --pack --profile
esm-only`; nuestros paquetes son solo-ESM por diseño).

## Postgres para tests

Los paquetes con `/drizzle` que necesiten Postgres para sus tests lo levantan con
`docker compose` **a secas** (sin `DOCKER_API_VERSION` ni otras variables) contra
el puerto **5475** (tmpfs, para no pisar los Postgres de otros proyectos locales —
ver `~/.claude/CLAUDE.md` para la tabla completa de puertos en uso en esta
máquina). Antes de asumir un puerto libre, `docker ps --format '{{.Names}}\t
{{.Ports}}'`.

`docker-compose.yml` en la raíz define el servicio `db_test`
(`postgres:17-alpine`, tmpfs, `POSTGRES_PASSWORD=postgres`, base
`paquetes_test`, healthcheck):

```sh
docker compose up -d db_test
```

Los tests que TOCAN Postgres (típicamente `packages/*/tests/drizzle/postgres.test.ts`)
leen `DATABASE_URL_TEST` (default
`postgres://postgres:postgres@localhost:5475/paquetes_test`, que coincide con
`db_test`). **Si Postgres no está arriba, esos tests FALLAN** con un mensaje
que dice "correr `docker compose up -d db_test`" — nunca se saltean en
silencio. Los demás tests bajo `tests/drizzle/` (verificaciones estructurales
sobre el esquema de Drizzle en JS, sin tocar la base) corren siempre. `bun
run test` corre todo (requiere Docker para el/los archivo(s) que tocan
Postgres); `bun run test:sin-db` excluye solo esos archivos (hoy,
`**/tests/drizzle/postgres.test.ts`) — para iterar rápido sin Docker.

## Tooling

- **bun 1.3.x únicamente** — nunca `npm`/`npx`. `bunx` para correr binarios de
  dependencias (publint, attw, changeset).
- Vitest 5: no existe `vitest.workspace.ts`/`defineWorkspace` en esta versión (se
  eliminó); la configuración vive en `vitest.config.ts` con `test.projects`.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, ESM
  (`module`/`moduleResolution: NodeNext`), `target: ES2022`. Cada paquete extiende
  esto desde su `tsconfig.build.json` y compila a `dist/` (ESM + `.d.ts`).
