import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAMPOS_CON_DEPENDENCIAS,
  reescribirEspecificador,
  reescribirPackageJson,
  reescribirTodos,
  versionesDeWorkspace,
} from '../scripts/reescribir-workspace.js';

describe('CAMPOS_CON_DEPENDENCIAS', () => {
  // `scripts/lint-paquetes.ts` (`tieneDependenciaWorkspace`) detecta
  // "workspace:" en el package.json ENTERO, sin distinguir el campo — este
  // test documenta que la reescritura cubre `devDependencies` también,
  // para que las dos partes queden consistentes (R4, ronda 2 de revisión).
  it('incluye devDependencies, además de dependencies/peerDependencies/optionalDependencies', () => {
    expect(CAMPOS_CON_DEPENDENCIAS).toEqual([
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]);
  });
});

describe('reescribirEspecificador', () => {
  it('"workspace:*" -> la versión exacta', () => {
    expect(reescribirEspecificador('workspace:*', '1.2.3')).toBe('1.2.3');
  });

  it('"workspace:^" -> "^" + la versión', () => {
    expect(reescribirEspecificador('workspace:^', '1.2.3')).toBe('^1.2.3');
  });

  it('"workspace:~" -> "~" + la versión', () => {
    expect(reescribirEspecificador('workspace:~', '1.2.3')).toBe('~1.2.3');
  });

  it('un especificador que NO es "workspace:" se deja tal cual', () => {
    expect(reescribirEspecificador('^1.0.0', '1.2.3')).toBe('^1.0.0');
    expect(reescribirEspecificador('*', '1.2.3')).toBe('*');
  });

  it('sin versión conocida (paquete no encontrado), se deja tal cual en vez de romper', () => {
    expect(reescribirEspecificador('workspace:*', undefined)).toBe('workspace:*');
  });
});

describe('reescribirPackageJson', () => {
  it('reescribe dependencies/peerDependencies/optionalDependencies', () => {
    const pkg = {
      name: '@mafesoftware/numeradores',
      dependencies: { '@mafesoftware/tenant': 'workspace:*' },
      peerDependencies: { '@mafesoftware/otra': 'workspace:^' },
      optionalDependencies: { '@mafesoftware/opcional': 'workspace:~' },
    };
    const versiones = { '@mafesoftware/tenant': '0.1.0', '@mafesoftware/otra': '2.0.0', '@mafesoftware/opcional': '3.0.0' };

    const cambios = reescribirPackageJson(pkg, versiones);

    expect(pkg.dependencies['@mafesoftware/tenant']).toBe('0.1.0');
    expect(pkg.peerDependencies['@mafesoftware/otra']).toBe('^2.0.0');
    expect(pkg.optionalDependencies['@mafesoftware/opcional']).toBe('~3.0.0');
    expect(cambios).toHaveLength(3);
  });

  // R4 (ronda 2 de revisión): devDependencies SÍ se reescribe — antes no,
  // pero `npm publish` sube devDependencies tal cual igual (un consumidor
  // no las instala, pero quedan en el package.json publicado), y
  // `scripts/lint-paquetes.ts` ya las contaba como "workspace: a revisar"
  // (mira el archivo entero, sin distinguir el campo) — dejarlas afuera acá
  // hacía que el chequeo de `lint:paquetes` detectara un paquete con
  // "workspace:" en devDependencies, aplicara la reescritura (que las
  // dejaba intactas) y el `bun pm pack` de verificación fallara.
  it('reescribe devDependencies también (consistente con lo que detecta lint-paquetes.ts)', () => {
    const pkg = {
      name: '@mafesoftware/numeradores',
      devDependencies: { '@mafesoftware/tenant': 'workspace:*' },
    };
    const versiones = { '@mafesoftware/tenant': '0.1.0' };

    const cambios = reescribirPackageJson(pkg, versiones);

    expect(pkg.devDependencies['@mafesoftware/tenant']).toBe('0.1.0');
    expect(cambios).toEqual([
      { campo: 'devDependencies', paquete: '@mafesoftware/tenant', de: 'workspace:*', a: '0.1.0' },
    ]);
  });

  it('sin ningún "workspace:", no cambia nada y devuelve una lista vacía', () => {
    const pkg = { name: 'x', dependencies: { pg: '^8.0.0' } };
    const cambios = reescribirPackageJson(pkg, {});
    expect(cambios).toEqual([]);
    expect(pkg.dependencies.pg).toBe('^8.0.0');
  });

  it('sin dependencies/devDependencies/peerDependencies/optionalDependencies definidos, no rompe', () => {
    const pkg = { name: 'x' };
    expect(reescribirPackageJson(pkg, {})).toEqual([]);
  });
});

describe('versionesDeWorkspace / reescribirTodos (con un monorepo de prueba en disco)', () => {
  function armarMonorepoDePrueba(raiz: string): void {
    const dirTenant = join(raiz, 'tenant');
    const dirNumeradores = join(raiz, 'numeradores');
    mkdirSync(dirTenant, { recursive: true });
    mkdirSync(dirNumeradores, { recursive: true });
    writeFileSync(
      join(dirTenant, 'package.json'),
      JSON.stringify({ name: '@mafesoftware/tenant', version: '0.3.1' }, null, 2),
    );
    writeFileSync(
      join(dirNumeradores, 'package.json'),
      JSON.stringify(
        {
          name: '@mafesoftware/numeradores',
          version: '0.1.0',
          dependencies: { '@mafesoftware/tenant': 'workspace:*' },
        },
        null,
        2,
      ),
    );
  }

  it('versionesDeWorkspace lee nombre+version de cada packages/<nombre>/package.json', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'reescribir-workspace-'));
    try {
      armarMonorepoDePrueba(raiz);
      expect(versionesDeWorkspace(raiz)).toEqual({
        '@mafesoftware/tenant': '0.3.1',
        '@mafesoftware/numeradores': '0.1.0',
      });
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('con un directorio inexistente, devuelve un objeto vacío en vez de tirar', () => {
    expect(versionesDeWorkspace(join(tmpdir(), 'no-existe-nunca-12345'))).toEqual({});
  });

  it('reescribirTodos escribe el package.json de numeradores con la versión real de tenant', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'reescribir-workspace-'));
    try {
      armarMonorepoDePrueba(raiz);
      const cambios = reescribirTodos(raiz);

      expect(cambios['numeradores']).toEqual([
        { campo: 'dependencies', paquete: '@mafesoftware/tenant', de: 'workspace:*', a: '0.3.1' },
      ]);
      expect(cambios['tenant']).toEqual([]);

      const pkgEscrito = JSON.parse(readFileSync(join(raiz, 'numeradores', 'package.json'), 'utf8'));
      expect(pkgEscrito.dependencies['@mafesoftware/tenant']).toBe('0.3.1');
      // No queda ningún "workspace:" en el archivo.
      expect(readFileSync(join(raiz, 'numeradores', 'package.json'), 'utf8')).not.toContain('workspace:');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('un paquete sin ningún cambio no reescribe su archivo (contenido byte-idéntico)', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'reescribir-workspace-'));
    try {
      armarMonorepoDePrueba(raiz);
      const rutaTenant = join(raiz, 'tenant', 'package.json');
      const contenidoOriginal = readFileSync(rutaTenant, 'utf8');

      reescribirTodos(raiz);

      expect(readFileSync(rutaTenant, 'utf8')).toBe(contenidoOriginal);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
