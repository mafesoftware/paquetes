/**
 * Presets con excepciones: el álgebra que usan los ROLES y los MÓDULOS.
 *
 * Los dos sistemas tienen exactamente la misma forma y por eso viven en el
 * mismo paquete:
 *
 * - **El rol es el preset** de lo que una persona puede hacer;
 *   `usuarios.permisos` son las EXCEPCIONES a ese preset.
 * - **El plan es el preset** de lo que un club tiene contratado;
 *   `modulos_club` son las EXCEPCIONES a ese plan.
 *
 * ## La regla que más veces se rompe
 *
 * **La ausencia significa lo que diga el preset, nunca `false`.** Un mapa de
 * excepciones vacío no quiere decir "no puede nada": quiere decir "lo que
 * traiga su rol". Tratarlo como una lista blanca deja sin permisos a todo el
 * mundo el día que alguien guarda el formulario sin tocar nada — y no falla
 * ruidosamente, falla como "a esta persona le desapareció el menú".
 *
 * Por eso las excepciones son `Record<clave, boolean>`: `true` CONCEDE algo
 * que el preset no da, `false` QUITA algo que el preset sí da, y **no estar**
 * es la única forma de decir "lo que diga el preset".
 *
 * ## Esto NO es seguridad por sí solo
 *
 * Este paquete calcula; no protege. Un menú que esconde una sección esconde,
 * no protege. La guarda de verdad va **al principio de cada acción del
 * servidor** — que es un endpoint alcanzable desde el navegador aunque no haya
 * ningún botón que lo llame.
 *
 * Puro, sin dependencias, sin `process.env`. Lo importa el menú, que es
 * cliente.
 */

/**
 * Las excepciones a un preset.
 *
 * `undefined` / `null` / `{}` significan todos "lo que diga el preset".
 */
export type Excepciones<C extends string = string> = Partial<Record<C, boolean>> | null | undefined;

/** Un preset: la lista de claves que concede, o `"todas"`. */
export type Preset<C extends string = string> = readonly C[] | "todas";

export type Sistema<C extends string, N extends string> = {
  /** Todas las claves que el sistema conoce, en orden de declaración. */
  readonly claves: readonly C[];
  /** Los presets declarados. */
  readonly presets: Readonly<Record<N, Preset<C>>>;
  /** ¿Este preset, con estas excepciones, concede esta clave? */
  tiene(preset: N, excepciones: Excepciones<C>, clave: C): boolean;
  /** El conjunto efectivo, ya resueltas las excepciones. */
  efectivas(preset: N, excepciones: Excepciones<C>): Set<C>;
  /** Lo que el preset concede por sí solo, sin excepciones. */
  delPreset(preset: N): Set<C>;
  /**
   * Las excepciones MÍNIMAS para llegar de `preset` al conjunto deseado.
   *
   * Es lo que hay que guardar cuando alguien tilda casilleros en un
   * formulario: guardar el conjunto entero como excepciones congela los
   * permisos del día en que se guardó, y el día que el rol cambie esa persona
   * se queda con los viejos sin que nadie se entere.
   */
  minimas(preset: N, deseadas: Iterable<C>): Partial<Record<C, boolean>>;
  /** Saca del mapa las claves que el sistema no conoce y las que no cambian nada. */
  limpiar(preset: N, excepciones: Excepciones<C>): Partial<Record<C, boolean>>;
  /** ¿Es una clave declarada? Para validar lo que llega de un formulario. */
  esClave(x: unknown): x is C;
};

/**
 * Declara un sistema de presets con excepciones.
 *
 * ```ts
 * export const ROLES = crearSistema({
 *   claves: ["socios.ver", "socios.editar", "cobranzas.cobrar"] as const,
 *   presets: {
 *     duenio: "todas",
 *     tesoreria: ["socios.ver", "cobranzas.cobrar"],
 *     porteria: ["socios.ver"],
 *   },
 * });
 *
 * ROLES.tiene("porteria", { "socios.editar": true }, "socios.editar"); // true
 * ROLES.tiene("duenio", { "cobranzas.cobrar": false }, "cobranzas.cobrar"); // false
 * ```
 */
export function crearSistema<C extends string, N extends string>(config: {
  claves: readonly C[];
  presets: Record<N, Preset<C>>;
}): Sistema<C, N> {
  const claves = Object.freeze([...config.claves]) as readonly C[];
  const conocidas = new Set<string>(claves);
  const presets = Object.freeze({ ...config.presets });

  // Se resuelven una sola vez: `"todas"` es la lista entera, y una lista suelta
  // se filtra contra las claves declaradas para que una clave mal escrita en un
  // preset falle acá y no como un permiso que nunca aparece.
  const resueltos = new Map<N, Set<C>>();
  for (const nombre of Object.keys(presets) as N[]) {
    const p = presets[nombre];
    resueltos.set(nombre, new Set(p === "todas" ? claves : p.filter((c) => conocidas.has(c))));
  }

  const delPreset = (preset: N): Set<C> => new Set(resueltos.get(preset) ?? []);

  const efectivas = (preset: N, excepciones: Excepciones<C>): Set<C> => {
    const set = delPreset(preset);
    if (!excepciones) return set;
    for (const [clave, valor] of Object.entries(excepciones) as [C, boolean | undefined][]) {
      // `undefined` NO es `false`: es "lo que diga el preset", asi que se saltea.
      if (valor === undefined || !conocidas.has(clave)) continue;
      if (valor) set.add(clave);
      else set.delete(clave);
    }
    return set;
  };

  return {
    claves,
    presets,
    delPreset,
    efectivas,
    tiene(preset, excepciones, clave) {
      if (!conocidas.has(clave)) return false;
      const excepcion = excepciones?.[clave];
      if (excepcion !== undefined) return excepcion;
      return (resueltos.get(preset) ?? new Set<C>()).has(clave);
    },
    minimas(preset, deseadas) {
      const quiere = new Set<C>();
      for (const c of deseadas) if (conocidas.has(c)) quiere.add(c);
      const base = resueltos.get(preset) ?? new Set<C>();
      const out: Partial<Record<C, boolean>> = {};
      for (const clave of claves) {
        const enBase = base.has(clave);
        const enQuiere = quiere.has(clave);
        if (enBase !== enQuiere) out[clave] = enQuiere;
      }
      return out;
    },
    limpiar(preset, excepciones) {
      if (!excepciones) return {};
      const base = resueltos.get(preset) ?? new Set<C>();
      const out: Partial<Record<C, boolean>> = {};
      for (const [clave, valor] of Object.entries(excepciones) as [C, boolean | undefined][]) {
        if (valor === undefined || !conocidas.has(clave)) continue;
        // Una excepcion que dice lo mismo que el preset es ruido que se vuelve
        // mentira apenas el preset cambie.
        if (base.has(clave) === valor) continue;
        out[clave] = valor;
      }
      return out;
    },
    esClave(x): x is C {
      return typeof x === "string" && conocidas.has(x);
    },
  };
}

/**
 * Lee un mapa de excepciones que vino de la base (`jsonb`) o de un formulario.
 *
 * Descarta lo que no sea booleano en vez de coercionarlo: un `"false"` de
 * texto es `true` en JavaScript, y ese es exactamente el error que le devuelve
 * a alguien un permiso que le habían sacado.
 */
export function leerExcepciones<C extends string>(
  crudo: unknown,
  esClave: (x: unknown) => x is C
): Partial<Record<C, boolean>> {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return {};
  const out: Partial<Record<C, boolean>> = {};
  for (const [clave, valor] of Object.entries(crudo)) {
    if (typeof valor === "boolean" && esClave(clave)) out[clave] = valor;
  }
  return out;
}
