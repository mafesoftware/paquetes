#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nombres válidos: kebab-case en minúsculas (ej: "plata-ar"). */
const NOMBRE_VALIDO = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const RAIZ_MONOREPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface OpcionesNuevoPaquete {
  /** Raíz del monorepo donde crear `packages/<nombre>`. Por defecto, la raíz real. Pensado para tests. */
  raiz?: string;
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

  const destino = rutaPaquete(nombre, opciones);
  if (existsSync(destino)) {
    throw new Error(`Ya existe un paquete en ${destino}`);
  }

  mkdirSync(join(destino, 'src'), { recursive: true });
  mkdirSync(join(destino, 'tests'), { recursive: true });

  writeFileSync(join(destino, 'package.json'), `${JSON.stringify(packageJson(nombre), null, 2)}\n`);
  writeFileSync(join(destino, 'src', 'index.ts'), SRC_INDEX);
  writeFileSync(join(destino, 'tests', 'index.test.ts'), testsIndex());
  writeFileSync(join(destino, 'tsconfig.build.json'), `${JSON.stringify(tsconfigBuild(), null, 2)}\n`);
  writeFileSync(join(destino, 'README.md'), readme(nombre));
  writeFileSync(join(destino, 'CHANGELOG.md'), CHANGELOG_INICIAL);

  return destino;
}

function packageJson(nombre: string): Record<string, unknown> {
  return {
    name: `@mafesoftware/${nombre}`,
    version: '0.0.0',
    type: 'module',
    license: 'MIT',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
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
      typecheck: 'tsc -p tsconfig.build.json --noEmit',
    },
  };
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

function esInvocacionDirecta(): boolean {
  const argvPrincipal = process.argv[1];
  return Boolean(argvPrincipal) && import.meta.url === new URL(argvPrincipal as string, 'file://').href;
}

if (esInvocacionDirecta()) {
  const nombre = process.argv[2];
  if (!nombre) {
    console.error('Uso: bun scripts/nuevo-paquete.ts <nombre>');
    process.exit(1);
  }
  try {
    const destino = crearPaquete(nombre);
    console.log(`Paquete creado en ${destino}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
