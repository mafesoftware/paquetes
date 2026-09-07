/**
 * Motor de reservas: qué turnos hay, quién puede tomarlos y qué pasa cuando
 * alguien cancela.
 *
 * Puro. Recibe la grilla, los bloqueos y las reservas existentes, y devuelve
 * los turnos con su estado. No sabe de base ni de husos más allá de la zona
 * que le pasan.
 *
 * ## La regla que decide todo: el turno es una GRILLA, no un rango libre
 *
 * Una cancha se reserva en bloques de 60 o 90 minutos que arrancan en horas
 * fijas. Dejar elegir el minuto de arranque parece más flexible y es peor: la
 * cancha queda picada en huecos de 20 minutos que no le sirven a nadie, y la
 * pantalla de disponibilidad deja de poder dibujarse.
 *
 * ## El solapamiento se chequea SIEMPRE contra la base, no contra la grilla
 *
 * Que un turno se vea libre en la pantalla no quiere decir que lo esté cuando
 * el botón llega al servidor. Dos personas que abren la app a la misma hora
 * ven lo mismo. Por eso `verificarSolapamiento` existe aparte de
 * `generarTurnos`: la pantalla usa la grilla, la acción usa el chequeo, y el
 * candado de verdad es un índice único en la base.
 */

import {
  aMinutos,
  deMinutos,
  diaEnZona,
  diasEntre,
  instanteEnZona,
  ZONA_AR,
} from "@mafesoftware/fechas-ar";
import type { Centavos } from "@mafesoftware/plata-ar";

export type { Centavos };

/** Un espacio reservable: una cancha, un salón, una calle de pileta. */
export type Espacio = {
  id: string;
  /** Cuánto dura un turno, en minutos. Define la grilla. */
  duracionMinutos: number;
  /** Cuántas reservas simultáneas admite. 1 para una cancha; N para una clase. */
  cupo?: number;
  /** Precio del turno. `0` para lo que está incluido en la cuota. */
  precio?: Centavos;
  /** Precio para quien no es socio, si el club los admite. */
  precioNoSocio?: Centavos | null;
  activo?: boolean;
};

/** Una franja de la grilla semanal. `dia` 0 = domingo. */
export type FranjaGrilla = {
  dia: number;
  /** `"08:00"`. */
  desde: string;
  /** `"22:00"`. Exclusivo: un turno que arranca acá no existe. */
  hasta: string;
};

/** Un corte puntual: mantenimiento, un torneo, un feriado. */
export type Bloqueo = { desde: Date; hasta: Date; motivo?: string };

export type EstadoReserva = "confirmada" | "lista_espera" | "cancelada" | "asistio" | "ausente";

export type Reserva = {
  id: string;
  espacioId: string;
  socioId: string;
  inicio: Date;
  fin: Date;
  estado: EstadoReserva;
  /** Orden de llegada a la lista de espera. Menor entra primero. */
  posicionEspera?: number | null;
};

/** Una reserva que ocupa lugar. Cancelada y ausente no ocupan. */
export function ocupaLugar(r: Reserva): boolean {
  return r.estado === "confirmada" || r.estado === "asistio";
}

export type EstadoTurno = "libre" | "ocupado" | "bloqueado" | "pasado" | "propio";

export type Turno = {
  inicio: Date;
  fin: Date;
  estado: EstadoTurno;
  /** Cuántos lugares quedan. Para un espacio con cupo > 1. */
  lugares: number;
  /** Cuántos hay anotados en la lista de espera. */
  enEspera: number;
  motivoBloqueo?: string;
};

/**
 * Los turnos de un espacio para un día.
 *
 * `socioId` es opcional y solo cambia el ESTADO que se muestra: un turno que
 * tomó quien está mirando sale como `"propio"` en vez de `"ocupado"`, porque
 * "no hay lugar" cuando el lugar es tuyo es un mensaje que hace pensar que se
 * perdió la reserva.
 */
export function generarTurnos(opciones: {
  espacio: Espacio;
  /** `"2026-09-09"`. */
  diaISO: string;
  franjas: readonly FranjaGrilla[];
  bloqueos?: readonly Bloqueo[];
  reservas?: readonly Reserva[];
  zona?: string;
  ahora?: Date;
  socioId?: string;
}): Turno[] {
  const {
    espacio,
    diaISO,
    franjas,
    bloqueos = [],
    reservas = [],
    zona = ZONA_AR,
    ahora,
    socioId,
  } = opciones;

  if (espacio.activo === false) return [];
  if (!Number.isFinite(espacio.duracionMinutos) || espacio.duracionMinutos <= 0) return [];

  const cupo = Math.max(1, espacio.cupo ?? 1);
  const dia = new Date(`${diaISO}T00:00:00Z`).getUTCDay();
  const delDia = franjas.filter((f) => f.dia === dia);
  if (!delDia.length) return [];

  const propias = reservas.filter((r) => r.espacioId === espacio.id);
  const turnos: Turno[] = [];
  const yaGenerados = new Set<number>();

  for (const f of delDia) {
    const desde = aMinutos(f.desde);
    const hasta = aMinutos(f.hasta);
    if (desde === null || hasta === null || hasta <= desde) continue;

    for (let m = desde; m + espacio.duracionMinutos <= hasta; m += espacio.duracionMinutos) {
      // Dos franjas del mismo dia que se pisan generarian el mismo turno dos
      // veces, y la pantalla mostraria la cancha duplicada.
      if (yaGenerados.has(m)) continue;
      yaGenerados.add(m);

      const inicio = instanteEnZona(diaISO, deMinutos(m), zona);
      const fin = new Date(inicio.getTime() + espacio.duracionMinutos * 60_000);

      const bloqueo = bloqueos.find((b) => seSolapan(inicio, fin, b.desde, b.hasta));
      const enEsteTurno = propias.filter((r) => seSolapan(inicio, fin, r.inicio, r.fin));
      const confirmadas = enEsteTurno.filter(ocupaLugar);
      const enEspera = enEsteTurno.filter((r) => r.estado === "lista_espera").length;
      const esPropio = socioId ? confirmadas.some((r) => r.socioId === socioId) : false;
      const lugares = Math.max(0, cupo - confirmadas.length);

      let estado: EstadoTurno;
      if (esPropio) estado = "propio";
      else if (bloqueo) estado = "bloqueado";
      // Un turno que YA ARRANCÓ está pasado, aunque todavía no haya terminado.
      //
      // Acá decía `fin <= ahora`, y `puedeReservar` usa `inicio <= ahora`: dos
      // reglas para la misma pregunta. La diferencia era toda la hora en curso,
      // todos los días, en cada espacio — la grilla mostraba "Libre" y al
      // apretar contestaba "Ese turno ya pasó". La regla de la acción es la
      // correcta: nadie reserva una cancha que ya está en uso.
      else if (ahora && inicio <= ahora) estado = "pasado";
      else if (lugares <= 0) estado = "ocupado";
      else estado = "libre";

      turnos.push({
        inicio,
        fin,
        estado,
        lugares,
        enEspera,
        motivoBloqueo: bloqueo?.motivo,
      });
    }
  }

  turnos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return turnos;
}

/* ============================================================
   ¿PUEDE RESERVAR?
   ============================================================ */

export type MotivoNoPuede =
  | "espacio_inactivo"
  | "fuera_de_grilla"
  | "turno_pasado"
  | "bloqueado"
  | "sin_lugar"
  | "cuota_impaga"
  | "categoria_sin_acceso"
  | "demasiada_anticipacion"
  | "muy_sobre_la_hora"
  | "tope_simultaneas"
  | "tope_semanal"
  | "se_pisa_con_otra_propia"
  | "no_es_socio";

/** Las reglas del club. Todo lo que no se configura, no limita. */
export type ReglasReserva = {
  exigeCuotaAlDia?: boolean;
  categoriasPermitidas?: readonly string[];
  /** Cuántos días para adelante se puede reservar. */
  anticipacionMaximaDias?: number;
  /** Cuántos minutos antes hay que reservar, como mínimo. */
  anticipacionMinimaMinutos?: number;
  /** Cuántas reservas futuras puede tener a la vez un socio. */
  topeSimultaneas?: number;
  /** Cuántas puede tomar por semana corrida. */
  topeSemanal?: number;
  /** Si el club deja reservar a quien no es socio. */
  admiteNoSocios?: boolean;
};

export type SocioParaReserva = {
  id: string;
  categoriaId: string;
  alDia: boolean;
  esSocio?: boolean;
};

export type ResultadoReserva =
  | { puede: true; precio: Centavos; entraEnEspera: false }
  | { puede: true; precio: Centavos; entraEnEspera: true; posicion: number }
  | { puede: false; motivo: MotivoNoPuede };

/**
 * ¿Este socio puede tomar este turno?
 *
 * Cuando el turno está lleno pero todo lo demás da, no devuelve `false`:
 * devuelve que **entra en lista de espera**, con su posición. Es la diferencia
 * entre una cancha que se libera y se vuelve a ocupar sola y una que queda
 * vacía porque el que había cancelado era el único que sabía.
 */
export function puedeReservar(opciones: {
  socio: SocioParaReserva;
  espacio: Espacio;
  inicio: Date;
  fin: Date;
  reglas?: ReglasReserva;
  /** Todas las reservas del espacio que tocan este turno. */
  reservasDelTurno?: readonly Reserva[];
  /** Las reservas FUTURAS del socio, en cualquier espacio. Para los topes. */
  reservasDelSocio?: readonly Reserva[];
  bloqueos?: readonly Bloqueo[];
  ahora: Date;
  zona?: string;
  /** Si el turno pertenece a la grilla. Lo resuelve quien llama con `generarTurnos`. */
  enGrilla?: boolean;
}): ResultadoReserva {
  const {
    socio,
    espacio,
    inicio,
    fin,
    reglas = {},
    reservasDelTurno = [],
    reservasDelSocio = [],
    bloqueos = [],
    ahora,
  } = opciones;

  const precio = precioDe(espacio, socio);

  if (espacio.activo === false) return { puede: false, motivo: "espacio_inactivo" };
  if (opciones.enGrilla === false) return { puede: false, motivo: "fuera_de_grilla" };

  if (socio.esSocio === false && !reglas.admiteNoSocios) {
    return { puede: false, motivo: "no_es_socio" };
  }

  if (inicio <= ahora) return { puede: false, motivo: "turno_pasado" };

  if (bloqueos.some((b) => seSolapan(inicio, fin, b.desde, b.hasta))) {
    return { puede: false, motivo: "bloqueado" };
  }

  if (reglas.exigeCuotaAlDia && !socio.alDia) return { puede: false, motivo: "cuota_impaga" };

  if (reglas.categoriasPermitidas?.length && !reglas.categoriasPermitidas.includes(socio.categoriaId)) {
    return { puede: false, motivo: "categoria_sin_acceso" };
  }

  if (reglas.anticipacionMaximaDias != null) {
    const zona = opciones.zona ?? ZONA_AR;
    const dias = diasEntre(diaEnZona(ahora, zona), diaEnZona(inicio, zona));
    if (dias > reglas.anticipacionMaximaDias) {
      return { puede: false, motivo: "demasiada_anticipacion" };
    }
  }

  if (reglas.anticipacionMinimaMinutos != null) {
    const minutos = (inicio.getTime() - ahora.getTime()) / 60_000;
    if (minutos < reglas.anticipacionMinimaMinutos) {
      return { puede: false, motivo: "muy_sobre_la_hora" };
    }
  }

  const futurasDelSocio = reservasDelSocio.filter(
    (r) => r.socioId === socio.id && ocupaLugar(r) && r.fin > ahora
  );

  // Pisarse con una reserva propia va ANTES que el tope: el mensaje "ya tenes
  // una reserva a esa hora" es accionable y "llegaste al tope" no lo es.
  if (futurasDelSocio.some((r) => seSolapan(inicio, fin, r.inicio, r.fin))) {
    return { puede: false, motivo: "se_pisa_con_otra_propia" };
  }

  if (reglas.topeSimultaneas != null && futurasDelSocio.length >= reglas.topeSimultaneas) {
    return { puede: false, motivo: "tope_simultaneas" };
  }

  if (reglas.topeSemanal != null) {
    const enLaSemana = futurasDelSocio.filter(
      (r) => Math.abs(r.inicio.getTime() - inicio.getTime()) < 7 * 86_400_000
    );
    if (enLaSemana.length >= reglas.topeSemanal) return { puede: false, motivo: "tope_semanal" };
  }

  const cupo = Math.max(1, espacio.cupo ?? 1);
  const confirmadas = reservasDelTurno.filter(
    (r) => r.espacioId === espacio.id && ocupaLugar(r) && seSolapan(inicio, fin, r.inicio, r.fin)
  );

  if (confirmadas.length >= cupo) {
    const enEspera = reservasDelTurno.filter(
      (r) =>
        r.espacioId === espacio.id &&
        r.estado === "lista_espera" &&
        seSolapan(inicio, fin, r.inicio, r.fin)
    );
    return { puede: true, precio, entraEnEspera: true, posicion: enEspera.length + 1 };
  }

  return { puede: true, precio, entraEnEspera: false };
}

function precioDe(espacio: Espacio, socio: SocioParaReserva): Centavos {
  if (socio.esSocio === false && espacio.precioNoSocio != null) return espacio.precioNoSocio;
  return espacio.precio ?? 0;
}

/**
 * Quién asciende cuando alguien cancela.
 *
 * Devuelve la reserva a promover, o `null` si no hay nadie esperando. **Se
 * promueve UNA sola**, aunque se liberen varios lugares: cada cancelación se
 * procesa por separado para que el aviso que le llega a la persona diga
 * exactamente qué turno consiguió.
 *
 * El orden es el de llegada (`posicionEspera`); si dos empatan o vienen sin
 * posición, desempata el id, para que la promoción no dependa de cómo vino
 * ordenada la consulta.
 */
export function proximoEnEspera(
  reservasDelTurno: readonly Reserva[],
  cupo = 1
): Reserva | null {
  const confirmadas = reservasDelTurno.filter(ocupaLugar).length;
  if (confirmadas >= Math.max(1, cupo)) return null;

  const esperando = reservasDelTurno
    .filter((r) => r.estado === "lista_espera")
    .sort(
      (a, b) =>
        (a.posicionEspera ?? Number.MAX_SAFE_INTEGER) -
          (b.posicionEspera ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
    );

  return esperando[0] ?? null;
}

/**
 * ¿Se pisan dos rangos?
 *
 * Los bordes NO se pisan: un turno de 09:00 a 10:00 y otro de 10:00 a 11:00
 * son consecutivos, no simultáneos. Con `<=` en vez de `<`, una cancha se
 * declara ocupada todo el día a partir de la primera reserva.
 */
export function seSolapan(aDesde: Date, aHasta: Date, bDesde: Date, bHasta: Date): boolean {
  return aDesde < bHasta && bDesde < aHasta;
}

/**
 * El chequeo que corre la ACCIÓN, no la pantalla.
 *
 * Que un turno se vea libre no quiere decir que lo esté cuando el botón llega
 * al servidor.
 */
export function verificarSolapamiento(
  inicio: Date,
  fin: Date,
  existentes: readonly Reserva[],
  cupo = 1
): { libre: boolean; ocupadas: number } {
  const ocupadas = existentes.filter(
    (r) => ocupaLugar(r) && seSolapan(inicio, fin, r.inicio, r.fin)
  ).length;
  return { libre: ocupadas < Math.max(1, cupo), ocupadas };
}

/** El instante de `"2026-09-09"` a las `minutos` de pared, en `zona`. */
