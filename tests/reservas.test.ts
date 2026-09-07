import { describe, it, expect } from "vitest";
import {
  generarTurnos,
  puedeReservar,
  proximoEnEspera,
  seSolapan,
  verificarSolapamiento,
  ocupaLugar,
  type Espacio,
  type FranjaGrilla,
  type Reserva,
  type SocioParaReserva,
} from "../src/index.ts";

const cancha: Espacio = { id: "cancha1", duracionMinutos: 60, precio: 500000 };

/** Miercoles de 08:00 a 22:00. */
const GRILLA: FranjaGrilla[] = [{ dia: 3, desde: "08:00", hasta: "22:00" }];
const MIERCOLES = "2026-09-09";
const ZONA = "America/Argentina/Buenos_Aires";

const socio = (over: Partial<SocioParaReserva> = {}): SocioParaReserva => ({
  id: "soc1",
  categoriaId: "activo",
  alDia: true,
  ...over,
});

const reserva = (over: Partial<Reserva> & Pick<Reserva, "id" | "inicio" | "fin">): Reserva => ({
  espacioId: "cancha1",
  socioId: "otro",
  estado: "confirmada",
  ...over,
});

/** Un instante del miercoles a la hora de pared argentina indicada. */
const alAs = (hhmm: string) => new Date(`${MIERCOLES}T${hhmm}:00-03:00`);

describe("generarTurnos", () => {
  it("parte la franja en bloques de la duracion del espacio", () => {
    const t = generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: GRILLA });
    expect(t).toHaveLength(14); // 08:00 a 22:00, de a una hora
    expect(t[0]!.inicio.toISOString()).toBe("2026-09-09T11:00:00.000Z"); // 08:00 AR
    expect(t.at(-1)!.inicio.toISOString()).toBe("2026-09-10T00:00:00.000Z"); // 21:00 AR
  });

  it("el borde superior es exclusivo: no hay turno que arranque a las 22", () => {
    const t = generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: GRILLA });
    expect(t.at(-1)!.fin.toISOString()).toBe("2026-09-10T01:00:00.000Z"); // 22:00 AR
  });

  it("un turno que no entra entero en la franja no se genera", () => {
    const larga: Espacio = { ...cancha, duracionMinutos: 90 };
    const t = generarTurnos({ espacio: larga, diaISO: MIERCOLES, franjas: GRILLA });
    // 14 horas / 1.5 = 9 turnos enteros, sobra media hora que no se ofrece.
    expect(t).toHaveLength(9);
  });

  it("otro dia de la semana no tiene turnos", () => {
    expect(generarTurnos({ espacio: cancha, diaISO: "2026-09-10", franjas: GRILLA })).toHaveLength(0);
  });

  it("un espacio inactivo no ofrece nada", () => {
    const t = generarTurnos({ espacio: { ...cancha, activo: false }, diaISO: MIERCOLES, franjas: GRILLA });
    expect(t).toHaveLength(0);
  });

  it("una duracion invalida no cuelga el generador", () => {
    for (const d of [0, -60, NaN, Infinity]) {
      expect(generarTurnos({ espacio: { ...cancha, duracionMinutos: d }, diaISO: MIERCOLES, franjas: GRILLA })).toHaveLength(0);
    }
  });

  it("dos franjas que se pisan no duplican turnos", () => {
    const pisadas: FranjaGrilla[] = [
      { dia: 3, desde: "08:00", hasta: "12:00" },
      { dia: 3, desde: "10:00", hasta: "14:00" },
    ];
    const t = generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: pisadas });
    expect(t).toHaveLength(6); // 08 a 14, sin repetir 10 y 11
    expect(new Set(t.map((x) => x.inicio.getTime())).size).toBe(t.length);
  });

  it("una franja al reves se ignora", () => {
    const rota: FranjaGrilla[] = [{ dia: 3, desde: "22:00", hasta: "08:00" }];
    expect(generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: rota })).toHaveLength(0);
  });

  it("un horario mal escrito se ignora sin reventar", () => {
    const rota: FranjaGrilla[] = [{ dia: 3, desde: "ocho", hasta: "22:00" }];
    expect(generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: rota })).toHaveLength(0);
  });

  it("los turnos salen ordenados por hora", () => {
    const desordenadas: FranjaGrilla[] = [
      { dia: 3, desde: "18:00", hasta: "20:00" },
      { dia: 3, desde: "08:00", hasta: "10:00" },
    ];
    const t = generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: desordenadas });
    expect(t.map((x) => x.inicio.getTime())).toEqual([...t.map((x) => x.inicio.getTime())].sort((a, b) => a - b));
  });
});

describe("estado de los turnos", () => {
  it("una reserva confirmada lo deja ocupado", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00") })],
    });
    expect(t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!.estado).toBe("ocupado");
    expect(t.find((x) => x.inicio.getTime() === alAs("11:00").getTime())!.estado).toBe("libre");
  });

  it("una reserva cancelada NO ocupa", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "cancelada" })],
    });
    expect(t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!.estado).toBe("libre");
  });

  it("mi propia reserva sale como 'propio', no como 'ocupado'", () => {
    // "No hay lugar" cuando el lugar es tuyo hace pensar que se perdio la reserva.
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [reserva({ id: "r1", socioId: "soc1", inicio: alAs("10:00"), fin: alAs("11:00") })],
      socioId: "soc1",
    });
    expect(t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!.estado).toBe("propio");
  });

  it("un bloqueo tapa el turno y dice por que", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      bloqueos: [{ desde: alAs("14:00"), hasta: alAs("18:00"), motivo: "Torneo interno" }],
    });
    const bloqueados = t.filter((x) => x.estado === "bloqueado");
    expect(bloqueados).toHaveLength(4);
    expect(bloqueados[0]!.motivoBloqueo).toBe("Torneo interno");
  });

  it("un turno que ya ARRANCÓ sale como 'pasado', no como libre", () => {
    /**
     * Este test afirmaba lo contrario y estaba mal.
     *
     * Decía que a las 15:30 el turno de 15:00 a 16:00 seguía "libre", porque la
     * grilla usaba `fin <= ahora`. Pero `puedeReservar` usa `inicio <= ahora` y
     * lo rechaza con `turno_pasado`. Eran dos reglas para la misma pregunta, y
     * la diferencia era **toda la hora en curso**: la pantalla mostraba un botón
     * "Libre" que al apretarlo contestaba "Ese turno ya pasó".
     *
     * La regla de la acción es la correcta: nadie reserva una cancha que ya está
     * en uso.
     */
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      ahora: alAs("15:30"),
    });
    // De 08 a 15 inclusive: el de 15:00 ya arrancó.
    expect(t.filter((x) => x.estado === "pasado")).toHaveLength(8);
    expect(t.find((x) => x.inicio.getTime() === alAs("15:00").getTime())!.estado).toBe("pasado");
    expect(t.find((x) => x.inicio.getTime() === alAs("16:00").getTime())!.estado).toBe("libre");
  });

  it("la grilla y la acción coinciden en qué turno ya pasó", () => {
    // Es el test que impide que las dos reglas vuelvan a separarse: recorre la
    // grilla entera y le pregunta a la acción por cada turno.
    const ahora = alAs("15:30");
    const t = generarTurnos({ espacio: cancha, diaISO: MIERCOLES, franjas: GRILLA, ahora });

    for (const turno of t) {
      const r = puedeReservar({
        socio: socio(),
        espacio: cancha,
        inicio: turno.inicio,
        fin: turno.fin,
        reglas: {},
        reservasDelTurno: [],
        reservasDelSocio: [],
        bloqueos: [],
        ahora,
        zona: ZONA,
        enGrilla: true,
      });
      const laAccionDiceQuePaso = !r.puede && r.motivo === "turno_pasado";
      expect(
        laAccionDiceQuePaso,
        `la grilla dice "${turno.estado}" para ${turno.inicio.toISOString()} y la acción dice ` +
          `${r.puede ? "que se puede" : r.motivo}`
      ).toBe(turno.estado === "pasado");
    }
  });

  it("con cupo, informa cuantos lugares quedan", () => {
    const clase: Espacio = { id: "cancha1", duracionMinutos: 60, cupo: 3 };
    const t = generarTurnos({
      espacio: clase,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [
        reserva({ id: "r1", socioId: "a", inicio: alAs("10:00"), fin: alAs("11:00") }),
        reserva({ id: "r2", socioId: "b", inicio: alAs("10:00"), fin: alAs("11:00") }),
      ],
    });
    const turno = t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!;
    expect(turno.lugares).toBe(1);
    expect(turno.estado).toBe("libre");
  });

  it("cuenta la lista de espera", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [
        reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00") }),
        reserva({ id: "r2", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "lista_espera" }),
        reserva({ id: "r3", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "lista_espera" }),
      ],
    });
    expect(t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!.enEspera).toBe(2);
  });

  it("las reservas de OTRO espacio no ocupan esta cancha", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: GRILLA,
      reservas: [reserva({ id: "r1", espacioId: "cancha2", inicio: alAs("10:00"), fin: alAs("11:00") })],
    });
    expect(t.find((x) => x.inicio.getTime() === alAs("10:00").getTime())!.estado).toBe("libre");
  });
});

describe("seSolapan: los bordes NO se pisan", () => {
  it("consecutivos no se solapan", () => {
    // Con <= en vez de <, la cancha queda ocupada todo el dia desde la primera.
    expect(seSolapan(alAs("09:00"), alAs("10:00"), alAs("10:00"), alAs("11:00"))).toBe(false);
  });
  it("pisados si", () => {
    expect(seSolapan(alAs("09:00"), alAs("11:00"), alAs("10:00"), alAs("12:00"))).toBe(true);
  });
  it("uno adentro del otro", () => {
    expect(seSolapan(alAs("09:00"), alAs("12:00"), alAs("10:00"), alAs("11:00"))).toBe(true);
    expect(seSolapan(alAs("10:00"), alAs("11:00"), alAs("09:00"), alAs("12:00"))).toBe(true);
  });
  it("identicos", () => {
    expect(seSolapan(alAs("09:00"), alAs("10:00"), alAs("09:00"), alAs("10:00"))).toBe(true);
  });
  it("separados", () => {
    expect(seSolapan(alAs("09:00"), alAs("10:00"), alAs("14:00"), alAs("15:00"))).toBe(false);
  });
});

describe("verificarSolapamiento: el chequeo que corre la accion", () => {
  it("libre cuando no hay nadie", () => {
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), [])).toEqual({ libre: true, ocupadas: 0 });
  });
  it("ocupado cuando hay una confirmada", () => {
    const r = [reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00") })];
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), r).libre).toBe(false);
  });
  it("una cancelada no ocupa", () => {
    const r = [reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "cancelada" })];
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), r).libre).toBe(true);
  });
  it("una ausente tampoco: el lugar se libero", () => {
    const r = [reserva({ id: "r1", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "ausente" })];
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), r).libre).toBe(true);
  });
  it("con cupo, hay lugar hasta llenarlo", () => {
    const r = [
      reserva({ id: "r1", socioId: "a", inicio: alAs("10:00"), fin: alAs("11:00") }),
      reserva({ id: "r2", socioId: "b", inicio: alAs("10:00"), fin: alAs("11:00") }),
    ];
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), r, 3).libre).toBe(true);
    expect(verificarSolapamiento(alAs("10:00"), alAs("11:00"), r, 2).libre).toBe(false);
  });
});

describe("ocupaLugar", () => {
  it("confirmada y asistio ocupan", () => {
    expect(ocupaLugar(reserva({ id: "a", inicio: alAs("10:00"), fin: alAs("11:00") }))).toBe(true);
    expect(ocupaLugar(reserva({ id: "a", inicio: alAs("10:00"), fin: alAs("11:00"), estado: "asistio" }))).toBe(true);
  });
  it("cancelada, ausente y lista de espera no", () => {
    for (const estado of ["cancelada", "ausente", "lista_espera"] as const) {
      expect(ocupaLugar(reserva({ id: "a", inicio: alAs("10:00"), fin: alAs("11:00"), estado }))).toBe(false);
    }
  });
});

describe("puedeReservar", () => {
  const AHORA = alAs("09:00");
  const base = { espacio: cancha, inicio: alAs("15:00"), fin: alAs("16:00"), ahora: AHORA };

  it("el caso feliz devuelve el precio", () => {
    const r = puedeReservar({ ...base, socio: socio() });
    expect(r).toEqual({ puede: true, precio: 500000, entraEnEspera: false });
  });

  it("un turno pasado no se reserva", () => {
    const r = puedeReservar({ ...base, socio: socio(), inicio: alAs("08:00"), fin: alAs("09:00") });
    expect(r).toEqual({ puede: false, motivo: "turno_pasado" });
  });

  it("un espacio inactivo tampoco", () => {
    const r = puedeReservar({ ...base, espacio: { ...cancha, activo: false }, socio: socio() });
    expect(r).toEqual({ puede: false, motivo: "espacio_inactivo" });
  });

  it("un turno fuera de la grilla tampoco", () => {
    const r = puedeReservar({ ...base, socio: socio(), enGrilla: false });
    expect(r).toEqual({ puede: false, motivo: "fuera_de_grilla" });
  });

  it("un bloqueo lo impide", () => {
    const r = puedeReservar({
      ...base,
      socio: socio(),
      bloqueos: [{ desde: alAs("14:00"), hasta: alAs("18:00") }],
    });
    expect(r).toEqual({ puede: false, motivo: "bloqueado" });
  });

  it("cuota impaga cuando el club lo exige", () => {
    const r = puedeReservar({ ...base, socio: socio({ alDia: false }), reglas: { exigeCuotaAlDia: true } });
    expect(r).toEqual({ puede: false, motivo: "cuota_impaga" });
  });

  it("pero no cuando no lo exige", () => {
    expect(puedeReservar({ ...base, socio: socio({ alDia: false }) }).puede).toBe(true);
  });

  it("categoria sin acceso", () => {
    const r = puedeReservar({
      ...base,
      socio: socio({ categoriaId: "cadete" }),
      reglas: { categoriasPermitidas: ["activo"] },
    });
    expect(r).toEqual({ puede: false, motivo: "categoria_sin_acceso" });
  });

  it("una lista de categorias vacia no filtra a nadie", () => {
    const r = puedeReservar({ ...base, socio: socio({ categoriaId: "cadete" }), reglas: { categoriasPermitidas: [] } });
    expect(r.puede).toBe(true);
  });

  it("no se reserva con mas anticipacion de la permitida", () => {
    const dentroDeUnMes = new Date(alAs("15:00").getTime() + 30 * 86_400_000);
    const r = puedeReservar({
      ...base,
      socio: socio(),
      inicio: dentroDeUnMes,
      fin: new Date(dentroDeUnMes.getTime() + 3_600_000),
      reglas: { anticipacionMaximaDias: 7 },
    });
    expect(r).toEqual({ puede: false, motivo: "demasiada_anticipacion" });
  });

  it("el ultimo dia permitido si entra", () => {
    const enSieteDias = new Date(alAs("15:00").getTime() + 7 * 86_400_000);
    const r = puedeReservar({
      ...base,
      socio: socio(),
      inicio: enSieteDias,
      fin: new Date(enSieteDias.getTime() + 3_600_000),
      reglas: { anticipacionMaximaDias: 7 },
    });
    expect(r.puede).toBe(true);
  });

  it("no se reserva demasiado sobre la hora", () => {
    const r = puedeReservar({
      ...base,
      socio: socio(),
      inicio: alAs("09:10"),
      fin: alAs("10:10"),
      reglas: { anticipacionMinimaMinutos: 30 },
    });
    expect(r).toEqual({ puede: false, motivo: "muy_sobre_la_hora" });
  });

  it("tope de reservas simultaneas", () => {
    const propias = [
      reserva({ id: "p1", socioId: "soc1", espacioId: "otra", inicio: alAs("18:00"), fin: alAs("19:00") }),
      reserva({ id: "p2", socioId: "soc1", espacioId: "otra", inicio: alAs("20:00"), fin: alAs("21:00") }),
    ];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: propias, reglas: { topeSimultaneas: 2 } });
    expect(r).toEqual({ puede: false, motivo: "tope_simultaneas" });
  });

  it("las reservas pasadas no cuentan para el tope", () => {
    const vieja = [reserva({ id: "p1", socioId: "soc1", inicio: alAs("07:00"), fin: alAs("08:00") })];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: vieja, reglas: { topeSimultaneas: 1 } });
    expect(r.puede).toBe(true);
  });

  it("las canceladas tampoco", () => {
    const cancelada = [
      reserva({ id: "p1", socioId: "soc1", inicio: alAs("18:00"), fin: alAs("19:00"), estado: "cancelada" }),
    ];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: cancelada, reglas: { topeSimultaneas: 1 } });
    expect(r.puede).toBe(true);
  });

  it("ni las de OTRO socio", () => {
    const deOtro = [reserva({ id: "p1", socioId: "otro", inicio: alAs("18:00"), fin: alAs("19:00") })];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: deOtro, reglas: { topeSimultaneas: 1 } });
    expect(r.puede).toBe(true);
  });

  it("pisarse con una propia da un mensaje accionable, no 'llegaste al tope'", () => {
    const propia = [reserva({ id: "p1", socioId: "soc1", espacioId: "otra", inicio: alAs("15:00"), fin: alAs("16:00") })];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: propia, reglas: { topeSimultaneas: 1 } });
    expect(r).toEqual({ puede: false, motivo: "se_pisa_con_otra_propia" });
  });

  it("tope semanal", () => {
    const tres = [1, 2, 3].map((n) =>
      reserva({
        id: `p${n}`,
        socioId: "soc1",
        espacioId: "otra",
        inicio: new Date(alAs("15:00").getTime() + n * 86_400_000),
        fin: new Date(alAs("16:00").getTime() + n * 86_400_000),
      })
    );
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: tres, reglas: { topeSemanal: 3 } });
    expect(r).toEqual({ puede: false, motivo: "tope_semanal" });
  });

  it("una reserva de dentro de un mes no cuenta para el tope SEMANAL", () => {
    const lejana = [
      reserva({
        id: "p1",
        socioId: "soc1",
        espacioId: "otra",
        inicio: new Date(alAs("15:00").getTime() + 30 * 86_400_000),
        fin: new Date(alAs("16:00").getTime() + 30 * 86_400_000),
      }),
    ];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelSocio: lejana, reglas: { topeSemanal: 1 } });
    expect(r.puede).toBe(true);
  });

  it("un no socio no reserva salvo que el club lo admita", () => {
    expect(puedeReservar({ ...base, socio: socio({ esSocio: false }) })).toEqual({
      puede: false,
      motivo: "no_es_socio",
    });
    const r = puedeReservar({ ...base, socio: socio({ esSocio: false }), reglas: { admiteNoSocios: true } });
    expect(r.puede).toBe(true);
  });

  it("el no socio paga su propio precio", () => {
    const conPrecioNoSocio: Espacio = { ...cancha, precioNoSocio: 900000 };
    const r = puedeReservar({
      ...base,
      espacio: conPrecioNoSocio,
      socio: socio({ esSocio: false }),
      reglas: { admiteNoSocios: true },
    });
    expect(r).toMatchObject({ puede: true, precio: 900000 });
  });

  it("sin precio de no socio, paga el de siempre", () => {
    const r = puedeReservar({ ...base, socio: socio({ esSocio: false }), reglas: { admiteNoSocios: true } });
    expect(r).toMatchObject({ precio: 500000 });
  });
});

describe("lista de espera", () => {
  const AHORA = alAs("09:00");
  const base = { espacio: cancha, inicio: alAs("15:00"), fin: alAs("16:00"), ahora: AHORA };

  it("un turno lleno NO devuelve false: manda a la lista de espera", () => {
    const lleno = [reserva({ id: "r1", inicio: alAs("15:00"), fin: alAs("16:00") })];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelTurno: lleno });
    expect(r).toEqual({ puede: true, precio: 500000, entraEnEspera: true, posicion: 1 });
  });

  it("la posicion cuenta a los que ya estaban esperando", () => {
    const lleno = [
      reserva({ id: "r1", inicio: alAs("15:00"), fin: alAs("16:00") }),
      reserva({ id: "r2", inicio: alAs("15:00"), fin: alAs("16:00"), estado: "lista_espera" }),
    ];
    const r = puedeReservar({ ...base, socio: socio(), reservasDelTurno: lleno });
    expect(r).toMatchObject({ entraEnEspera: true, posicion: 2 });
  });

  it("pero una regla que no se cumple gana sobre la lista de espera", () => {
    const lleno = [reserva({ id: "r1", inicio: alAs("15:00"), fin: alAs("16:00") })];
    const r = puedeReservar({
      ...base,
      socio: socio({ alDia: false }),
      reservasDelTurno: lleno,
      reglas: { exigeCuotaAlDia: true },
    });
    expect(r).toEqual({ puede: false, motivo: "cuota_impaga" });
  });
});

describe("proximoEnEspera", () => {
  const enEspera = (id: string, posicion: number | null) =>
    reserva({ id, inicio: alAs("15:00"), fin: alAs("16:00"), estado: "lista_espera", posicionEspera: posicion });

  it("nadie esperando, nadie asciende", () => {
    expect(proximoEnEspera([])).toBeNull();
  });

  it("asciende el primero de la fila", () => {
    const r = proximoEnEspera([enEspera("b", 2), enEspera("a", 1)]);
    expect(r!.id).toBe("a");
  });

  it("promueve UNA sola aunque se liberen varios lugares", () => {
    const r = proximoEnEspera([enEspera("a", 1), enEspera("b", 2)], 3);
    expect(r!.id).toBe("a");
  });

  it("no asciende nadie si el turno sigue lleno", () => {
    const lleno = [reserva({ id: "r1", inicio: alAs("15:00"), fin: alAs("16:00") }), enEspera("a", 1)];
    expect(proximoEnEspera(lleno, 1)).toBeNull();
  });

  it("con cupo, asciende mientras haya lugar", () => {
    const dosConfirmadas = [
      reserva({ id: "r1", socioId: "x", inicio: alAs("15:00"), fin: alAs("16:00") }),
      reserva({ id: "r2", socioId: "y", inicio: alAs("15:00"), fin: alAs("16:00") }),
      enEspera("a", 1),
    ];
    expect(proximoEnEspera(dosConfirmadas, 3)!.id).toBe("a");
    expect(proximoEnEspera(dosConfirmadas, 2)).toBeNull();
  });

  it("sin posicion, el orden no depende de como vino la consulta", () => {
    expect(proximoEnEspera([enEspera("zzz", null), enEspera("aaa", null)])!.id).toBe("aaa");
    expect(proximoEnEspera([enEspera("aaa", null), enEspera("zzz", null)])!.id).toBe("aaa");
  });

  it("una cancelada no asciende", () => {
    const r = proximoEnEspera([
      reserva({ id: "c", inicio: alAs("15:00"), fin: alAs("16:00"), estado: "cancelada" }),
    ]);
    expect(r).toBeNull();
  });
});

describe("horario de verano y husos raros", () => {
  it("los turnos salen a la hora de PARED, no a un offset fijo", () => {
    const enero = generarTurnos({
      espacio: cancha,
      diaISO: "2026-01-14",
      franjas: [{ dia: 3, desde: "10:00", hasta: "11:00" }],
      zona: "America/Santiago",
    });
    const julio = generarTurnos({
      espacio: cancha,
      diaISO: "2026-07-15",
      franjas: [{ dia: 3, desde: "10:00", hasta: "11:00" }],
      zona: "America/Santiago",
    });
    // Santiago cambia de huso entre enero y julio: la misma hora de pared cae
    // en una hora UTC distinta.
    expect(enero[0]!.inicio.getUTCHours()).not.toBe(julio[0]!.inicio.getUTCHours());
  });

  it("funciona con un huso de media hora", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: [{ dia: 3, desde: "10:00", hasta: "11:00" }],
      zona: "Asia/Kolkata",
    });
    expect(t[0]!.inicio.toISOString()).toBe("2026-09-09T04:30:00.000Z");
  });

  it("en UTC la hora de pared es la hora UTC", () => {
    const t = generarTurnos({
      espacio: cancha,
      diaISO: MIERCOLES,
      franjas: [{ dia: 3, desde: "10:00", hasta: "11:00" }],
      zona: "UTC",
    });
    expect(t[0]!.inicio.toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });
});
