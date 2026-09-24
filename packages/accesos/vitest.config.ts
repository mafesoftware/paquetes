import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `accesos` depende de `@mafesoftware/fechas-ar` dentro del mismo monorepo.
 * Ver el comentario en `packages/cuotas/vitest.config.ts`: este alias
 * resuelve esa dependencia a su fuente para los tests (que corren antes que
 * `bun run build`), sin tocar el `package.json` publicado.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mafesoftware/fechas-ar': fileURLToPath(new URL('../fechas-ar/src/index.ts', import.meta.url)),
    },
  },
});
