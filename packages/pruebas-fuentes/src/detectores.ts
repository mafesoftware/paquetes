import type { ArchivoFuente, Detector, Hallazgo } from './tipos.js';
import { blanquear, blanquearComentarios, escaparRegex, indiceCierre, numeroDeLinea, sinEstado } from './texto.js';

/* ============================================================
   guardaEnUseServer
   ============================================================ */

export interface OpcionesGuardaEnUseServer {
  /** Nombres de función que cuentan como guarda (ej: ["exigirPermiso", "exigirPlataforma"]). */
  nombresGuarda: string[];
}

/** La directiva "use server" AL PRINCIPIO del archivo (ignorando comentarios/espacio previos). */
const DIRECTIVA_USE_SERVER = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*["']use server["'];/;

/**
 * En un archivo con `"use server"` al principio (que publica cada export como
 * endpoint alcanzable desde el navegador), el PRIMER enunciado de cada
 * función exportada `async` tiene que llamar a una de `nombresGuarda` — sola
 * o asignada (`const x = await exigirPermiso(...)`), con o sin `await`.
 *
 * Falso negativo documentado: si la guarda se llama más abajo en el cuerpo
 * (no como primer enunciado), esto NO lo detecta — a propósito, porque
 * publicar el endpoint con trabajo sin guardar ANTES de la guarda ya es el
 * problema que se busca atrapar, y decidir "está bastante arriba" es
 * subjetivo. Falso positivo conocido: una guarda envuelta en un helper local
 * de una sola línea (`await miGuarda()` donde `miGuarda` internamente llama a
 * `exigirPermiso`) no matchea por nombre — hay que pasar el nombre real en
 * `nombresGuarda`.
 */
export function guardaEnUseServer(opciones: OpcionesGuardaEnUseServer): Detector {
  const { nombresGuarda } = opciones;
  if (nombresGuarda.length === 0) {
    throw new Error('guardaEnUseServer requiere al menos un nombre en nombresGuarda');
  }
  const alternativas = nombresGuarda.map(escaparRegex).join('|');
  const patronGuarda = new RegExp(`^(?:(?:const|let|var)\\s+[^=]+=\\s*)?(?:await\\s+)?(?:${alternativas})\\s*\\(`);

  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    if (!DIRECTIVA_USE_SERVER.test(texto)) return [];

    const hallazgos: Hallazgo[] = [];
    const limpio = blanquear(texto);
    const reFuncion = /export\s+async\s+function\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = reFuncion.exec(limpio))) {
      const nombreFn = m[1]!;
      const indiceParenAbre = m.index + m[0].length - 1;
      const indiceParenCierra = indiceCierre(limpio, indiceParenAbre, '(', ')');
      if (indiceParenCierra === -1) continue;
      const indiceLlaveAbre = limpio.indexOf('{', indiceParenCierra);
      if (indiceLlaveAbre === -1) continue;
      const indiceLlaveCierra = indiceCierre(limpio, indiceLlaveAbre, '{', '}');
      if (indiceLlaveCierra === -1) continue;

      const cuerpoLimpio = limpio.slice(indiceLlaveAbre + 1, indiceLlaveCierra).replace(/^\s+/, '');
      if (!patronGuarda.test(cuerpoLimpio)) {
        hallazgos.push({
          regla: 'guardaEnUseServer',
          archivo: ruta,
          linea: numeroDeLinea(texto, indiceLlaveAbre),
          detalle: `${nombreFn}() no empieza llamando a una guarda (${nombresGuarda.join(', ')}); "use server" la publica como endpoint alcanzable desde el navegador`,
        });
      }
    }
    return hallazgos;
  };
}

/* ============================================================
   sinSqlCrudoConOr
   ============================================================ */

/**
 * Un `or` (o `and`) suelto DENTRO de un fragmento `sql\`` de drizzle se
 * inserta sin envolver, así que combina mal con el `and()` de afuera que
 * suele llevar el filtro por tenant. Se considera "suelto" un `or` rodeado de
 * espacio en blanco después de sacarle al fragmento, repetidamente, todo lo
 * que esté entre paréntesis balanceados: una llamada real a `or(...)` de
 * drizzle colapsa a `or` PEGADO al `$` de la interpolación o sin espacio
 * alrededor, así que no dispara.
 */
export function sinSqlCrudoConOr(): Detector {
  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    const hallazgos: Hallazgo[] = [];
    const re = /sql`([^`]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      if (contieneOrSuelto(m[1]!)) {
        hallazgos.push({
          regla: 'sinSqlCrudoConOr',
          archivo: ruta,
          linea: numeroDeLinea(texto, m.index),
          detalle:
            'fragmento sql` con un "or" fuera de un or(...) de drizzle: se inserta sin paréntesis y puede anular el filtro (ej. por tenant) de afuera',
        });
      }
    }
    return hallazgos;
  };
}

function contieneOrSuelto(fragmento: string): boolean {
  let previo = '';
  let t = fragmento;
  while (previo !== t) {
    previo = t;
    t = t.replace(/\([^()]*\)/g, '');
  }
  return /\sor\s/i.test(t);
}

/* ============================================================
   sinCoalesceCeroEnPlata
   ============================================================ */

export interface OpcionesSinCoalesceCeroEnPlata {
  /** Regex que identifica una línea "de plata" (ej: /monto|precio|total/i). */
  patrones: RegExp;
}

/**
 * Una línea que matchea `patrones` (algo relacionado con plata) y además
 * hace `?? 0` es sospechosa: convierte "no se pudo leer el monto" en "el
 * monto es cero" sin avisar, en vez de tratarlo como un error. Cero es un
 * valor de plata legítimo, así que la regla no prohíbe `?? 0` en general —
 * solo en líneas que YA hablan de plata por su propio patrón.
 */
export function sinCoalesceCeroEnPlata(opciones: OpcionesSinCoalesceCeroEnPlata): Detector {
  const patron = sinEstado(opciones.patrones);
  const CON_COALESCE_CERO = /\?\?\s*0\b/;

  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    const hallazgos: Hallazgo[] = [];
    const limpio = blanquear(texto);
    const lineasLimpias = limpio.split('\n');
    const lineasOriginales = texto.split('\n');
    for (let i = 0; i < lineasLimpias.length; i++) {
      const linea = lineasLimpias[i]!;
      if (patron.test(linea) && CON_COALESCE_CERO.test(linea)) {
        hallazgos.push({
          regla: 'sinCoalesceCeroEnPlata',
          archivo: ruta,
          linea: i + 1,
          detalle: `línea de plata con "?? 0": ${lineasOriginales[i]!.trim()}`,
        });
      }
    }
    return hallazgos;
  };
}

/* ============================================================
   sinSetHours
   ============================================================ */

/**
 * `date.setHours(...)`/`date.setUTCHours(...)` MUTA el `Date` en el lugar y
 * devuelve un número (el timestamp), no el `Date` — encadenarlo
 * (`f(d.setHours(0,0,0,0))`) le pasa a `f` un número, no una fecha, y
 * reusar `d` en otro lado después ve el valor mutado. Se prefiere una
 * función de fechas inmutable (`@mafesoftware/fechas-ar` u otra) que
 * devuelva un `Date` nuevo.
 */
export function sinSetHours(): Detector {
  const RE = /\.set(?:UTC)?Hours\s*\(/g;
  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    const hallazgos: Hallazgo[] = [];
    const limpio = blanquear(texto);
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(limpio))) {
      hallazgos.push({
        regla: 'sinSetHours',
        archivo: ruta,
        linea: numeroDeLinea(texto, m.index),
        detalle: `${m[0]!.replace(/\s*\($/, '')}...): muta el Date en el lugar y devuelve un número, no el Date`,
      });
    }
    return hallazgos;
  };
}

/* ============================================================
   serverOnlyEnDatos
   ============================================================ */

export interface OpcionesServerOnlyEnDatos {
  /** Qué archivos cuentan como "de datos" (ej: /\/datos[A-Z][A-Za-z]*\.ts$/). */
  patronArchivo: RegExp;
}

const IMPORT_SERVER_ONLY = /^\s*import\s+["']server-only["'];?\s*$/m;

/**
 * Un archivo que matchea `patronArchivo` (típicamente `datosX.ts`, que lee la
 * base) tiene que importar `"server-only"`: es lo único que rompe el BUILD si
 * un componente cliente lo importa por error — el typecheck lo deja pasar.
 */
export function serverOnlyEnDatos(opciones: OpcionesServerOnlyEnDatos): Detector {
  const patron = sinEstado(opciones.patronArchivo);
  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    if (!patron.test(ruta)) return [];
    if (IMPORT_SERVER_ONLY.test(texto)) return [];
    return [
      {
        regla: 'serverOnlyEnDatos',
        archivo: ruta,
        linea: 1,
        detalle: `${ruta} coincide con el patrón de archivos de datos y no importa "server-only"`,
      },
    ];
  };
}

/* ============================================================
   sinImportDeDatosEnCliente
   ============================================================ */

export interface OpcionesSinImportDeDatosEnCliente {
  /** Qué especificador de import cuenta como "módulo de datos" (ej: /\/datos[A-Z]/). */
  patronDatos: RegExp;
}

const DIRECTIVA_USE_CLIENT = /^\s*["']use client["']/m;

/**
 * Un archivo `"use client"` (que el navegador bundlea) no puede importar un
 * módulo de datos: arrastra Postgres/drizzle al bundle del cliente, rompe el
 * build, y el typecheck no lo ve.
 */
export function sinImportDeDatosEnCliente(opciones: OpcionesSinImportDeDatosEnCliente): Detector {
  const patron = sinEstado(opciones.patronDatos);
  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    if (!DIRECTIVA_USE_CLIENT.test(texto)) return [];

    const hallazgos: Hallazgo[] = [];
    // Solo comentarios blanqueados: el especificador vive dentro de comillas
    // y `blanquear` (que también blanquea strings) se lo comería.
    const limpio = blanquearComentarios(texto);
    const re = /from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(limpio))) {
      const especificador = m[1]!;
      if (patron.test(especificador)) {
        hallazgos.push({
          regla: 'sinImportDeDatosEnCliente',
          archivo: ruta,
          linea: numeroDeLinea(texto, m.index),
          detalle: `archivo "use client" importa un módulo de datos: ${especificador}`,
        });
      }
    }
    return hallazgos;
  };
}

/* ============================================================
   sinDependenciaFile
   ============================================================ */

const CAMPOS_DEPENDENCIAS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/**
 * Un `package.json` con una dependencia `file:`/`link:` apunta a una ruta
 * local de la máquina de quien lo escribió: instala en cualquier otro lado
 * (CI, otra máquina, el consumidor real) fallando o —peor— instalando algo
 * completamente distinto si esa ruta existe mirando otra cosa. Solo mira
 * archivos cuya ruta termina en `package.json`; el resto los ignora en
 * silencio.
 */
export function sinDependenciaFile(): Detector {
  return (archivo: ArchivoFuente): Hallazgo[] => {
    const { ruta, texto } = archivo;
    if (!ruta.endsWith('package.json')) return [];

    let paquete: Record<string, unknown>;
    try {
      paquete = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      return [];
    }

    const hallazgos: Hallazgo[] = [];
    for (const campo of CAMPOS_DEPENDENCIAS) {
      const mapa = paquete[campo];
      if (!mapa || typeof mapa !== 'object') continue;
      for (const [nombre, version] of Object.entries(mapa as Record<string, unknown>)) {
        if (typeof version === 'string' && /^(file:|link:)/.test(version)) {
          hallazgos.push({
            regla: 'sinDependenciaFile',
            archivo: ruta,
            linea: 1,
            detalle: `${campo}.${nombre} = "${version}": dependencia local (file:/link:), no instalable fuera de esta máquina`,
          });
        }
      }
    }
    return hallazgos;
  };
}

/* ============================================================
   correrDetectores
   ============================================================ */

/** Corre cada `detector` sobre cada `archivo` y concatena todos los hallazgos. */
export function correrDetectores(archivos: ArchivoFuente[], detectores: Detector[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const archivo of archivos) {
    for (const detector of detectores) {
      hallazgos.push(...detector(archivo));
    }
  }
  return hallazgos;
}
