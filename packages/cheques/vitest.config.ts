import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Este paquete depende de `@mafesoftware/fechas-ar` dentro
 * del mismo monorepo (`workspace:*`). `bun run test` corre ANTES que
 * `bun run build` (ver README, sección "Tooling"), así que el `dist/` de
 * esas dependencias todavía no existe cuando corren los tests de este
 * paquete. Este alias resuelve cada dependencia directo a su fuente para
 * los tests, sin tocar el `package.json` publicado (que sigue apuntando a
 * `dist/` para quien lo instale desde npm). Patrón copiado de
 * packages/numeradores.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mafesoftware/fechas-ar': fileURLToPath(new URL('../fechas-ar/src/index.ts', import.meta.url)),
    },
  },
});
