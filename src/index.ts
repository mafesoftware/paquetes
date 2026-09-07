/**
 * Control de acceso: quién entra, por qué no, y cómo se reconcilia lo que un
 * molinete registró sin internet.
 *
 * Puro y sin dependencias fuera de `@mafesoftware/fechas-ar`. No toca la base
 * ni la red: recibe el socio, el dispositivo y el momento, y devuelve la
 * decisión. Quien lo llama la persiste y abre (o no) la barrera.
 *
 * ## Por qué la decisión vive acá y no en el dispositivo
 *
 * Porque tiene que dar **lo mismo** en los tres lugares donde se toma: el
 * molinete con red, el molinete sin red trabajando contra su copia del padrón,
 * y la pantalla de portería donde alguien escanea con el celular. Escrita tres
 * veces, cada una envejece por su lado y el club descubre que la puerta de
 * atrás deja pasar a un moroso que la de adelante frena.
 *
 * ## El carnet dice QUIÉN, esto dice SI
 *
 * `@mafesoftware/carnet-qr` valida la credencial: que la firmó este club y que
 * no venció. Eso es identidad. El estado de cuota, la categoría, el horario y
 * el aforo son de acá, y salen del padrón —vivo o sincronizado—, nunca del
 * token. Un estado de cuota metido adentro del QR es una foto vieja que abre
 * la puerta a quien dejó de pagar.
 */

import { diaEnZona, horaCorta, ZONA_AR } from "@mafesoftware/fechas-ar";

export type Sentido = "ingreso" | "egreso";

/** Por qué no entra. Cada motivo es un mensaje distinto en la portería. */
export type MotivoRechazo =
  | "socio_desconocido"
  | "socio_inactivo"
  | "socio_suspendido"
  | "cuota_impaga"
  | "categoria_sin_acceso"
  | "fuera_de_horario"
  | "sin_apto_medico"
  | "antipassback"
  | "aforo_completo"
  | "dispositivo_inactivo"
  | "sentido_no_permitido";

/** El socio, tal como lo ve el control de acceso. */
export type SocioParaAcceso = {
  id: string;
  estado: "activo" | "suspendido" | "baja";
  categoriaId: string;
  /** Lo resuelve `@mafesoftware/cuotas`. Acá ya llega decidido. */
  alDia: boolean;
  /** Día hasta el que vale el apto médico, si el club lo pide. */
  aptoMedicoHasta?: string | null;
};

/** Una franja horaria de un dispositivo. `dia` 0 = domingo. */
export type FranjaHoraria = { dia: number; desdeMinutos: number; hastaMinutos: number };

export type DispositivoParaAcceso = {
  id: string;
  activo: boolean;
  /** Qué sentidos registra este molinete. Uno de entrada no deja salir. */
  sentidos: readonly Sentido[];
  /**
   * Si está vacío, pasan todas las categorías. Una lista vacía que
   * significara "ninguna" dejaría el club cerrado el día que alguien guarda
   * la configuración sin tildar nada.
   */
  categoriasPermitidas?: readonly string[];
  /** Si está vacío, no hay restricción horaria. */
  franjas?: readonly FranjaHoraria[];
  exigeCuotaAlDia: boolean;
  exigeAptoMedico?: boolean;
  /** Cupo simultáneo. Para la pileta y el gimnasio. */
  aforoMaximo?: number | null;
  /**
   * Minutos durante los que no se acepta un segundo ingreso del mismo socio.
   *
   * Es el antipassback: sin esto, uno entra y le pasa el teléfono al de
   * afuera. `0` o ausente lo apaga.
   */
  antipassbackMinutos?: number;
};

export type ContextoAcceso = {
  ahora: Date;
  /** La zona del club: los horarios son de pared, no UTC. */
  zona?: string;
  /** Cuántos hay adentro ahora. Para el aforo. */
  aforoActual?: number;
  /** El último movimiento de ESTE socio, para el antipassback. */
  ultimoMovimiento?: { sentido: Sentido; fechaHora: Date } | null;
  /**
   * Deja pasar igual y lo deja anotado. Es el botón de la portería para el
   * socio que discute: la puerta se abre, pero el registro dice que fue una
   * excepción y quién la autorizó.
   */
  forzadoPor?: string | null;
};

export type ResultadoAcceso = {
  permitido: boolean;
  motivo?: MotivoRechazo;
  /** Texto para la pantalla del molinete. Corto: se lee de un metro. */
  mensaje: string;
  /** Se permitió por una excepción manual, no porque correspondiera. */
  forzado: boolean;
  /** El motivo que se habría dado si no se forzaba. Va al registro. */
  motivoOriginal?: MotivoRechazo;
};

const MENSAJES: Record<MotivoRechazo, string> = {
  socio_desconocido: "Carnet no reconocido",
  socio_inactivo: "Socio dado de baja",
  socio_suspendido: "Socio suspendido",
  cuota_impaga: "Cuota impaga",
  categoria_sin_acceso: "Sin acceso a este sector",
  fuera_de_horario: "Fuera de horario",
  sin_apto_medico: "Apto médico vencido",
  antipassback: "Ya registró su ingreso",
  aforo_completo: "Capacidad completa",
  dispositivo_inactivo: "Lector fuera de servicio",
  sentido_no_permitido: "Lector de otro sentido",
};

/**
 * Decide si este socio pasa por este dispositivo en este momento.
 *
 * El orden de los chequeos no es casual: va de lo más general a lo más
 * particular, para que el mensaje que ve la persona en la pantalla sea el que
 * de verdad le sirve. Decirle "capacidad completa" a alguien que en realidad
 * está dado de baja lo manda a discutir con la persona equivocada.
 */
export function evaluarAcceso(
  socio: SocioParaAcceso | null | undefined,
  dispositivo: DispositivoParaAcceso,
  sentido: Sentido,
  contexto: ContextoAcceso
): ResultadoAcceso {
  const motivo = motivoDeRechazo(socio, dispositivo, sentido, contexto);

  if (!motivo) {
    return { permitido: true, mensaje: "Adelante", forzado: false };
  }

  // Forzar deja pasar y lo deja ANOTADO. Un permitido sin rastro de que fue
  // una excepcion vuelve invisible al socio que entra todos los dias debiendo.
  if (contexto.forzadoPor) {
    return {
      permitido: true,
      mensaje: "Ingreso autorizado manualmente",
      forzado: true,
      motivoOriginal: motivo,
    };
  }

  return { permitido: false, motivo, mensaje: MENSAJES[motivo], forzado: false };
}

function motivoDeRechazo(
  socio: SocioParaAcceso | null | undefined,
  d: DispositivoParaAcceso,
  sentido: Sentido,
  ctx: ContextoAcceso
): MotivoRechazo | null {
  const zona = ctx.zona ?? ZONA_AR;

  if (!d.activo) return "dispositivo_inactivo";
  if (!d.sentidos.includes(sentido)) return "sentido_no_permitido";
  if (!socio) return "socio_desconocido";
  if (socio.estado === "baja") return "socio_inactivo";
  if (socio.estado === "suspendido") return "socio_suspendido";

  // Un EGRESO no se frena nunca por plata ni por horario: encerrar a alguien
  // adentro del club porque debe la cuota no es una politica, es un problema.
  // Solo el estado del socio y el del lector pueden frenar una salida.
  if (sentido === "egreso") return null;

  if (d.categoriasPermitidas?.length && !d.categoriasPermitidas.includes(socio.categoriaId)) {
    return "categoria_sin_acceso";
  }

  if (d.franjas?.length && !dentroDeFranja(d.franjas, ctx.ahora, zona)) {
    return "fuera_de_horario";
  }

  if (d.exigeCuotaAlDia && !socio.alDia) return "cuota_impaga";

  if (d.exigeAptoMedico) {
    const hoy = diaEnZona(ctx.ahora, zona);
    if (!socio.aptoMedicoHasta || socio.aptoMedicoHasta < hoy) return "sin_apto_medico";
  }

  if (hayAntipassback(d, ctx)) return "antipassback";

  // El aforo va ULTIMO: es lo unico que puede cambiar entre que alguien mira
  // la pantalla y apoya el carnet, asi que es el rechazo que mas conviene que
  // llegue tarde y no tape a los otros.
  if (d.aforoMaximo != null && (ctx.aforoActual ?? 0) >= d.aforoMaximo) {
    return "aforo_completo";
  }

  return null;
}

function hayAntipassback(d: DispositivoParaAcceso, ctx: ContextoAcceso): boolean {
  const minutos = d.antipassbackMinutos ?? 0;
  if (minutos <= 0) return false;
  const ultimo = ctx.ultimoMovimiento;
  if (!ultimo || ultimo.sentido !== "ingreso") return false;
  const transcurridos = (ctx.ahora.getTime() - ultimo.fechaHora.getTime()) / 60_000;
  // Un movimiento del futuro (reloj desfasado) no cuenta como reciente: si no,
  // un dispositivo con la hora adelantada frena a todo el mundo.
  if (transcurridos < 0) return false;
  return transcurridos < minutos;
}

/**
 * ¿La hora de pared cae adentro de alguna franja?
 *
 * Una franja que termina antes de empezar cruza la medianoche (`22:00` a
 * `02:00`), que es como se configura un salón de eventos. Sin ese caso, la
 * fiesta se queda afuera a las doce.
 */
export function dentroDeFranja(
  franjas: readonly FranjaHoraria[],
  ahora: Date,
  zona = ZONA_AR
): boolean {
  const hhmm = horaCorta(ahora, zona);
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const minutos = h * 60 + m;
  const diaISO = diaEnZona(ahora, zona);
  const dia = new Date(`${diaISO}T00:00:00Z`).getUTCDay();
  const diaPrevio = (dia + 6) % 7;

  for (const f of franjas) {
    if (f.desdeMinutos <= f.hastaMinutos) {
      if (f.dia === dia && minutos >= f.desdeMinutos && minutos < f.hastaMinutos) return true;
    } else {
      // Cruza la medianoche: vale el tramo del dia que abre y el de la
      // madrugada siguiente, que ya es otro dia de la semana.
      if (f.dia === dia && minutos >= f.desdeMinutos) return true;
      if (f.dia === diaPrevio && minutos < f.hastaMinutos) return true;
    }
  }
  return false;
}

/* ============================================================
   SINCRONIZACIÓN OFFLINE
   ============================================================ */

/**
 * Un movimiento tal como lo registró un dispositivo.
 *
 * `idempotencyKey` la genera **el dispositivo**, no el servidor, y es lo único
 * que hace que reintentar sea gratis. Un molinete que se queda sin red guarda
 * los eventos y los manda cuando vuelve; si la respuesta se pierde, los manda
 * de nuevo. Sin una clave del lado del dispositivo, ese reintento duplica cada
 * ingreso y el aforo del sábado da el doble.
 */
export type EventoAcceso = {
  idempotencyKey: string;
  dispositivoId: string;
  socioId: string | null;
  sentido: Sentido;
  fechaHora: Date;
  permitido: boolean;
  motivo?: MotivoRechazo;
  /** Se decidió contra la copia local del padrón, sin consultar al servidor. */
  offline?: boolean;
};

export type Reconciliacion = {
  /** Los que hay que escribir, ordenados por cuándo pasaron. */
  aInsertar: EventoAcceso[];
  /** Los que ya estaban. Se cuentan para poder avisar, no son un error. */
  duplicados: EventoAcceso[];
  /** Los que llegaron mal formados. Se descartan con nombre y apellido. */
  invalidos: { evento: unknown; motivo: string }[];
};

/**
 * Separa un lote que llega de un dispositivo en lo nuevo y lo repetido.
 *
 * **Un duplicado no es un error.** Es la consecuencia esperada de una red
 * intermitente, y la respuesta correcta es `200` con la cuenta: si el servidor
 * contesta error, el dispositivo reintenta para siempre el mismo lote y nunca
 * llega a mandar los que faltan.
 *
 * El lote se deduplica también **contra sí mismo**: un dispositivo que se
 * reinicia a mitad de envío puede mandar la misma clave dos veces adentro del
 * mismo cuerpo.
 */
export function reconciliar(
  lote: readonly unknown[],
  yaRegistradas: ReadonlySet<string>
): Reconciliacion {
  const aInsertar: EventoAcceso[] = [];
  const duplicados: EventoAcceso[] = [];
  const invalidos: { evento: unknown; motivo: string }[] = [];
  const vistas = new Set<string>();

  for (const crudo of lote) {
    const parseado = leerEvento(crudo);
    if (!parseado.ok) {
      invalidos.push({ evento: crudo, motivo: parseado.motivo });
      continue;
    }
    const e = parseado.evento;
    if (yaRegistradas.has(e.idempotencyKey) || vistas.has(e.idempotencyKey)) {
      duplicados.push(e);
      continue;
    }
    vistas.add(e.idempotencyKey);
    aInsertar.push(e);
  }

  // Por cuando PASARON, no por cuando llegaron: el orden del lote es el de la
  // cola del dispositivo, y dos dispositivos que vuelven juntos intercalan sus
  // movimientos. El desempate por clave los deja siempre en el mismo orden.
  aInsertar.sort(
    (a, b) =>
      a.fechaHora.getTime() - b.fechaHora.getTime() ||
      a.idempotencyKey.localeCompare(b.idempotencyKey)
  );

  return { aInsertar, duplicados, invalidos };
}

function leerEvento(
  crudo: unknown
): { ok: true; evento: EventoAcceso } | { ok: false; motivo: string } {
  if (!crudo || typeof crudo !== "object") return { ok: false, motivo: "no es un objeto" };
  const o = crudo as Record<string, unknown>;

  const clave = o.idempotencyKey;
  if (typeof clave !== "string" || !clave.trim()) {
    return { ok: false, motivo: "sin idempotencyKey" };
  }
  if (clave.length > 200) return { ok: false, motivo: "idempotencyKey demasiado larga" };

  if (typeof o.dispositivoId !== "string" || !o.dispositivoId) {
    return { ok: false, motivo: "sin dispositivoId" };
  }
  if (o.sentido !== "ingreso" && o.sentido !== "egreso") {
    return { ok: false, motivo: "sentido invalido" };
  }

  const fecha = new Date(o.fechaHora as string | number | Date);
  if (Number.isNaN(fecha.getTime())) return { ok: false, motivo: "fechaHora invalida" };

  return {
    ok: true,
    evento: {
      idempotencyKey: clave,
      dispositivoId: o.dispositivoId,
      socioId: typeof o.socioId === "string" && o.socioId ? o.socioId : null,
      sentido: o.sentido,
      fechaHora: fecha,
      permitido: o.permitido === true,
      motivo: typeof o.motivo === "string" ? (o.motivo as MotivoRechazo) : undefined,
      offline: o.offline === true,
    },
  };
}

/**
 * El aforo después de aplicar una lista de movimientos, en orden.
 *
 * No baja de cero: una salida sin su entrada —alguien que ya estaba adentro
 * cuando se prendió el sistema, o un lector que se perdió el ingreso— dejaría
 * el contador en negativo, y a partir de ahí el aforo miente para siempre.
 */
export function aforoLuegoDe(inicial: number, movimientos: readonly EventoAcceso[]): number {
  let n = Math.max(0, inicial);
  for (const m of movimientos) {
    if (!m.permitido) continue;
    n = m.sentido === "ingreso" ? n + 1 : Math.max(0, n - 1);
  }
  return n;
}

/**
 * El padrón que se le manda a un dispositivo para que decida sin red.
 *
 * Va deliberadamente flaco: lo mínimo para decidir, sin domicilios, teléfonos
 * ni deudas. Un lector se roba, y con él se roba lo que tenga adentro.
 */
export type FilaPadron = {
  socioId: string;
  categoriaId: string;
  estado: SocioParaAcceso["estado"];
  alDia: boolean;
  carnetVersion: number;
  aptoMedicoHasta?: string | null;
};

export function armarPadron(
  socios: readonly (SocioParaAcceso & { carnetVersion: number })[]
): FilaPadron[] {
  return socios.map((s) => ({
    socioId: s.id,
    categoriaId: s.categoriaId,
    estado: s.estado,
    alDia: s.alDia,
    carnetVersion: s.carnetVersion,
    aptoMedicoHasta: s.aptoMedicoHasta ?? null,
  }));
}
