# @mafesoftware/paquetes

Monorepo de paquetes npm reutilizables `@mafesoftware/*`, públicos y con licencia MIT,
consumidos por varios productos de MAFE Software (store360/tienda360, consult360,
Padel360, gestionflow, ediflow, distrigo, azife…). La idea: un bug arreglado acá
queda arreglado en todos los productos que lo usan; cada producto solo configura y
compone estos paquetes.

Ver `docs/specs/06-paquetes.md` (en el repo de Obriq) para el diseño completo y el
catálogo de paquetes previsto.

## Paquetes

| Paquete | Versión | Descripción |
|---|---|---|
| _(todavía no hay paquetes publicados desde este monorepo)_ | | |

## Cómo desarrollar

Requiere [bun](https://bun.sh) 1.3.x. Nunca `npm`/`npx`; para correr binarios de
dependencias, `bunx`.

```sh
bun install          # instala dependencias del workspace
bun run test         # vitest, corre tests de la raíz y de cada packages/*
bun run typecheck    # tsc de la raíz + typecheck de cada paquete
bun run build        # compila cada paquete a dist/ (ESM + .d.ts)
bun run lint:paquetes # publint + attw --pack sobre cada paquete ya compilado
```

### Agregar un paquete nuevo

```sh
bun scripts/nuevo-paquete.ts <nombre>
```

Genera `packages/<nombre>` con la estructura estándar (`package.json`, `src/index.ts`,
`tests/`, `tsconfig.build.json`, `README.md` con sección `## API`, `CHANGELOG.md`).
El resultado debe pasar `tests/estructura.test.ts` (reglas de diseño de un paquete,
ver `CLAUDE.md`).

### Postgres para tests

Los paquetes que necesiten Postgres para sus tests lo levantan con
`docker compose` (a secas, sin variables de entorno) contra el puerto **5475**
(tmpfs). Ver `CLAUDE.md`.

## CI

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main`:
`bun install --frozen-lockfile`, `typecheck`, `test` con cobertura (umbral 95% en
líneas/ramas/funciones/statements sobre el núcleo de cada paquete,
`packages/*/src/**` sin `/drizzle`, `/next`, `/pruebas` ni archivos de test — ver
`vitest.config.ts` y `tests/cobertura-config.test.ts`), `build` y `lint:paquetes`
(`publint` + `attw --pack --profile esm-only` por paquete). Incluye un servicio
Postgres en el puerto **5475** (sin uso todavía: llega con los paquetes `/drizzle`
en P.8+).

En los PRs que tocan `packages/`, un segundo job (`changeset`) exige que haya un
changeset pendiente (`bunx changeset status --since=origin/main`); si el PR no
toca `packages/`, no se exige.

## Publicar

Publicación por [changesets](https://github.com/changesets/changesets):
`bun run changeset` agrega uno por cada cambio, y al mergearse a `main`,
`.github/workflows/release.yml` (`changesets/action`) abre o actualiza un PR
"Version Packages"; al mergear ESE PR, el mismo workflow corre `bun run release`
(`build` + `reescribir-workspace.ts` + `changeset publish`) y publica en npm
con **provenance** vía **OIDC trusted publishing**
(`permissions.id-token: write`, variable `NPM_CONFIG_PROVENANCE=true`) — sin
ningún `NPM_TOKEN` en secrets.

### Dependencias entre paquetes del monorepo (`workspace:*`)

Un paquete puede depender de otro de este mismo monorepo (hoy,
`@mafesoftware/numeradores` de `@mafesoftware/tenant`, vía
`@mafesoftware/tenant/drizzle`) con `"workspace:*"` en su `package.json` —
así `bun install` resuelve esa dependencia contra el `packages/<nombre>`
local, no contra un paquete publicado, y no hace falta bumpear/publicar el
paquete del que depende antes de poder desarrollar el que lo consume.

**`changeset publish` NO reescribe `"workspace:"`** — corre `npm publish` por
abajo, y npm no entiende ese protocolo (es de los gestores de paquetes con
workspaces: bun/pnpm/yarn). Publicado tal cual, un consumidor externo
(`npm install @mafesoftware/numeradores`) recibiría un `package.json` con
`"@mafesoftware/tenant": "workspace:*"` literal, que npm no puede resolver.

`scripts/reescribir-workspace.ts` (funciones puras testeadas en
`tests/reescribir-workspace.test.ts`) reescribe, en cada
`packages/*/package.json`, todo especificador `"workspace:"` de
`dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`
(las cuatro — incluye `devDependencies` porque `npm publish` las sube tal
cual igual, aunque un consumidor no las instale) a la versión REAL
del paquete referenciado (`"workspace:*"` → `"x.y.z"` exacta; `workspace:^`/
`workspace:~` → `"^x.y.z"`/`"~x.y.z"`). El script `"release"` de la
raíz lo corre DESPUÉS de `build` y ANTES de `changeset publish` — mutando
los `package.json` del checkout de ESE job de CI, que es descartable (no hay
ningún paso posterior en "Release" que dependa del código fuente sin
reescribir). Nunca se corre en el job "CI" (typecheck/test/build/lint): esos
pasos necesitan el `"workspace:*"` real para que `bun` resuelva las
dependencias de workspace en desarrollo.

`bun run lint:paquetes` incluye, para cada paquete con alguna dependencia
`"workspace:"`, un chequeo de regresión de esto: copia el paquete a un
directorio descartable, aplica la misma reescritura, empaqueta con
`bun pm pack` y falla si el `package.json` EMPAQUETADO todavía tiene
`"workspace:"` — la misma combinación que corre `release`, para detectar acá
(en cada CI normal) un `reescribirPackageJson` que dejó de cubrir algo,
en vez de recién notarlo cuando `npm install` le falla a un consumidor real.

**`bun scripts/reescribir-workspace.ts` corrido a mano (`bun run release`
en la laptop de alguien, por ejemplo) se niega a correr si `CI` no es
`"true"`**, salvo que se le pase `--forzar`: sin este freno, un
desarrollador que corre `release` local para probar el flujo se queda con
los `package.json` reescritos (`"workspace:*"` → una versión exacta) en su
working tree — fácil de commitear sin querer, o de dejarlos así y que el
próximo `bun install` se confunda. Si hace falta correrlo local de todos
modos: `bun scripts/reescribir-workspace.ts --forzar`, y después
`git checkout -- 'packages/*/package.json'` para revertir.

Trusted publishing exige que el paquete **ya exista** en npm y tenga el
"Trusted Publisher" de ese repo configurado ahí. Para un paquete nuevo, hay un
paso manual único, del usuario, la única vez que este monorepo usa el CLI de
`npm` (no `bun`):

### 1. Primera publicación de un paquete nuevo (manual, una sola vez)

Desde la terminal del usuario, con su cuenta npm `mafe-software` ya logueada
(`npm whoami` debe devolver `mafe-software`; si no, `npm login`):

```sh
cd packages/<nombre-del-paquete>
bun run build
npm publish --access public
```

(Sin `--provenance`: para la primera publicación no hace falta —la provenance
la agrega el CI en publicaciones siguientes— y sin trusted publisher configurado
todavía, `--provenance` fallaría igual.)

### 2. Configurar el Trusted Publisher en npmjs.com

Para **cada paquete**, en `https://www.npmjs.com/package/@mafesoftware/<nombre>`
→ *Settings* → *Trusted Publisher* → *GitHub Actions*:

- Repository: `mafesoftware/paquetes`
- Workflow filename: `release.yml`
- Environment: (vacío/ninguno; este flujo no usa un environment de GitHub)

### 3. De ahí en adelante: automático

Cada PR mergeado a `main` que trae un changeset dispara `release.yml`: agrupa
los pendientes en el PR "Version Packages" (bump de versión + CHANGELOG). Al
mergear ese PR, el mismo workflow publica cada paquete con `npm publish
--provenance` por OIDC — no hace falta tocar la terminal del usuario ni ningún
token.

### 4. Housekeeping: rotar el token viejo de npm

`~/.npmrc` tiene una línea de un token viejo (heredado de la infraestructura de
`@dealsyte`, ya borrada — ver `~/.claude/CLAUDE.md`). Con trusted publishing en
uso, ese token no hace falta para este repo. Rotarlo:

1. En GitHub → *Settings* → *Developer settings* → *Personal access tokens*,
   revocar el token viejo (el que usa la línea de abajo).
2. Borrar del `~/.npmrc` del usuario las dos líneas del scope `@dealsyte`
   (infraestructura de Finalis, borrada el 24-ago-2026 — ver
   `~/.claude/CLAUDE.md`): `@dealsyte:registry=https://npm.pkg.github.com` y su
   `//npm.pkg.github.com/:_authToken=...` correspondiente. Dejar intactas las
   líneas de `//registry.npmjs.org/:_authToken=...` (esas son las de la cuenta
   `mafe-software`, no de `@dealsyte`).
