import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ResultadoVerificacion {
  ok: boolean;
  errores: string[];
}

/** Subcarpetas de `src/` donde SÍ está permitido importar drizzle-orm/next/react/@aws-sdk. */
const SUBCARPETAS_PERMITIDAS = new Set(['drizzle', 'next']);

/** Especificadores de import prohibidos en el núcleo (fuera de drizzle/ y next/). */
const IMPORTS_PROHIBIDOS = ['drizzle-orm', 'next', 'react', '@aws-sdk'];

const EXTENSIONES_FUENTE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']);

/**
 * Verifica que un directorio de paquete cumpla las reglas de diseño del
 * monorepo (spec 06 §3 / restricciones.md): README con sección "## API",
 * CHANGELOG, `exports`/`files` apuntando a dist, licencia MIT, y núcleo puro
 * (sin importar drizzle-orm/next/react/@aws-sdk ni usar process.env, salvo en
 * las subcarpetas src/drizzle/ y src/next/).
 */
export function verificarPaquete(dir: string): ResultadoVerificacion {
  const errores: string[] = [];

  verificarReadme(dir, errores);
  verificarChangelog(dir, errores);
  const packageJson = verificarPackageJson(dir, errores);
  verificarNucleo(dir, errores);

  return { ok: errores.length === 0, errores };
}

function verificarReadme(dir: string, errores: string[]): void {
  const ruta = join(dir, 'README.md');
  if (!existsSync(ruta)) {
    errores.push('Falta README.md');
    return;
  }
  const contenido = readFileSync(ruta, 'utf8');
  if (!/^#{1,6}\s*API\b/m.test(contenido)) {
    errores.push('El README.md no tiene una sección "## API"');
  }
}

function verificarChangelog(dir: string, errores: string[]): void {
  const ruta = join(dir, 'CHANGELOG.md');
  if (!existsSync(ruta)) {
    errores.push('Falta CHANGELOG.md');
  }
}

function verificarPackageJson(dir: string, errores: string[]): Record<string, unknown> | undefined {
  const ruta = join(dir, 'package.json');
  if (!existsSync(ruta)) {
    errores.push('Falta package.json');
    return undefined;
  }

  let paquete: Record<string, unknown>;
  try {
    paquete = JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>;
  } catch {
    errores.push('package.json no es JSON válido');
    return undefined;
  }

  if (paquete.license !== 'MIT') {
    errores.push(`La licencia debe ser "MIT" (es "${String(paquete.license)}")`);
  }

  const exportsApuntaADist = apuntaADist(paquete.exports);
  if (!exportsApuntaADist) {
    errores.push('El campo "exports" debe apuntar a ./dist (import y types)');
  }

  const files = paquete.files;
  if (!Array.isArray(files) || !files.includes('dist')) {
    errores.push('El campo "files" debe existir e incluir "dist"');
  }

  return paquete;
}

function apuntaADist(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== 'object') {
    return false;
  }
  const entradaPrincipal = (exportsField as Record<string, unknown>)['.'];
  if (!entradaPrincipal || typeof entradaPrincipal !== 'object') {
    return false;
  }
  const { import: rutaImport, types } = entradaPrincipal as Record<string, unknown>;
  const importOk = typeof rutaImport === 'string' && rutaImport.startsWith('./dist/');
  const typesOk = typeof types !== 'string' || types.startsWith('./dist/');
  return importOk && typesOk;
}

function verificarNucleo(dir: string, errores: string[]): void {
  const src = join(dir, 'src');
  if (!existsSync(src)) {
    return;
  }

  for (const archivo of listarArchivosFuente(src)) {
    const rel = relative(src, archivo);
    const primeraCarpeta = rel.split('/')[0];
    const enSubcarpetaPermitida =
      primeraCarpeta !== undefined && rel.includes('/') && SUBCARPETAS_PERMITIDAS.has(primeraCarpeta);
    if (enSubcarpetaPermitida) {
      continue;
    }

    const contenido = readFileSync(archivo, 'utf8');

    for (const prohibido of IMPORTS_PROHIBIDOS) {
      if (importa(contenido, prohibido)) {
        errores.push(`src/${rel} (núcleo) importa "${prohibido}", no permitido fuera de src/drizzle/ o src/next/`);
      }
    }

    if (/process\.env/.test(contenido)) {
      errores.push(`src/${rel} (núcleo) usa process.env, no permitido fuera de src/drizzle/ o src/next/`);
    }
  }
}

function importa(contenido: string, especificador: string): boolean {
  const especificadorEscapado = especificador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(
    `(?:from|require\\()\\s*['"]${especificadorEscapado}(?:/[^'"]*)?['"]|import\\s*\\(\\s*['"]${especificadorEscapado}(?:/[^'"]*)?['"]`,
  );
  return patron.test(contenido);
}

function listarArchivosFuente(dir: string): string[] {
  const resultado: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) {
      resultado.push(...listarArchivosFuente(ruta));
    } else if (EXTENSIONES_FUENTE.has(extensionDe(nombre))) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  return i === -1 ? '' : nombre.slice(i);
}
