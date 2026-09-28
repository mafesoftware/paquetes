import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `indices-ar` depende de `@mafesoftware/plata-ar` y `@mafesoftware/fechas-ar`
 * dentro del mismo monorepo (`workspace:*`). Sus `package.json` exponen
 * `exports` apuntando a `dist/`, pero `bun run test` corre ANTES que
 * `bun run build` (mismo orden que packages/cuotas/vitest.config.ts), así que
 * ese `dist/` todavía no existe cuando vitest resuelve el import.
 *
 * Este alias redirige esos dos specifiers al CÓDIGO FUENTE para los tests
 * DENTRO de este monorepo — el equivalente para `tsc` es el "paths" de
 * `tsconfig.json`/`tsconfig.base.json`. Una app que instale
 * `@mafesoftware/indices-ar` de verdad sigue resolviendo contra el `dist`
 * publicado de esos dos paquetes.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mafesoftware/plata-ar': fileURLToPath(new URL('../plata-ar/src/index.ts', import.meta.url)),
      '@mafesoftware/fechas-ar': fileURLToPath(new URL('../fechas-ar/src/index.ts', import.meta.url)),
    },
  },
});
