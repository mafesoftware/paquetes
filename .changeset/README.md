# Changesets

Cada cambio que deba versionarse va acompañado de un changeset: `bun run changeset`
(equivalente a `bunx changeset add`). Al mergear a `main`, el pipeline de release
corre `bun run release` (`bun run build && changeset publish`), que versiona y
publica los paquetes con changesets pendientes.

Más info: https://github.com/changesets/changesets
