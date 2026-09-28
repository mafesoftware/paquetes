#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nombres válidos: kebab-case en minúsculas (ej: "plata-ar"). */
const NOMBRE_VALIDO = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const RAIZ_MONOREPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface OpcionesNuevoPaquete {
  /** Raíz del monorepo donde crear `packages/<nombre>`. Por defecto, la raíz real. Pensado para tests. */
  raiz?: string;
  /**
   * Nombres de OTROS paquetes de este monorepo (sin el scope `@mafesoftware/`,
   * ej. `"tenant"`) de los que este paquete depende como `workspace:^`. Cada
   * uno tiene que existir ya en `packages/<nombre>` — si no, `crearPaquete`
   * tira (evita un typo silencioso). Con al menos una dependencia, se genera
   * el par de tsconfig (typecheck contra la fuente de la dependencia, build
   * contra su dist) y el alias de vitest que necesita, copiando el patrón de
   * `packages/numeradores` — ver el README, sección "Tooling".
   */
  dependencias?: string[];
}

/** Ruta donde quedaría `packages/<nombre>` dada una raíz (real o de test). */
export function rutaPaquete(nombre: string, opciones: OpcionesNuevoPaquete = {}): string {
  const raiz = opciones.raiz ?? RAIZ_MONOREPO;
  return join(raiz, 'packages', nombre);
}

/**
 * Crea la estructura estándar de un paquete nuevo en `packages/<nombre>`
 * (o bajo `opciones.raiz` si se pasa, para poder testear sin tocar el repo real).
 * Devuelve la ruta del paquete creado.
 */
export function crearPaquete(nombre: string, opciones: OpcionesNuevoPaquete = {}): string {
  if (!NOMBRE_VALIDO.test(nombre)) {
    throw new Error(
      `Nombre de paquete inválido: "${nombre}". Debe ser kebab-case en minúsculas (ej: "plata-ar"), sin espacios, mayúsculas ni guiones bajos.`,
    );
  }

  const raiz = opciones.raiz ?? RAIZ_MONOREPO;
  const dependencias = opciones.dependencias ?? [];
  for (const dependencia of dependencias) {
    if (!NOMBRE_VALIDO.test(dependencia)) {
      throw new Error(`Nombre de dependencia inválido: "${dependencia}" (mismo formato que el nombre de un paquete).`);
    }
    if (!existsSync(join(raiz, 'packages', dependencia))) {
      throw new Error(
        `La dependencia "${dependencia}" no existe en packages/ — creala primero (o revisá si es un typo).`,
      );
    }
  }

  const destino = rutaPaquete(nombre, opciones);
  if (existsSync(destino)) {
    throw new Error(`Ya existe un paquete en ${destino}`);
  }

  mkdirSync(join(destino, 'src'), { recursive: true });
  mkdirSync(join(destino, 'tests'), { recursive: true });

  writeFileSync(join(destino, 'package.json'), `${JSON.stringify(packageJson(nombre, dependencias), null, 2)}\n`);
  writeFileSync(join(destino, 'src', 'index.ts'), SRC_INDEX);
  writeFileSync(join(destino, 'tests', 'index.test.ts'), testsIndex());
  // Copia la LICENSE de la raíz REAL del monorepo (no la de `opciones.raiz`,
  // que en los tests es un directorio de prueba sin LICENSE propia): es el
  // mismo texto MIT para todo el monorepo, y `tests/estructura.test.ts`
  // exige que cada packages/<nombre> tenga la suya (spec 06 §3, regla 6 —
  // aunque `npm`/`bun pm pack` suban la LICENSE de la raíz igual sin que
  // "files" la liste, tenerla en cada paquete es lo que espera esa
  // verificación estructural).
  writeFileSync(join(destino, 'LICENSE'), readFileSync(join(RAIZ_MONOREPO, 'LICENSE')));

  if (dependencias.length > 0) {
    // Copiado del patrón de packages/numeradores: el par de tsconfig
    // (typecheck contra la FUENTE de la dependencia — todavía no tiene
    // dist/ en el paso de typecheck de CI —, build contra su dist ya
    // buildeado, por el orden topológico de `bun run --filter build`) y el
    // alias de vitest (los tests corren ANTES que el build, ver
    // `packages/numeradores/vitest.config.ts`).
    writeFileSync(join(destino, 'tsconfig.json'), tsconfigTypecheckConDependencias());
    writeFileSync(join(destino, 'tsconfig.build.json'), tsconfigBuildConDependencias());
    writeFileSync(join(destino, 'vitest.config.ts'), vitestConfigConDependencias(raiz, dependencias));
  } else {
    writeFileSync(join(destino, 'tsconfig.build.json'), `${JSON.stringify(tsconfigBuild(), null, 2)}\n`);
  }

  writeFileSync(join(destino, 'README.md'), readme(nombre));
  writeFileSync(join(destino, 'CHANGELOG.md'), CHANGELOG_INICIAL);

  return destino;
}

function packageJson(nombre: string, dependencias: string[] = []): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: `@mafesoftware/${nombre}`,
    version: '0.0.0',
    type: 'module',
    license: 'MIT',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
    },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist', 'README.md', 'CHANGELOG.md', 'sql'],
    publishConfig: {
      access: 'public',
      provenance: true,
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/mafesoftware/paquetes.git',
      directory: `packages/${nombre}`,
    },
    scripts: {
      build: 'tsc -p tsconfig.build.json',
      test: 'vitest run',
      // Con dependencias, "tsconfig.json" (sin "rootDir") es el que puede
      // typecheckear contra la FUENTE de la dependencia — ver
      // tsconfigTypecheckConDependencias.
      typecheck: dependencias.length > 0 ? 'tsc -p tsconfig.json --noEmit' : 'tsc -p tsconfig.build.json --noEmit',
    },
  };

  if (dependencias.length > 0) {
    // "workspace:^" (no "workspace:*"): `scripts/reescribir-workspace.ts` lo
    // reescribe a "^x.y.z" al publicar, que permite actualizaciones
    // compatibles de la dependencia sin forzar una nueva publicación del
    // paquete que la consume (ver changeset "workspace-caret-no-star").
    base.dependencies = Object.fromEntries(dependencias.map((dependencia) => [`@mafesoftware/${dependencia}`, 'workspace:^']));
  }

  return base;
}

function tsconfigBuild(): Record<string, unknown> {
  return {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      outDir: 'dist',
      rootDir: 'src',
    },
    include: ['src'],
  };
}

/**
 * `tsconfig.json` (typecheck, sin build) para un paquete CON dependencias
 * `workspace:*`: extiende `tsconfig.base.json`, que ya trae el `paths`
 * genérico (con entradas para el núcleo y para los subpaths "drizzle",
 * "next" y "pruebas" de cualquier paquete) que resuelve CUALQUIER
 * dependencia del monorepo contra su código FUENTE — no hace falta
 * declarar un `paths` propio acá, a diferencia del patrón más viejo (ver
 * `packages/cuotas`/`reservas`, que predatan ese `paths` genérico). Sin
 * "rootDir" a propósito: con "rootDir": "src" (como en tsconfig.build.json),
 * TS rechazaría los archivos de la dependencia (fuera de "src" de ESTE
 * paquete) con TS6059 ("not under rootDir") aunque no vaya a emitir nada.
 */
function tsconfigTypecheckConDependencias(): string {
  return `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    // Sin "rootDir" acá a propósito: este archivo es el que usa
    // \`bun run typecheck\` (vía "paths" de ../../tsconfig.base.json, que
    // resuelve las dependencias \`workspace:*\` de este paquete contra su
    // CÓDIGO FUENTE, no contra dist — todavía no están buildeadas en el
    // paso de typecheck de CI). Si tuviera "rootDir": "src" como
    // tsconfig.build.json, TS rechazaría esos archivos de la dependencia
    // con TS6059 ("not under rootDir") aunque no vaya a emitir nada.
    // tsconfig.build.json (que sí necesita "rootDir": "src", para el dist)
    // extiende este archivo y limpia "paths" para no pisar este problema —
    // ver su comentario. Patrón copiado de packages/numeradores.
    "types": ["node"]
  },
  "include": ["src"]
}
`;
}

/**
 * `tsconfig.build.json` para un paquete CON dependencias: extiende
 * `tsconfig.json` (arriba) pero limpia `paths` — con `rootDir: "src"`, ese
 * `paths` (que apunta a la FUENTE de la dependencia) rechazaría la emisión
 * con TS6059. Con `paths` vacío, TS cae a la resolución normal de
 * `node_modules` (el symlink de workspace hacia el `dist` YA buildeado de
 * la dependencia — el build corre en orden topológico).
 */
function tsconfigBuildConDependencias(): string {
  return `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false,
    // Limpia el "paths" que hereda (vía tsconfig.json) de
    // ../../tsconfig.base.json: ESE paths resuelve las dependencias
    // \`workspace:*\` de este paquete contra su código FUENTE, que queda
    // fuera de "rootDir": "src" y TS lo rechaza con TS6059 ("not under
    // rootDir") en cuanto intenta tipar la emisión. Con "paths" vacío, TS
    // cae a la resolución NORMAL de node_modules: el símlink de workspace
    // y su "exports" -> "./dist/...". Esto funciona porque
    // \`bun run --filter './packages/*' build\` corre en orden topológico
    // (la dependencia antes que este paquete), así que ya está buildeada
    // cuando le toca a este paquete. "tsconfig.json" (typecheck, sin
    // build) sigue usando el "paths" con código fuente, porque en CI el
    // paso de typecheck corre ANTES que el de build.
    "paths": {}
  },
  "include": ["src"]
}
`;
}

/**
 * El alias de vitest que necesita cada dependencia `workspace:*`: los tests
 * corren ANTES que `bun run build` (ver README, sección "Tooling"), así que
 * el `dist/` publicado de la dependencia todavía no existe cuando vitest
 * intenta resolver su specifier — este alias lo redirige a la FUENTE de la
 * dependencia. Si la dependencia tiene un subpath `/drizzle`
 * (`src/drizzle/index.ts`), también se alias-ea ese subpath — no se puede
 * saber de antemano cuál de los dos (o ambos) va a terminar usando el
 * paquete nuevo, así que se cubren los que existan.
 */
function vitestConfigConDependencias(raiz: string, dependencias: string[]): string {
  const lineasAlias: string[] = [];
  for (const dependencia of dependencias) {
    lineasAlias.push(
      `      '@mafesoftware/${dependencia}': fileURLToPath(new URL('../${dependencia}/src/index.ts', import.meta.url)),`,
    );
    if (existsSync(join(raiz, 'packages', dependencia, 'src', 'drizzle', 'index.ts'))) {
      lineasAlias.push(
        `      '@mafesoftware/${dependencia}/drizzle': fileURLToPath(new URL('../${dependencia}/src/drizzle/index.ts', import.meta.url)),`,
      );
    }
  }

  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Este paquete depende de ${dependencias.map((dependencia) => `\`@mafesoftware/${dependencia}\``).join(' y ')} dentro
 * del mismo monorepo (\`workspace:*\`). \`bun run test\` corre ANTES que
 * \`bun run build\` (ver README, sección "Tooling"), así que el \`dist/\` de
 * esas dependencias todavía no existe cuando corren los tests de este
 * paquete. Este alias resuelve cada dependencia directo a su fuente para
 * los tests, sin tocar el \`package.json\` publicado (que sigue apuntando a
 * \`dist/\` para quien lo instale desde npm). Patrón copiado de
 * packages/numeradores.
 */
export default defineConfig({
  resolve: {
    alias: {
${lineasAlias.join('\n')}
    },
  },
});
`;
}

const SRC_INDEX = `/**
 * Función de ejemplo generada por \`scripts/nuevo-paquete.ts\`.
 * Reemplazar por la lógica real del paquete.
 */
export function saludar(nombre: string): string {
  return \`Hola, \${nombre}!\`;
}
`;

function testsIndex(): string {
  return `import { describe, expect, it } from 'vitest';
import { saludar } from '../src/index.js';

describe('saludar', () => {
  it('saluda por nombre', () => {
    expect(saludar('Mundo')).toBe('Hola, Mundo!');
  });
});
`;
}

function readme(nombre: string): string {
  return `# ${nombre}

Descripción pendiente: completar el propósito de este paquete.

## API

### \`saludar(nombre: string): string\`

Ejemplo generado por \`scripts/nuevo-paquete.ts\`; reemplazar por la API real.

\`\`\`ts
import { saludar } from '@mafesoftware/${nombre}';

saludar('Mundo'); // "Hola, Mundo!"
\`\`\`
`;
}

const CHANGELOG_INICIAL = `# Changelog

## 0.0.0

Paquete generado con \`scripts/nuevo-paquete.ts\`.
`;

/**
 * Parsea `process.argv.slice(2)`: el primer argumento que no empiece con
 * `--` es el nombre del paquete; `--con-dependencias=<a>,<b>` (con o sin
 * espacios alrededor de cada nombre) da la lista de dependencias
 * `workspace:*`. El orden entre ambos no importa. Exportada (separada de
 * la invocación de CLI de más abajo) para poder testearla sin tocar
 * `process.argv`.
 */
export function parsearArgumentosCli(argumentos: string[]): { nombre?: string; dependencias: string[] } {
  const nombre = argumentos.find((argumento) => !argumento.startsWith('--'));
  const banderaDependencias = argumentos.find((argumento) => argumento.startsWith('--con-dependencias'));
  const dependencias = banderaDependencias
    ? (banderaDependencias.split('=')[1] ?? '')
        .split(',')
        .map((dependencia) => dependencia.trim())
        .filter((dependencia) => dependencia.length > 0)
    : [];
  return { nombre, dependencias };
}

function esInvocacionDirecta(): boolean {
  const argvPrincipal = process.argv[1];
  return Boolean(argvPrincipal) && import.meta.url === new URL(argvPrincipal as string, 'file://').href;
}

if (esInvocacionDirecta()) {
  const { nombre, dependencias } = parsearArgumentosCli(process.argv.slice(2));
  if (!nombre) {
    console.error('Uso: bun scripts/nuevo-paquete.ts <nombre> [--con-dependencias=<paquete1>,<paquete2>]');
    process.exit(1);
  }
  try {
    const destino = crearPaquete(nombre, { dependencias });
    console.log(`Paquete creado en ${destino}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
