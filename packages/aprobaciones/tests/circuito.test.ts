import { describe, expect, it } from 'vitest';
import { elegirCircuito, estadoSolicitud, type Circuito, type DocAprobable, type Voto } from '../src/circuito.js';

/** Centavos: `$ 1` = `100n`. */
const pesos = (n: number): bigint => BigInt(Math.round(n * 100));

function docOc(monto: bigint, proyectoId: string | null): DocAprobable {
  return { tipo: 'orden_compra', id: 'doc-1', monto, moneda: 'ARS', proyectoId, rubroIds: [], proveedorId: null, creadoPor: 'creador-1' };
}

function condicionesVacias() {
  return { montoDesde: null, montoHasta: null, proyectoId: null, rubroId: null, proveedorId: null };
}

describe('elegirCircuito', () => {
  const general: Circuito = {
    id: 'c-general',
    version: 1,
    tipo: 'orden_compra',
    condiciones: { ...condicionesVacias(), montoDesde: pesos(0) },
    niveles: [],
    creadorPuedeAprobar: false,
  };

  const proyectoA: Circuito = {
    id: 'c-proyecto-a',
    version: 1,
    tipo: 'orden_compra',
    condiciones: { ...condicionesVacias(), montoDesde: pesos(5_000_000), proyectoId: 'proyecto-a' },
    niveles: [],
    creadorPuedeAprobar: false,
  };

  it('documento de $ 6.000.000 en el proyecto A elige el circuito específico del proyecto A', () => {
    const elegido = elegirCircuito([general, proyectoA], docOc(pesos(6_000_000), 'proyecto-a'));
    expect(elegido?.id).toBe('c-proyecto-a');
  });

  it('documento de $ 6.000.000 en otro proyecto elige el circuito general', () => {
    const elegido = elegirCircuito([general, proyectoA], docOc(pesos(6_000_000), 'otro-proyecto'));
    expect(elegido?.id).toBe('c-general');
  });

  it('documento de $ 4.999.999,99 en el proyecto A elige el circuito general (no llega al montoDesde del proyecto A)', () => {
    const elegido = elegirCircuito([general, proyectoA], docOc(pesos(4_999_999.99), 'proyecto-a'));
    expect(elegido?.id).toBe('c-general');
  });

  it('ningún circuito coincide → null (el documento no requiere aprobación)', () => {
    const elegido = elegirCircuito([proyectoA], docOc(pesos(6_000_000), 'otro-proyecto'));
    expect(elegido).toBeNull();
  });

  it('circuitos de OTRO tipo nunca compiten, aunque sus condiciones matcheen', () => {
    const otroTipo: Circuito = { ...general, id: 'c-otro-tipo', tipo: 'orden_pago' };
    const elegido = elegirCircuito([otroTipo], docOc(pesos(1000), null));
    expect(elegido).toBeNull();
  });

  it('montoHasta $ 10.000.000 excluye $ 10.000.000,01', () => {
    const conTope: Circuito = {
      id: 'c-con-tope',
      version: 1,
      tipo: 'orden_compra',
      condiciones: { ...condicionesVacias(), montoHasta: pesos(10_000_000) },
      niveles: [],
      creadorPuedeAprobar: false,
    };
    expect(elegirCircuito([conTope], docOc(pesos(10_000_000), null))?.id).toBe('c-con-tope');
    expect(elegirCircuito([conTope], docOc(pesos(10_000_000.01), null))).toBeNull();
  });

  it('rubroId exige que el documento tenga ese rubro entre los suyos', () => {
    const porRubro: Circuito = {
      id: 'c-rubro',
      version: 1,
      tipo: 'orden_compra',
      condiciones: { ...condicionesVacias(), rubroId: 'electricidad' },
      niveles: [],
      creadorPuedeAprobar: false,
    };
    const conRubro = { ...docOc(pesos(1000), null), rubroIds: ['electricidad', 'plomeria'] };
    const sinRubro = { ...docOc(pesos(1000), null), rubroIds: ['plomeria'] };
    expect(elegirCircuito([porRubro], conRubro)?.id).toBe('c-rubro');
    expect(elegirCircuito([porRubro], sinRubro)).toBeNull();
  });

  it('empate en especificidad y montoDesde → gana la versión más nueva', () => {
    const v1: Circuito = { ...general, id: 'c-v1', version: 1 };
    const v2: Circuito = { ...general, id: 'c-v2', version: 2 };
    const elegido = elegirCircuito([v1, v2], docOc(pesos(1000), null));
    expect(elegido?.id).toBe('c-v2');
  });

  it('empate en especificidad y montoDesde, orden invertido → sigue ganando la versión más nueva (no la reemplaza una más vieja)', () => {
    const v1: Circuito = { ...general, id: 'c-v1', version: 1 };
    const v2: Circuito = { ...general, id: 'c-v2', version: 2 };
    const elegido = elegirCircuito([v2, v1], docOc(pesos(1000), null));
    expect(elegido?.id).toBe('c-v2');
  });

  it('proveedorId exige que el documento sea de ese proveedor', () => {
    const porProveedor: Circuito = {
      id: 'c-proveedor',
      version: 1,
      tipo: 'orden_compra',
      condiciones: { ...condicionesVacias(), proveedorId: 'proveedor-1' },
      niveles: [],
      creadorPuedeAprobar: false,
    };
    const conProveedor = { ...docOc(pesos(1000), null), proveedorId: 'proveedor-1' };
    const otroProveedor = { ...docOc(pesos(1000), null), proveedorId: 'proveedor-2' };
    expect(elegirCircuito([porProveedor], conProveedor)?.id).toBe('c-proveedor');
    expect(elegirCircuito([porProveedor], otroProveedor)).toBeNull();
  });

  it('el más específico primero en la lista no es reemplazado por uno menos específico que viene después', () => {
    const elegido = elegirCircuito([proyectoA, general], docOc(pesos(6_000_000), 'proyecto-a'));
    expect(elegido?.id).toBe('c-proyecto-a');
  });

  it('empate en especificidad, distinto montoDesde → gana el montoDesde más alto (el más nuevo en la lista lo reemplaza)', () => {
    const desde100: Circuito = {
      id: 'c-desde-100',
      version: 1,
      tipo: 'orden_compra',
      condiciones: { ...condicionesVacias(), montoDesde: pesos(100) },
      niveles: [],
      creadorPuedeAprobar: false,
    };
    const desde200: Circuito = {
      id: 'c-desde-200',
      version: 1,
      tipo: 'orden_compra',
      condiciones: { ...condicionesVacias(), montoDesde: pesos(200) },
      niveles: [],
      creadorPuedeAprobar: false,
    };
    const doc = docOc(pesos(1000), null);
    expect(elegirCircuito([desde100, desde200], doc)?.id).toBe('c-desde-200');
    // orden invertido: el de montoDesde más alto sigue ganando (el que viene después no lo reemplaza)
    expect(elegirCircuito([desde200, desde100], doc)?.id).toBe('c-desde-200');
  });
});

describe('estadoSolicitud', () => {
  const snapshot: Circuito = {
    id: 'c-1',
    version: 1,
    tipo: 'orden_compra',
    condiciones: condicionesVacias(),
    niveles: [
      { orden: 1, usuarios: ['jefe-obra'], roles: [], minimo: 1 },
      { orden: 2, usuarios: ['admin-1', 'admin-2', 'admin-3'], roles: [], minimo: 2 },
    ],
    creadorPuedeAprobar: false,
  };
  const doc = docOc(pesos(1000), null);

  function voto(nivel: number, usuarioId: string, decision: 'aprobar' | 'rechazar' = 'aprobar'): Voto {
    return { nivel, usuarioId, decision, comentario: null, en: '2026-09-28T00:00:00.000Z' };
  }

  it('sin votos → nivelActual 1', () => {
    expect(estadoSolicitud(snapshot, [], doc).nivelActual).toBe(1);
  });

  it('1 voto nivel 1 → nivelActual 2', () => {
    const estado = estadoSolicitud(snapshot, [voto(1, 'jefe-obra')], doc);
    expect(estado.nivelActual).toBe(2);
    expect(estado.completa).toBe(false);
  });

  it('1 de 3 en nivel 2 → sigue en 2', () => {
    const estado = estadoSolicitud(snapshot, [voto(1, 'jefe-obra'), voto(2, 'admin-1')], doc);
    expect(estado.nivelActual).toBe(2);
    expect(estado.completa).toBe(false);
  });

  it('2 de 3 en nivel 2 → completa', () => {
    const estado = estadoSolicitud(snapshot, [voto(1, 'jefe-obra'), voto(2, 'admin-1'), voto(2, 'admin-2')], doc);
    expect(estado.completa).toBe(true);
    expect(estado.nivelActual).toBeNull();
  });

  it('un rechazo en cualquier nivel → rechazada', () => {
    const estado = estadoSolicitud(snapshot, [voto(2, 'admin-1', 'rechazar')], doc);
    expect(estado.rechazada).toBe(true);
  });

  it('una solicitud rechazada o completa no admite más votos', () => {
    const rechazada = estadoSolicitud(snapshot, [voto(1, 'jefe-obra', 'rechazar')], doc);
    expect(rechazada.puedeVotar('admin-1', [])).toBe(false);

    const completa = estadoSolicitud(snapshot, [voto(1, 'jefe-obra'), voto(2, 'admin-1'), voto(2, 'admin-2')], doc);
    expect(completa.puedeVotar('admin-3', [])).toBe(false);
  });

  it('puedeVotar del creador con creadorPuedeAprobar=false → false (auto-aprobación bloqueada)', () => {
    const snapshotConCreador: Circuito = {
      ...snapshot,
      niveles: [{ orden: 1, usuarios: ['creador-1'], roles: [], minimo: 1 }],
    };
    const estado = estadoSolicitud(snapshotConCreador, [], doc);
    expect(estado.puedeVotar('creador-1', [])).toBe(false);
  });

  it('puedeVotar del creador con creadorPuedeAprobar=true → true', () => {
    const snapshotConCreador: Circuito = {
      ...snapshot,
      niveles: [{ orden: 1, usuarios: ['creador-1'], roles: [], minimo: 1 }],
      creadorPuedeAprobar: true,
    };
    const estado = estadoSolicitud(snapshotConCreador, [], doc);
    expect(estado.puedeVotar('creador-1', [])).toBe(true);
  });

  it('un usuario del nivel 2 no puede votar mientras el nivel 1 no se completó (secuencial)', () => {
    const estado = estadoSolicitud(snapshot, [], doc);
    expect(estado.puedeVotar('admin-1', [])).toBe(false);
    expect(estado.puedeVotar('jefe-obra', [])).toBe(true);
  });

  it('un usuario habilitado solo por rol puede votar; uno sin el rol ni el usuario, no', () => {
    const porRol: Circuito = {
      ...snapshot,
      niveles: [{ orden: 1, usuarios: [], roles: ['admin'], minimo: 1 }],
    };
    const estado = estadoSolicitud(porRol, [], doc);
    expect(estado.puedeVotar('cualquiera', ['admin'])).toBe(true);
    expect(estado.puedeVotar('cualquiera', ['invitado'])).toBe(false);
  });

  it('circuito sin niveles → nivelActual null sin estar completa ni rechazada, y nadie puede votar', () => {
    const snapshotSinNiveles: Circuito = { ...snapshot, niveles: [] };
    const estado = estadoSolicitud(snapshotSinNiveles, [], doc);
    expect(estado.nivelActual).toBeNull();
    expect(estado.completa).toBe(false);
    expect(estado.rechazada).toBe(false);
    expect(estado.puedeVotar('cualquiera', [])).toBe(false);
  });

  it('un usuario no puede votar dos veces en el mismo nivel', () => {
    const estado = estadoSolicitud(snapshot, [voto(1, 'jefe-obra')], { ...doc });
    // nivel 1 ya completo (minimo 1) → nivelActual es 2; probamos con un
    // nivel de minimo mayor a 1 para dejar el nivel abierto.
    const nivelAbierto: Circuito = {
      ...snapshot,
      niveles: [{ orden: 1, usuarios: ['jefe-obra'], roles: [], minimo: 2 }],
    };
    const conUnVoto = estadoSolicitud(nivelAbierto, [voto(1, 'jefe-obra')], doc);
    expect(conUnVoto.puedeVotar('jefe-obra', [])).toBe(false);
  });
});
