import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `retenciones-ar` depende de `@mafesoftware/plata-ar` dentro del mismo
 * monorepo (`workspace:^`), y su subpath `/drizzle` de
 * `@mafesoftware/tenant/drizzle` (mismo criterio que
 * `packages/outbox/vitest.config.ts` / `packages/numeradores/vitest.config.ts`).
 * Sus `package.json` exponen `exports` apuntando a `dist/`, pero
 * `bun run test` corre ANTES que `bun run build`, así que ese `dist/`
 * todavía no existe cuando vitest resuelve el import.
 *
 * Este alias redirige esos specifiers al CÓDIGO FUENTE para los tests
 * DENTRO de este monorepo — el equivalente para `tsc` es el "paths" de
 * `tsconfig.json`/`tsconfig.base.json`. Una app que instale
 * `@mafesoftware/retenciones-ar` de verdad sigue resolviendo contra el
 * `dist` publicado de esos paquetes.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@mafesoftware/tenant/drizzle": fileURLToPath(new URL("../tenant/src/drizzle/index.ts", import.meta.url)),
      "@mafesoftware/plata-ar": fileURLToPath(new URL("../plata-ar/src/index.ts", import.meta.url)),
    },
  },
});
