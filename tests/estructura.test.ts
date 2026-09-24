import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarPaquete } from './lib/verificar-paquete.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = join(RAIZ, 'packages');

function paquetesExistentes(): string[] {
  if (!existsSync(PACKAGES)) {
    return [];
  }
  return readdirSync(PACKAGES).filter((nombre) => statSync(join(PACKAGES, nombre)).isDirectory());
}

describe('estructura de packages/*', () => {
  const nombres = paquetesExistentes();

  it('no debe haber paquetes con estructura inválida', () => {
    const fallidos = nombres
      .map((nombre) => ({ nombre, resultado: verificarPaquete(join(PACKAGES, nombre)) }))
      .filter(({ resultado }) => !resultado.ok);

    const detalle = fallidos
      .map(({ nombre, resultado }) => `- ${nombre}:\n  ${resultado.errores.join('\n  ')}`)
      .join('\n');

    expect(fallidos, detalle).toEqual([]);
  });
});
