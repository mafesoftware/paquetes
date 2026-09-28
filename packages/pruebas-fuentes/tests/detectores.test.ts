import { describe, expect, it } from 'vitest';
import {
  correrDetectores,
  guardaEnUseServer,
  serverOnlyEnDatos,
  sinCoalesceCeroEnPlata,
  sinDependenciaFile,
  sinImportDeDatosEnCliente,
  sinSetHours,
  sinSqlCrudoConOr,
  type ArchivoFuente,
} from '../src/index.js';

const archivo = (texto: string, ruta = 'archivo.ts'): ArchivoFuente => ({ ruta, texto });

describe('guardaEnUseServer', () => {
  const detector = guardaEnUseServer({ nombresGuarda: ['exigirPermiso', 'exigirPanel'] });

  it('detecta un export async sin guarda como primer enunciado', () => {
    const texto = `"use server";

export async function borrarSocio(id: string) {
  const socio = await buscarSocio(id);
  return socio;
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toMatchObject({ regla: 'guardaEnUseServer', archivo: 'archivo.ts' });
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta cuando la guarda es el primer enunciado (sola o asignada)', () => {
    const texto = `"use server";

export async function borrarSocio(id: string) {
  await exigirPermiso("socios.borrar");
  return id;
}

export async function verSocio(id: string) {
  const ctx = await exigirPanel();
  return ctx;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('ignora archivos sin la directiva "use server" al principio', () => {
    const texto = `export async function borrarSocio(id: string) {
  return id;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no cuenta una "use server" suelta dentro de una página (no está al principio)', () => {
    const texto = `export default function Pagina() {
  async function accion() {
    "use server";
    return borrarSocio();
  }
  return null;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('exige al menos un nombre de guarda', () => {
    expect(() => guardaEnUseServer({ nombresGuarda: [] })).toThrow();
  });

  it('no tira (defensivo) con una función truncada: paréntesis sin cerrar', () => {
    const texto = '"use server";\n\nexport async function incompleta(';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no tira (defensivo) con una función truncada: sin "{" después de los paréntesis', () => {
    const texto = '"use server";\n\nexport async function incompleta()';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no tira (defensivo) con una función truncada: llave sin cerrar', () => {
    const texto = '"use server";\n\nexport async function incompleta() {\n  await exigirPermiso();';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('sigue detectando un export async function con un comentario justo antes', () => {
    const texto = `"use server";

// borra un socio dado su id
export async function borrarSocio(id: string) {
  const socio = await buscarSocio(id);
  return socio;
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un export async function con guarda y un comentario justo antes', () => {
    const texto = `"use server";

/** borra un socio dado su id */
export async function borrarSocio(id: string) {
  await exigirPermiso("socios.borrar");
  return id;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un "export default async function" sin guarda', () => {
    const texto = `"use server";

export default async function borrarSocio(id: string) {
  const socio = await buscarSocio(id);
  return socio;
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('detecta un "export default async function" anónimo sin guarda', () => {
    const texto = `"use server";

export default async function (id: string) {
  const socio = await buscarSocio(id);
  return socio;
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('(anónima)');
  });

  it('no detecta un "export default async function" con guarda', () => {
    const texto = `"use server";

export default async function borrarSocio(id: string) {
  await exigirPermiso("socios.borrar");
  return id;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un "export const x = async (...) => { ... }" (bloque) sin guarda', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string) => {
  const socio = await buscarSocio(id);
  return socio;
};
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un "export const x = async (...) => { ... }" (bloque) con guarda', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string) => {
  await exigirPermiso("socios.borrar");
  return id;
};
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un "export const x = async function (...) { ... }" sin guarda', () => {
    const texto = `"use server";

export const borrarSocio = async function (id: string) {
  const socio = await buscarSocio(id);
  return socio;
};
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un "export const x = async function (...) { ... }" con guarda', () => {
    const texto = `"use server";

export const borrarSocio = async function (id: string) {
  await exigirPermiso("socios.borrar");
  return id;
};
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un arrow de cuerpo expresión sin guarda: "async () => algo()"', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string) => borrarDeLaBase(id);
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un arrow de cuerpo expresión cuando la expresión ES la guarda', () => {
    const texto = `"use server";

export const verSocio = async (id: string) => exigirPermiso("socios.ver");
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un arrow de un solo parámetro sin paréntesis, cuerpo expresión, sin guarda', () => {
    const texto = `"use server";

export const borrarSocio = async id => borrarDeLaBase(id);
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no tira (defensivo) con un "export const x = async (" truncado', () => {
    const texto = '"use server";\n\nexport const incompleta = async (';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no tira (defensivo) con un "export const x = async (...) => {" sin cerrar', () => {
    const texto = '"use server";\n\nexport const incompleta = async () => {\n  await exigirPermiso();';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un arrow con tipo de retorno explícito (bloque) sin guarda', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string): Promise<void> => {
  await borrarDeLaBase(id);
};
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un arrow con tipo de retorno explícito (bloque) con guarda', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string): Promise<void> => {
  await exigirPermiso("socios.borrar");
};
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('detecta un arrow con tipo de retorno explícito (cuerpo expresión) sin guarda', () => {
    const texto = `"use server";

export const borrarSocio = async (id: string): Promise<void> => borrarDeLaBase(id);
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('borrarSocio');
  });

  it('no detecta un arrow con tipo de retorno explícito (cuerpo expresión) cuando la expresión ES la guarda', () => {
    const texto = `"use server";

export const verSocio = async (id: string): Promise<unknown> => exigirPermiso("socios.ver");
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no confunde una llave del tipo de retorno (unión de objetos) con la del cuerpo: función declarada, sin guarda', () => {
    const texto = `"use server";

export async function operar(id: string): Promise<{ ok: true } | { ok: false }> {
  return { ok: false };
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('operar');
  });

  it('no confunde una llave del tipo de retorno (unión de objetos) con la del cuerpo: función declarada, con guarda', () => {
    const texto = `"use server";

export async function operar(id: string): Promise<{ ok: true } | { ok: false }> {
  await exigirPermiso("operar");
  return { ok: true };
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no confunde una llave del tipo de retorno (unión de objetos) con la del cuerpo: function expression, sin guarda', () => {
    const texto = `"use server";

export const operar = async function (id: string): Promise<{ ok: true } | { ok: false }> {
  return { ok: false };
};
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('operar');
  });

  it('no confunde una llave del tipo de retorno (unión de objetos) con la del cuerpo: function expression, con guarda', () => {
    const texto = `"use server";

export const operar = async function (id: string): Promise<{ ok: true } | { ok: false }> {
  await exigirPermiso("operar");
  return { ok: true };
};
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('regresión con forma tipo "validarDesdePorteria" de gestionflow: parámetros multilínea, tipo de retorno unión de objetos multilínea, con guarda', () => {
    // Excerpt propio (no copiado), con la misma forma que causaba el falso
    // positivo real: parámetros con default en varias líneas, cierre del
    // `)`, salto de línea, y recién ahí ": Promise<{...} | {...}> {".
    const texto = `"use server";

export async function validarAcceso(
  dispositivoId: string,
  credencial: string,
  sentido: "ingreso" | "egreso",
  forzar = false
): Promise<{ ok: true; motivo?: string } | { ok: false; error: string }> {
  await exigirPermiso("accesos.operar");
  if (forzar) await exigirPermiso("accesos.forzar");
  return { ok: true };
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });
});

describe('sinSqlCrudoConOr', () => {
  const detector = sinSqlCrudoConOr();

  it('detecta un "or" suelto dentro de un fragmento sql`', () => {
    const texto = "const cond = sql`estado <> 'baja' or fecha_baja >= ${desde}`;";
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.regla).toBe('sinSqlCrudoConOr');
  });

  it('no detecta un or() de drizzle interpolado', () => {
    const texto = 'const cond = sql`${or(eq(a, b), eq(c, d))}`;';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no detecta un fragmento sql sin or', () => {
    const texto = 'const cond = sql`estado <> ${estado}`;';
    expect(detector(archivo(texto))).toEqual([]);
  });
});

describe('sinCoalesceCeroEnPlata', () => {
  const detector = sinCoalesceCeroEnPlata({ patrones: /monto|precio/i });

  it('detecta "?? 0" en una línea de plata', () => {
    const texto = 'const monto = parsearPlata(valor) ?? 0;';
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.linea).toBe(1);
  });

  it('no detecta "?? 0" en una línea que no matchea el patrón de plata', () => {
    const texto = 'const cantidad = parsearEntero(valor) ?? 0;';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no detecta una línea de plata sin "?? 0"', () => {
    const texto = 'const monto = parsearPlata(valor) ?? undefined;';
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('no arrastra estado de lastIndex si `patrones` viene con flag global', () => {
    const conFlagG = sinCoalesceCeroEnPlata({ patrones: /monto/gi });
    const texto = 'const monto = a ?? 0;\nconst monto2 = b ?? 0;';
    expect(conFlagG(archivo(texto))).toHaveLength(2);
  });
});

describe('sinSetHours', () => {
  const detector = sinSetHours();

  it('detecta setHours', () => {
    expect(detector(archivo('fecha.setHours(0, 0, 0, 0);'))).toHaveLength(1);
  });

  it('detecta setUTCHours', () => {
    expect(detector(archivo('fecha.setUTCHours(0, 0, 0, 0);'))).toHaveLength(1);
  });

  it('no detecta getHours', () => {
    expect(detector(archivo('const h = fecha.getHours();'))).toEqual([]);
  });
});

describe('serverOnlyEnDatos', () => {
  const detector = serverOnlyEnDatos({ patronArchivo: /\/datos[A-Z][A-Za-z]*\.ts$/ });

  it('detecta un archivo de datos sin import server-only', () => {
    const hallazgos = detector(archivo('export async function datosSocios() {}', 'src/lib/datosSocios.ts'));
    expect(hallazgos).toHaveLength(1);
  });

  it('no detecta cuando importa server-only', () => {
    const texto = 'import "server-only";\n\nexport async function datosSocios() {}\n';
    expect(detector(archivo(texto, 'src/lib/datosSocios.ts'))).toEqual([]);
  });

  it('ignora archivos que no matchean el patrón', () => {
    expect(detector(archivo('export const x = 1;', 'src/lib/formato.ts'))).toEqual([]);
  });
});

describe('sinImportDeDatosEnCliente', () => {
  const detector = sinImportDeDatosEnCliente({ patronDatos: /\/datos[A-Z]/ });

  it('detecta un import de datos en un archivo "use client"', () => {
    const texto = `"use client";
import { datosSocios } from "@/lib/datosSocios";

export function Componente() {
  return null;
}
`;
    const hallazgos = detector(archivo(texto));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('datosSocios');
  });

  it('no detecta un import ajeno a datos', () => {
    const texto = `"use client";
import { formatear } from "@/lib/formato";

export function Componente() {
  return null;
}
`;
    expect(detector(archivo(texto))).toEqual([]);
  });

  it('ignora archivos sin "use client"', () => {
    const texto = 'import { datosSocios } from "@/lib/datosSocios";';
    expect(detector(archivo(texto))).toEqual([]);
  });
});

describe('sinDependenciaFile', () => {
  const detector = sinDependenciaFile();

  it('detecta una dependencia file: en package.json', () => {
    const texto = JSON.stringify({ name: 'x', dependencies: { '@mafesoftware/tenant': 'file:../tenant' } });
    const hallazgos = detector(archivo(texto, 'package.json'));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.detalle).toContain('file:../tenant');
  });

  it('detecta una dependencia link: en devDependencies', () => {
    const texto = JSON.stringify({ name: 'x', devDependencies: { algo: 'link:../algo' } });
    expect(detector(archivo(texto, 'package.json'))).toHaveLength(1);
  });

  it('no detecta una dependencia normal', () => {
    const texto = JSON.stringify({ name: 'x', dependencies: { '@mafesoftware/tenant': '^0.3.0' } });
    expect(detector(archivo(texto, 'package.json'))).toEqual([]);
  });

  it('ignora archivos que no son package.json', () => {
    expect(detector(archivo('dependencies: { x: "file:../x" }', 'notas.txt'))).toEqual([]);
  });

  it('ignora un package.json que no es JSON válido, sin tirar', () => {
    expect(detector(archivo('{ no es json', 'package.json'))).toEqual([]);
  });
});

describe('correrDetectores', () => {
  it('concatena los hallazgos de varios detectores sobre varios archivos', () => {
    const archivos: ArchivoFuente[] = [
      archivo('fecha.setHours(0);', 'a.ts'),
      archivo('const monto = x ?? 0;', 'b.ts'),
    ];
    const detectores = [sinSetHours(), sinCoalesceCeroEnPlata({ patrones: /monto/ })];
    const hallazgos = correrDetectores(archivos, detectores);
    expect(hallazgos).toHaveLength(2);
    expect(hallazgos.map((h) => h.regla).sort()).toEqual(['sinCoalesceCeroEnPlata', 'sinSetHours']);
  });

  it('con cero archivos o cero detectores no encuentra nada', () => {
    expect(correrDetectores([], [sinSetHours()])).toEqual([]);
    expect(correrDetectores([archivo('x')], [])).toEqual([]);
  });
});
