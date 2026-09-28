/**
 * Un caso de aislamiento: qué hace (`ejecutar`) el tenant B con el id de A.
 *
 * `ejecutar` recibe el tenant B (`ctx.tenant`, el que ATACA) y el id de un
 * recurso que pertenece a A (`ctx.idAjeno`). Se espera que el resultado (o la
 * excepción) sea indistinguible de "no existe" — nunca datos de A, nunca un
 * error que confirme que existe algo con ese id.
 */
export interface CasoAislamiento<T> {
  nombre: string;
  ejecutar: (ctx: { tenant: T; idAjeno: string }) => Promise<unknown>;
}

export interface OpcionesProbarAislamiento<T> {
  /** Los casos a correr. Al menos uno. */
  casos: CasoAislamiento<T>[];
  /**
   * Siembra un par de tenants aislados y el id de un recurso de A. Se llama
   * una vez POR CASO (no una sola vez para todos): así un caso que muta
   * datos (confirma, cancela, borra) no deja al siguiente con el estado
   * cambiado, y el orden de `casos` no importa. Si sembrar es costoso y los
   * casos son de solo lectura, la app puede memoizar `sembrar` por su cuenta.
   */
  sembrar: () => Promise<{ a: T; b: T; idDeA: string }>;
  /**
   * Clasifica un resultado (lo que devolvió `ejecutar`) o una excepción (lo
   * que tiró) como "no encontrado". Recibe lo mismo en los dos casos porque a
   * la app le puede tocar cualquiera de las dos formas: un helper que
   * devuelve `null`/`{ ok: false, reason: "NOT_FOUND" }`, o uno que tira
   * `NotFoundError`. Un resultado o una excepción que NO clasifica como "no
   * encontrado" es una fuga: la B vio (o pudo confirmar la existencia de) un
   * recurso de A.
   */
  esNoEncontrado: (resultadoOError: unknown) => boolean;
}

/** El resultado de correr UN caso. */
export interface ResultadoAislamiento {
  nombre: string;
  /** `true` si el caso clasificó como "no encontrado" (ejecutar() no filtró). */
  ok: boolean;
  detalle: string;
}

/**
 * Corre cada caso de `casos` como tenant B contra un id de A, y clasifica el
 * resultado (o la excepción) con `esNoEncontrado`. Nunca tira por un caso que
 * filtra: eso se reporta como `{ ok: false, detalle }` en el array devuelto,
 * para que quien llama decida cómo fallar (ver `describeAislamiento` en el
 * subpath `/vitest`, que sí hace fallar el test). Si tira `sembrar()` mismo,
 * eso SÍ propaga — es un error de la app consumidora (su fixture no levanta),
 * no un hallazgo de aislamiento.
 */
export async function probarAislamiento<T>(opciones: OpcionesProbarAislamiento<T>): Promise<ResultadoAislamiento[]> {
  const { casos, sembrar, esNoEncontrado } = opciones;
  if (casos.length === 0) {
    throw new Error('probarAislamiento requiere al menos un caso en `casos`');
  }

  const resultados: ResultadoAislamiento[] = [];
  for (const caso of casos) {
    const { b, idDeA } = await sembrar();
    resultados.push(await correrCaso(caso, b, idDeA, esNoEncontrado));
  }
  return resultados;
}

async function correrCaso<T>(
  caso: CasoAislamiento<T>,
  tenant: T,
  idAjeno: string,
  esNoEncontrado: (resultadoOError: unknown) => boolean,
): Promise<ResultadoAislamiento> {
  try {
    const resultado = await caso.ejecutar({ tenant, idAjeno });
    const ok = esNoEncontrado(resultado);
    return {
      nombre: caso.nombre,
      ok,
      detalle: ok
        ? 'clasificó como "no encontrado" (resultado), como se espera'
        : `filtró: el resultado no clasificó como "no encontrado" (${describir(resultado)})`,
    };
  } catch (error) {
    const ok = esNoEncontrado(error);
    return {
      nombre: caso.nombre,
      ok,
      detalle: ok
        ? 'clasificó como "no encontrado" (tiró), como se espera'
        : `filtró: tiró algo que no clasificó como "no encontrado" (${describir(error)})`,
    };
  }
}

function describir(valor: unknown): string {
  if (valor instanceof Error) return `${valor.name}: ${valor.message}`;
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}
