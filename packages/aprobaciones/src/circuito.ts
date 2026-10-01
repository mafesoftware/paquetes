/**
 * Motor PURO de aprobaciones: elegir qué circuito aplica a un documento y
 * calcular en qué nivel está una solicitud, dados sus votos. Sin DB, sin
 * framework — solo estructuras y funciones puras, testeadas a fondo sin
 * levantar Postgres.
 *
 * Extraído de Obriq (`src/lib/dominio/aprobaciones/circuito.ts`), generalizado
 * para cualquier producto: `tipo` es `string` libre (en Obriq, un enum
 * cerrado de documentos inmobiliarios — `"orden_pedido"`, `"certificado"`,
 * `"cambio_cbu"`...; otro producto define los suyos sin tocar este paquete).
 *
 * Montos en centavos (`bigint`) — nunca `number`, para no perder precisión
 * ni arrastrar error de redondeo en las comparaciones de `condiciones`.
 */

/** Condiciones de un circuito: cada campo no nulo es un filtro que el documento tiene que cumplir. */
export type CondicionesCircuito = {
  montoDesde: bigint | null;
  montoHasta: bigint | null;
  proyectoId: string | null;
  rubroId: string | null;
  proveedorId: string | null;
};

/** Un nivel de aprobación: a quién le toca votar (por usuario o por rol) y cuántos votos "aprobar" alcanzan. */
export type NivelCircuito = { orden: number; usuarios: string[]; roles: string[]; minimo: number };

/** Una VERSIÓN de un circuito de aprobación para un `tipo` de documento. */
export type Circuito = {
  id: string;
  version: number;
  tipo: string;
  condiciones: CondicionesCircuito;
  niveles: NivelCircuito[];
  creadorPuedeAprobar: boolean;
};

/** El documento sobre el que se pide aprobación, con los campos que `elegirCircuito`/`estadoSolicitud` necesitan. */
export type DocAprobable = {
  tipo: string;
  id: string;
  monto: bigint;
  moneda: string;
  proyectoId: string | null;
  rubroIds: string[];
  proveedorId: string | null;
  creadoPor: string;
};

/** Un voto emitido en un nivel de una solicitud. */
export type Voto = { nivel: number; usuarioId: string; decision: 'aprobar' | 'rechazar'; comentario: string | null; en: string };

/** ¿Esta condición puntual (si está presente) matchea el documento? */
function condicionesCoinciden(c: CondicionesCircuito, d: DocAprobable): boolean {
  if (c.montoDesde !== null && d.monto < c.montoDesde) return false;
  if (c.montoHasta !== null && d.monto > c.montoHasta) return false;
  if (c.proyectoId !== null && c.proyectoId !== d.proyectoId) return false;
  if (c.rubroId !== null && !d.rubroIds.includes(c.rubroId)) return false;
  if (c.proveedorId !== null && c.proveedorId !== d.proveedorId) return false;
  return true;
}

/** Cuántas condiciones no nulas tiene el circuito — la "especificidad" para desempatar entre varios que coinciden. */
function especificidad(c: CondicionesCircuito): number {
  return [c.montoDesde, c.montoHasta, c.proyectoId, c.rubroId, c.proveedorId].filter((v) => v !== null).length;
}

/**
 * El circuito que aplica a un documento: el más específico entre los que
 * coinciden; empate → mayor `montoDesde` (`null` se trata como el mínimo
 * posible); empate → el más nuevo (mayor `version` — es la única señal de
 * recencia que trae `Circuito`; el llamador pasa solo circuitos ACTIVOS de
 * un mismo `tipo`, así que comparar `version` entre ellos es válido).
 * Ninguno coincide → `null` (el documento no requiere aprobación).
 */
export function elegirCircuito(cs: readonly Circuito[], d: DocAprobable): Circuito | null {
  const candidatos = cs.filter((c) => c.tipo === d.tipo && condicionesCoinciden(c.condiciones, d));
  if (candidatos.length === 0) return null;

  let mejor = candidatos[0]!;
  for (const c of candidatos.slice(1)) {
    const espC = especificidad(c.condiciones);
    const espMejor = especificidad(mejor.condiciones);
    if (espC > espMejor) {
      mejor = c;
      continue;
    }
    if (espC < espMejor) continue;

    const desdeC = c.condiciones.montoDesde ?? -1n;
    const desdeMejor = mejor.condiciones.montoDesde ?? -1n;
    if (desdeC > desdeMejor) {
      mejor = c;
      continue;
    }
    if (desdeC < desdeMejor) continue;

    if (c.version > mejor.version) mejor = c;
  }
  return mejor;
}

export type EstadoSolicitud = {
  /** El nivel (1-indexado) que todavía está votando, o `null` si ya está `completa`/`rechazada`. */
  nivelActual: number | null;
  completa: boolean;
  rechazada: boolean;
  /** ¿Puede `usuarioId` (con estos `roles`) votar AHORA MISMO en el nivel actual? */
  puedeVotar: (usuarioId: string, roles: string[]) => boolean;
};

/**
 * El estado de una solicitud dado su circuito (snapshot — congelado al
 * abrirla, para que editar el circuito no afecte una solicitud en curso) y
 * los votos ya emitidos: secuencial por nivel (`orden`), un nivel se
 * completa cuando llega a su `minimo` de votos "aprobar"; un solo
 * "rechazar" en cualquier nivel rechaza toda la solicitud.
 *
 * Auto-aprobación bloqueada: si `creadorPuedeAprobar` es `false`, quien creó
 * el documento (`d.creadoPor`) nunca puede votar su propia solicitud, aunque
 * figure entre los `usuarios`/`roles` habilitados del nivel.
 */
export function estadoSolicitud(snapshot: Circuito, votos: readonly Voto[], d: DocAprobable): EstadoSolicitud {
  const rechazada = votos.some((v) => v.decision === 'rechazar');
  const niveles = [...snapshot.niveles].sort((a, b) => a.orden - b.orden);

  let nivelActual: number | null = niveles[0]?.orden ?? null;
  let completa = false;

  if (!rechazada) {
    for (const nivel of niveles) {
      const aprobaciones = votos.filter((v) => v.nivel === nivel.orden && v.decision === 'aprobar').length;
      if (aprobaciones >= nivel.minimo) {
        // este nivel está completo: seguir al próximo (o terminar si era el último)
        const siguiente = niveles.find((n) => n.orden > nivel.orden);
        nivelActual = siguiente ? siguiente.orden : null;
        if (!siguiente) completa = true;
      } else {
        nivelActual = nivel.orden;
        break;
      }
    }
  }

  const puedeVotar = (usuarioId: string, roles: string[]): boolean => {
    if (rechazada || completa || nivelActual === null) return false;
    if (usuarioId === d.creadoPor && !snapshot.creadorPuedeAprobar) return false;

    const nivel = niveles.find((n) => n.orden === nivelActual);
    if (!nivel) return false;

    const yaVoto = votos.some((v) => v.nivel === nivelActual && v.usuarioId === usuarioId);
    if (yaVoto) return false;

    return nivel.usuarios.includes(usuarioId) || roles.some((r) => nivel.roles.includes(r));
  };

  return { nivelActual, completa, rechazada, puedeVotar };
}
