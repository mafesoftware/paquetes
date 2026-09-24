import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reescribirEspecificador,
  reescribirPackageJson,
  reescribirTodos,
  versionesDeWorkspace,
} from '../scripts/reescribir-workspace.js';

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
  it('reescribe dependencies/peerDependencies/optionalDependencies, no devDependencies', () => {
    const pkg = {
      name: '@mafesoftware/numeradores',
      dependencies: { '@mafesoftware/tenant': 'workspace:*' },
      peerDependencies: { '@mafesoftware/otra': 'workspace:^' },
      optionalDependencies: { '@mafesoftware/opcional': 'workspace:~' },
      devDependencies: { '@mafesoftware/tenant': 'workspace:*' },
    };
    const versiones = { '@mafesoftware/tenant': '0.1.0', '@mafesoftware/otra': '2.0.0', '@mafesoftware/opcional': '3.0.0' };

    const cambios = reescribirPackageJson(pkg, versiones);

    expect(pkg.dependencies['@mafesoftware/tenant']).toBe('0.1.0');
    expect(pkg.peerDependencies['@mafesoftware/otra']).toBe('^2.0.0');
    expect(pkg.optionalDependencies['@mafesoftware/opcional']).toBe('~3.0.0');
    // devDependencies NO se toca: no se publica como dependencia real.
    expect(pkg.devDependencies['@mafesoftware/tenant']).toBe('workspace:*');
    expect(cambios).toHaveLength(3);
  });

  it('sin ningún "workspace:", no cambia nada y devuelve una lista vacía', () => {
    const pkg = { name: 'x', dependencies: { pg: '^8.0.0' } };
    const cambios = reescribirPackageJson(pkg, {});
    expect(cambios).toEqual([]);
    expect(pkg.dependencies.pg).toBe('^8.0.0');
  });

  it('sin dependencies/peerDependencies/optionalDependencies definidos, no rompe', () => {
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
