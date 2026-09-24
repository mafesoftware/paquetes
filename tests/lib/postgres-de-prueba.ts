import { Pool } from 'pg';

/**
 * Helper de test COMPARTIDO para los paquetes con subpath `/drizzle` que
 * prueban contra Postgres real (`packages/*\/tests/drizzle/postgres*.test.ts`).
 *
 * Vive en `tests/lib/` de la RAÍZ, no en un paquete publicado — a propósito:
 * - No es parte de la API de ningún paquete: es infraestructura de test del
 *   monorepo (conectar al `db_test` de `docker-compose.yml`, puerto 5475, y
 *   fallar con un mensaje claro si no está arriba), y publicarlo como
 *   `@mafesoftware/algo` obligaría a versionarlo, documentarlo con README/
 *   CHANGELOG y darle ≥95% de cobertura como a cualquier paquete real (spec
 *   06 §3) por algo que ningún consumidor externo necesita.
 * - Un paquete nuevo bajo `packages/` (aunque fuera privado) tampoco sirve:
 *   `vitest.config.ts` (`umbralesDeCoberturaPorPaquete`) genera un umbral de
 *   cobertura del 95% por cada `packages/<nombre>/src/**` que exista, así
 *   que un paquete "de mentira" solo para este helper heredaría esa exigencia
 *   sin necesitarla.
 * - `tests/lib/` de la raíz ya es el lugar establecido para utilidades de
 *   test que no son producto (`verificar-paquete.ts`, `glob-simple.ts`): es
 *   una carpeta de test del propio monorepo, nunca se empaqueta (el `files`
 *   de cada `package.json` no incluye nada fuera de `packages/<nombre>`), y
 *   cada paquete con Postgres de test la importa por ruta relativa
 *   (`../../../../tests/lib/postgres-de-prueba.js` desde
 *   `packages/<nombre>/tests/drizzle/`), sin agregar ninguna dependencia
 *   nueva (`pg` ya es devDependency de cada paquete `/drizzle`).
 *
 * Antes de este archivo, `packages/tenant/tests/drizzle/postgres.test.ts`
 * tenía esta misma lógica escrita a mano (URL sin password, desarme de
 * `AggregateError`, mensaje de `beforeAll`); ahora la importa de acá, igual
 * que `packages/numeradores`.
 */

/** `DATABASE_URL_TEST` (default: el `docker-compose.yml` de la raíz, servicio `db_test`, puerto 5475). */
export const DATABASE_URL_TEST =
  process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5475/paquetes_test';

/**
 * La URL de conexión, con la contraseña tapada — nunca se debe poner una
 * credencial en texto plano en la salida de un test (aunque acá sea la de
 * un Postgres descartable de test, el hábito es el que importa: el mismo
 * código de error corre con `DATABASE_URL_TEST` apuntando a cualquier lado).
 */
export function urlSinPassword(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    // Por si el parser de URL no entiende el esquema "postgres:" en algún
    // runtime: mismo resultado con una regex sobre "usuario:password@".
    return url.replace(/:\/\/([^:/@]+):([^@]+)@/, '://$1:***@');
  }
}

/**
 * Una descripción legible del error de conexión: mensaje, `error.code`
 * (p. ej. `"ECONNREFUSED"`) si lo tiene, y — si es un `AggregateError` (Node
 * junta ahí varios intentos cuando un host resuelve a más de una dirección,
 * típico de "localhost" con IPv4 e IPv6 a la vez) — el detalle de CADA
 * intento interno, porque el mensaje de afuera solo dice "algo falló" y el
 * `code` útil suele estar en uno de los internos.
 */
export function describirErrorDeConexion(error: unknown): string {
  if (error instanceof AggregateError) {
    const internos = error.errors.map((e) => describirErrorDeConexion(e)).join(' | ');
    return `${error.message} [${internos}]`;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${error.message} (code: ${code})` : error.message;
  }
  return String(error);
}

/**
 * Arma un `Pool` contra `DATABASE_URL_TEST` y verifica la conexión con un
 * `select 1`. Si falla, CIERRA el pool y TIRA con un mensaje claro (URL sin
 * password, instrucción de `docker compose up -d db_test`, causa original
 * incluida) — nunca se salta el test en silencio. Pensado para llamarse
 * desde un `beforeAll`.
 */
export async function poolDePrueba(): Promise<Pool> {
  const pool = new Pool({ connectionString: DATABASE_URL_TEST, connectionTimeoutMillis: 3000 });
  try {
    await pool.query('select 1');
    return pool;
  } catch (error) {
    await pool.end().catch(() => {});
    throw new Error(
      `No se pudo conectar a Postgres de test en ${urlSinPassword(DATABASE_URL_TEST)}. ` +
        'Correr "docker compose up -d db_test" desde la raíz del monorepo antes de testear ' +
        `(o setear DATABASE_URL_TEST si Postgres corre en otro lado). Causa original: ${describirErrorDeConexion(error)}`,
    );
  }
}
