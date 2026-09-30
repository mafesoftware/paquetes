import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `proveedores` depende de `@mafesoftware/plata-ar` dentro del mismo
 * monorepo (`workspace:^`). Su `package.json` expone `exports` apuntando a
 * `dist/`, pero `bun run test` corre ANTES que `bun run build` (mismo
 * orden que packages/indices-ar/vitest.config.ts), así que ese `dist/`
 * todavía no existe cuando vitest intenta resolver el import.
 *
 * Este alias redirige ese specifier al CÓDIGO FUENTE para los tests DENTRO
 * de este monorepo — el equivalente para `tsc` es el "paths" de
 * `tsconfig.json`/`tsconfig.base.json`. Una app que instale
 * `@mafesoftware/proveedores` de verdad sigue resolviendo contra el `dist`
 * publicado de plata-ar.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@mafesoftware/plata-ar": fileURLToPath(new URL("../plata-ar/src/index.ts", import.meta.url)),
    },
  },
});
