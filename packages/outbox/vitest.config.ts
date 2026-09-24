import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Igual que `packages/numeradores/vitest.config.ts` y
 * `packages/auditoria/vitest.config.ts`: este paquete depende de OTRO
 * paquete del monorepo en tiempo de ejecución (`@mafesoftware/tenant/drizzle`,
 * workspace dependency). Node resuelve ese specifier vía el `exports` de
 * `tenant/package.json`, que apunta a `./dist/drizzle/index.js` — y en CI
 * el paso "Test" corre ANTES que "Build" (mismo orden que
 * `docker compose up -d db_test && bun install && bun run typecheck &&
 * bun run test -- --coverage && bun run build && bun run lint:paquetes`),
 * así que `tenant/dist` todavía no existe cuando vitest intenta importar
 * `tabla.ts` (que hace ese import).
 *
 * Este alias redirige ESE specifier al CÓDIGO FUENTE de tenant (mismo lugar
 * al que ya apunta `paths` en `../../tsconfig.base.json` para el
 * typecheck), así que los tests corren sin depender del orden del
 * pipeline — la app que instale `@mafesoftware/outbox` de verdad sigue
 * importando el `dist` publicado de tenant, esto es solo para los tests
 * DENTRO de este monorepo.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@mafesoftware/tenant/drizzle": fileURLToPath(new URL("../tenant/src/drizzle/index.ts", import.meta.url)),
    },
  },
});
