import { describe, expect, it } from 'vitest';
import { validarDocumentoCliente } from '../src/documento.js';

describe('validarDocumentoCliente', () => {
  it('DNI válido se normaliza sin puntos', () => {
    expect(validarDocumentoCliente('dni', '12.345.678')).toEqual({ ok: true, normalizado: '12345678' });
  });

  it('DNI inválido (empieza con 0) → ok: false', () => {
    const resultado = validarDocumentoCliente('dni', '01234567');
    expect(resultado.ok).toBe(false);
  });

  it('CUIT válido se normaliza sin guiones', () => {
    expect(validarDocumentoCliente('cuit', '20-12345678-6')).toEqual({ ok: true, normalizado: '20123456786' });
  });

  it('CUIT con dígito verificador inválido → ok: false', () => {
    const resultado = validarDocumentoCliente('cuit', '20-12345678-7');
    expect(resultado.ok).toBe(false);
  });
});
