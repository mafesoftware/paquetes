import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  calcularPlan,
  leerInfoPaquetes,
  ordenTopologico,
  publicarPlan,
  type InfoPaquete,
  type ResultadoPublicar,
} from '../scripts/publicar-primera-vez.js';

function info(parcial: Partial<InfoPaquete> & { nombre: string }): InfoPaquete {
  return {
    nombreNpm: `@mafesoftware/${parcial.nombre}`,
    dir: `/no-usado/${parcial.nombre}`,
    version: '1.0.0',
    dependenciasInternas: [],
    privado: false,
    ...parcial,
  };
}

describe('ordenTopologico', () => {
  it('sin dependencias, respeta el orden de entrada', () => {
    const a = info({ nombre: 'a' });
    const b = info({ nombre: 'b' });
    expect(ordenTopologico([a, b]).map((i) => i.nombre)).toEqual(['a', 'b']);
    expect(ordenTopologico([b, a]).map((i) => i.nombre)).toEqual(['b', 'a']);
  });

  it('un paquete que depende de otro DEL PLAN se ordena después', () => {
    const tenant = info({ nombre: 'tenant' });
    const numeradores = info({ nombre: 'numeradores', dependenciasInternas: ['tenant'] });
    // A propósito en orden "incorrecto" de entrada: el resultado igual debe quedar tenant primero.
    expect(ordenTopologico([numeradores, tenant]).map((i) => i.nombre)).toEqual(['tenant', 'numeradores']);
  });

  it('una dependencia que NO está en el plan (ya publicada) no bloquea el orden', () => {
    // "numeradores" depende de "tenant", pero "tenant" no viene en la lista
    // (por ejemplo, porque ya está publicado y calcularPlan lo sacó).
    const numeradores = info({ nombre: 'numeradores', dependenciasInternas: ['tenant'] });
    expect(ordenTopologico([numeradores]).map((i) => i.nombre)).toEqual(['numeradores']);
  });

  it('diamante de dependencias: la base va primero, las dos intermedias en cualquier orden, la cima al final', () => {
    const base = info({ nombre: 'base' });
    const izq = info({ nombre: 'izq', dependenciasInternas: ['base'] });
    const der = info({ nombre: 'der', dependenciasInternas: ['base'] });
    const cima = info({ nombre: 'cima', dependenciasInternas: ['izq', 'der'] });
    const orden = ordenTopologico([cima, der, izq, base]).map((i) => i.nombre);
    expect(orden[0]).toBe('base');
    expect(orden[3]).toBe('cima');
    expect(new Set(orden.slice(1, 3))).toEqual(new Set(['izq', 'der']));
  });

  it('tira si hay un ciclo', () => {
    const a = info({ nombre: 'a', dependenciasInternas: ['b'] });
    const b = info({ nombre: 'b', dependenciasInternas: ['a'] });
    expect(() => ordenTopologico([a, b])).toThrow(/ciclo/i);
  });
});

describe('calcularPlan (selección contra un registro falso)', () => {
  it('saca del plan los paquetes cuya versión actual YA está publicada', async () => {
    const a = info({ nombre: 'a', version: '1.0.0' });
    const b = info({ nombre: 'b', version: '2.0.0' });
    const publicadasPorNombre: Record<string, Set<string>> = {
      '@mafesoftware/a': new Set(['0.9.0', '1.0.0']), // 1.0.0 ya publicada
      '@mafesoftware/b': new Set(['1.0.0']), // 2.0.0 todavía no
    };
    const plan = await calcularPlan([a, b], async (nombreNpm) => publicadasPorNombre[nombreNpm] ?? new Set());
    expect(plan.map((i) => i.nombre)).toEqual(['b']);
  });

  it('un paquete nuevo (404 del registro, "ninguna versión publicada") entra al plan', async () => {
    const nuevo = info({ nombre: 'nuevo', version: '0.1.0' });
    const plan = await calcularPlan([nuevo], async () => new Set());
    expect(plan.map((i) => i.nombre)).toEqual(['nuevo']);
  });

  it('salta los paquetes privados sin ni siquiera consultar el registro', async () => {
    const privado = info({ nombre: 'privado', privado: true });
    let consultas = 0;
    const plan = await calcularPlan([privado], async () => {
      consultas++;
      return new Set();
    });
    expect(plan).toEqual([]);
    expect(consultas).toBe(0);
  });

  it('el plan final queda en orden topológico', async () => {
    const tenant = info({ nombre: 'tenant', version: '0.1.0' });
    const numeradores = info({ nombre: 'numeradores', version: '0.1.0', dependenciasInternas: ['tenant'] });
    const plan = await calcularPlan([numeradores, tenant], async () => new Set());
    expect(plan.map((i) => i.nombre)).toEqual(['tenant', 'numeradores']);
  });
});

describe('leerInfoPaquetes', () => {
  it('lee nombre/versión/privado y las dependencias internas (workspace: o no) de cada packages/<nombre>/package.json', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-publicar-'));
    try {
      const dirA = join(raiz, 'a');
      const dirB = join(raiz, 'b');
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      writeFileSync(join(dirA, 'package.json'), JSON.stringify({ name: '@mafesoftware/a', version: '1.0.0' }));
      writeFileSync(
        join(dirB, 'package.json'),
        JSON.stringify({
          name: '@mafesoftware/b',
          version: '2.0.0',
          dependencies: { '@mafesoftware/a': 'workspace:^' },
          // Dependencia externa (sin el scope @mafesoftware/): NO debe contarse como interna.
          devDependencies: { vitest: '^5.0.1' },
        }),
      );

      const infos = leerInfoPaquetes(raiz);
      const a = infos.find((i) => i.nombre === 'a');
      const b = infos.find((i) => i.nombre === 'b');
      expect(a).toMatchObject({ nombreNpm: '@mafesoftware/a', version: '1.0.0', privado: false, dependenciasInternas: [] });
      expect(b).toMatchObject({ nombreNpm: '@mafesoftware/b', version: '2.0.0', dependenciasInternas: ['a'] });
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});

describe('publicarPlan', () => {
  /** Crea `raiz/<nombre>/package.json` con el contenido dado (ya como string, para poder comparar byte a byte al restaurar). */
  function escribirPaquete(raiz: string, nombre: string, contenidoJson: Record<string, unknown>): void {
    const dir = join(raiz, nombre);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(contenidoJson, null, 2)}\n`);
  }

  it('reescribe workspace: antes de publicar y restaura los package.json originales al terminar bien', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-publicar-'));
    try {
      escribirPaquete(raiz, 'a', { name: '@mafesoftware/a', version: '1.0.0' });
      escribirPaquete(raiz, 'b', {
        name: '@mafesoftware/b',
        version: '1.0.0',
        dependencies: { '@mafesoftware/a': 'workspace:*' },
      });

      const originalA = readFileSync(join(raiz, 'a', 'package.json'), 'utf8');
      const originalB = readFileSync(join(raiz, 'b', 'package.json'), 'utf8');

      const infos = leerInfoPaquetes(raiz);
      const plan = ordenTopologico(infos); // a antes que b

      const vistoDuranteB: { contenido?: string } = {};
      const resultado = await publicarPlan(plan, {
        dirPackages: raiz,
        publicar: async (paqueteInfo): Promise<ResultadoPublicar> => {
          if (paqueteInfo.nombre === 'b') {
            vistoDuranteB.contenido = readFileSync(join(raiz, 'b', 'package.json'), 'utf8');
          }
          return { ok: true };
        },
      });

      expect(resultado.publicados).toEqual(['@mafesoftware/a@1.0.0', '@mafesoftware/b@1.0.0']);
      expect(resultado.restantes).toEqual([]);
      expect(resultado.error).toBeUndefined();

      // Durante la publicación de "b", ya no debía quedar "workspace:" (se reescribió a la versión real de "a").
      expect(vistoDuranteB.contenido).toBeDefined();
      expect(vistoDuranteB.contenido).not.toContain('workspace:');
      expect(vistoDuranteB.contenido).toContain('"1.0.0"');

      // Al terminar, los package.json quedan EXACTAMENTE como estaban antes (workspace: de vuelta).
      expect(readFileSync(join(raiz, 'a', 'package.json'), 'utf8')).toBe(originalA);
      expect(readFileSync(join(raiz, 'b', 'package.json'), 'utf8')).toBe(originalB);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('si falla el segundo paquete, publica el primero, reporta el resto como restante, y restaura igual', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-publicar-'));
    try {
      escribirPaquete(raiz, 'a', { name: '@mafesoftware/a', version: '1.0.0' });
      escribirPaquete(raiz, 'b', {
        name: '@mafesoftware/b',
        version: '1.0.0',
        dependencies: { '@mafesoftware/a': 'workspace:*' },
      });
      escribirPaquete(raiz, 'c', { name: '@mafesoftware/c', version: '1.0.0' });

      const originalB = readFileSync(join(raiz, 'b', 'package.json'), 'utf8');

      // Orden EXPLÍCITO a/b/c (no derivado de ordenTopologico/readdirSync, que no
      // garantiza un orden entre "b" y "c" — no hay dependencia entre ellos —, y
      // este test quiere probar el corte en el primer fallo, no el orden en sí,
      // que ya cubre el describe de ordenTopologico de más arriba).
      const infos = leerInfoPaquetes(raiz);
      const porNombre = new Map(infos.map((i) => [i.nombre, i]));
      const plan = ['a', 'b', 'c'].map((nombre) => porNombre.get(nombre) as InfoPaquete);

      const llamados: string[] = [];
      const resultado = await publicarPlan(plan, {
        dirPackages: raiz,
        publicar: async (paqueteInfo): Promise<ResultadoPublicar> => {
          llamados.push(paqueteInfo.nombre);
          if (paqueteInfo.nombre === 'b') return { ok: false, mensaje: 'boom: registro caído' };
          return { ok: true };
        },
      });

      expect(resultado.publicados).toEqual(['@mafesoftware/a@1.0.0']);
      expect(resultado.restantes).toEqual(['b', 'c']);
      expect(resultado.error).toBe('boom: registro caído');
      // Nunca se llegó a llamar "publicar" para "c": se cortó en el primer fallo.
      expect(llamados).toEqual(['a', 'b']);

      // Restaurado incluso habiendo fallado a mitad de camino.
      expect(readFileSync(join(raiz, 'b', 'package.json'), 'utf8')).toBe(originalB);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('si "publicar" TIRA (no solo devuelve ok:false), igual restaura y reporta el error', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-publicar-'));
    try {
      escribirPaquete(raiz, 'a', { name: '@mafesoftware/a', version: '1.0.0' });
      const original = readFileSync(join(raiz, 'a', 'package.json'), 'utf8');

      const infos = leerInfoPaquetes(raiz);
      const resultado = await publicarPlan(infos, {
        dirPackages: raiz,
        publicar: async () => {
          throw new Error('npm publish reventó');
        },
      });

      expect(resultado.publicados).toEqual([]);
      expect(resultado.restantes).toEqual(['a']);
      expect(resultado.error).toBe('npm publish reventó');
      expect(readFileSync(join(raiz, 'a', 'package.json'), 'utf8')).toBe(original);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('rerun seguro: un plan vacío (todo ya publicado) no toca nada y no llama a "publicar"', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-publicar-'));
    try {
      escribirPaquete(raiz, 'a', { name: '@mafesoftware/a', version: '1.0.0' });
      const original = readFileSync(join(raiz, 'a', 'package.json'), 'utf8');

      let llamado = false;
      const resultado = await publicarPlan([], {
        dirPackages: raiz,
        publicar: async () => {
          llamado = true;
          return { ok: true };
        },
      });

      expect(resultado).toEqual({ publicados: [], restantes: [] });
      expect(llamado).toBe(false);
      expect(readFileSync(join(raiz, 'a', 'package.json'), 'utf8')).toBe(original);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
