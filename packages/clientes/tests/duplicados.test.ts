import { describe, expect, it } from 'vitest';
import { esMismoTelefono, normalizarDni, normalizarEmail, normalizarTelefono } from '../src/duplicados.js';

describe('normalizarTelefono', () => {
  it("caso exacto del brief: '+54 9 11…' y '11…' normalizan igual", () => {
    expect(normalizarTelefono('+54 9 11 1234-5678')).toBe(normalizarTelefono('11 1234-5678'));
    expect(normalizarTelefono('+54 9 11 1234-5678')).toBe('1112345678');
  });

  it('sin nada que normalizar, deja solo los dígitos', () => {
    expect(normalizarTelefono('11 1234-5678')).toBe('1112345678');
  });

  it('vacío o null normaliza a cadena vacía', () => {
    expect(normalizarTelefono('')).toBe('');
    expect(normalizarTelefono(null)).toBe('');
  });

  it('undefined normaliza a cadena vacía', () => {
    expect(normalizarTelefono(undefined)).toBe('');
  });

  it("con el '0' de discado local lo saca", () => {
    expect(normalizarTelefono('011 1234-5678')).toBe('1112345678');
  });

  it('sin prefijo de país, celular ni discado local, deja los dígitos tal cual', () => {
    expect(normalizarTelefono('1112345678')).toBe('1112345678');
  });
});

describe('esMismoTelefono', () => {
  it('+54 9 11… es el mismo que 11… (caso exacto del brief)', () => {
    expect(esMismoTelefono('+54 9 11 1234-5678', '11 1234-5678')).toBe(true);
  });

  it('números distintos no coinciden', () => {
    expect(esMismoTelefono('11 1234-5678', '11 8765-4321')).toBe(false);
  });

  it("dos vacíos nunca son 'el mismo' (no hay nada que comparar)", () => {
    expect(esMismoTelefono('', '')).toBe(false);
    expect(esMismoTelefono(null, undefined)).toBe(false);
  });
});

describe('normalizarDni / normalizarEmail', () => {
  it('DNI: solo dígitos', () => {
    expect(normalizarDni('12.345.678')).toBe('12345678');
  });

  it('DNI vacío, null o undefined normaliza a cadena vacía', () => {
    expect(normalizarDni('')).toBe('');
    expect(normalizarDni(null)).toBe('');
    expect(normalizarDni(undefined)).toBe('');
  });

  it('email: minúsculas y sin espacios de borde', () => {
    expect(normalizarEmail('  Juan@Mail.com ')).toBe('juan@mail.com');
  });

  it('email vacío, null o undefined normaliza a cadena vacía', () => {
    expect(normalizarEmail('')).toBe('');
    expect(normalizarEmail(null)).toBe('');
    expect(normalizarEmail(undefined)).toBe('');
  });
});
