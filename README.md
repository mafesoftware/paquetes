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

## Publicar

Publicación por changesets (`bun run changeset` para agregar uno, `bun run release`
para versionar y publicar) con npm trusted publishing (OIDC) y provenance al
mergear a `main`. El detalle completo de este flujo lo documenta la tarea P.2.
