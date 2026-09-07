import { describe, it, expect } from "vitest";
import {
  evaluarAcceso,
  dentroDeFranja,
  reconciliar,
  aforoLuegoDe,
  armarPadron,
  type SocioParaAcceso,
  type DispositivoParaAcceso,
  type EventoAcceso,
} from "../src/index.ts";

const socio = (over: Partial<SocioParaAcceso> = {}): SocioParaAcceso => ({
  id: "soc1",
  estado: "activo",
  categoriaId: "activo",
  alDia: true,
  ...over,
});

const molinete = (over: Partial<DispositivoParaAcceso> = {}): DispositivoParaAcceso => ({
  id: "mol1",
  activo: true,
  sentidos: ["ingreso", "egreso"],
  exigeCuotaAlDia: true,
  ...over,
});

// Miercoles 10:00 hora argentina.
const MIERCOLES_10 = new Date("2026-09-09T13:00:00Z");

describe("el caso feliz", () => {
  it("un socio activo y al dia entra", () => {
    const r = evaluarAcceso(socio(), molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r).toEqual({ permitido: true, mensaje: "Adelante", forzado: false });
  });
});

describe("estado del socio", () => {
  it("un carnet que no matchea ningun socio", () => {
    const r = evaluarAcceso(null, molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("socio_desconocido");
  });
  it("dado de baja", () => {
    const r = evaluarAcceso(socio({ estado: "baja" }), molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("socio_inactivo");
  });
  it("suspendido dice suspendido, no 'dado de baja'", () => {
    const r = evaluarAcceso(socio({ estado: "suspendido" }), molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("socio_suspendido");
  });
  it("cada motivo tiene su mensaje, corto", () => {
    const r = evaluarAcceso(socio({ alDia: false }), molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.mensaje).toBe("Cuota impaga");
    expect(r.mensaje.length).toBeLessThan(40);
  });
});

describe("cuota", () => {
  it("un moroso no entra donde se exige la cuota", () => {
    const r = evaluarAcceso(socio({ alDia: false }), molinete(), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("cuota_impaga");
  });
  it("pero si donde no se exige (la sede social, un acto)", () => {
    const abierto = molinete({ exigeCuotaAlDia: false });
    expect(evaluarAcceso(socio({ alDia: false }), abierto, "ingreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
});

describe("EGRESO: a nadie se lo encierra adentro", () => {
  it("un moroso puede salir", () => {
    const r = evaluarAcceso(socio({ alDia: false }), molinete(), "egreso", { ahora: MIERCOLES_10 });
    expect(r.permitido).toBe(true);
  });
  it("y alguien fuera de horario tambien", () => {
    const conHorario = molinete({ franjas: [{ dia: 3, desdeMinutos: 480, hastaMinutos: 540 }] });
    expect(evaluarAcceso(socio(), conHorario, "egreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
  it("y quien no tiene apto medico", () => {
    const pileta = molinete({ exigeAptoMedico: true });
    expect(evaluarAcceso(socio(), pileta, "egreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
  it("pero un socio dado de baja igual no sale por el molinete de socios", () => {
    const r = evaluarAcceso(socio({ estado: "baja" }), molinete(), "egreso", { ahora: MIERCOLES_10 });
    expect(r.permitido).toBe(false);
  });
  it("un lector de solo ingreso no registra salidas", () => {
    const soloEntrada = molinete({ sentidos: ["ingreso"] });
    const r = evaluarAcceso(socio(), soloEntrada, "egreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("sentido_no_permitido");
  });
});

describe("categorias", () => {
  it("una lista VACIA deja pasar a todos, no a ninguno", () => {
    // Si vacio significara "ninguna", guardar la config sin tildar nada
    // cerraria el club entero.
    const d = molinete({ categoriasPermitidas: [] });
    expect(evaluarAcceso(socio(), d, "ingreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
  it("una lista con categorias filtra", () => {
    const gimnasio = molinete({ categoriasPermitidas: ["activo", "vitalicio"] });
    expect(evaluarAcceso(socio({ categoriaId: "activo" }), gimnasio, "ingreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
    const r = evaluarAcceso(socio({ categoriaId: "cadete" }), gimnasio, "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("categoria_sin_acceso");
  });
});

describe("horarios", () => {
  const gimnasio = molinete({ franjas: [{ dia: 3, desdeMinutos: 8 * 60, hastaMinutos: 22 * 60 }] });

  it("adentro de la franja", () => {
    expect(evaluarAcceso(socio(), gimnasio, "ingreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
  it("afuera de la franja", () => {
    const madrugada = new Date("2026-09-09T06:00:00Z"); // 03:00 AR
    expect(evaluarAcceso(socio(), gimnasio, "ingreso", { ahora: madrugada }).motivo).toBe("fuera_de_horario");
  });
  it("otro dia de la semana", () => {
    const jueves = new Date("2026-09-10T13:00:00Z");
    expect(evaluarAcceso(socio(), gimnasio, "ingreso", { ahora: jueves }).motivo).toBe("fuera_de_horario");
  });
  it("sin franjas no hay restriccion", () => {
    const madrugada = new Date("2026-09-09T06:00:00Z");
    expect(evaluarAcceso(socio(), molinete(), "ingreso", { ahora: madrugada }).permitido).toBe(true);
  });
  it("el limite superior es exclusivo: a las 22:00 en punto ya cerro", () => {
    const alCierre = new Date("2026-09-10T01:00:00Z"); // 22:00 del miercoles AR
    expect(dentroDeFranja(gimnasio.franjas!, alCierre)).toBe(false);
  });
  it("el limite inferior es inclusivo: a las 08:00 en punto abre", () => {
    const alAbrir = new Date("2026-09-09T11:00:00Z");
    expect(dentroDeFranja(gimnasio.franjas!, alAbrir)).toBe(true);
  });
  it("una franja que cruza la medianoche deja seguir la fiesta", () => {
    // Salon de eventos, miercoles 22:00 a las 02:00 del jueves.
    const salon = [{ dia: 3, desdeMinutos: 22 * 60, hastaMinutos: 2 * 60 }];
    const aLas23 = new Date("2026-09-10T02:00:00Z"); // 23:00 miercoles AR
    const aLa1 = new Date("2026-09-10T04:00:00Z"); // 01:00 jueves AR
    const aLas3 = new Date("2026-09-10T06:00:00Z"); // 03:00 jueves AR
    expect(dentroDeFranja(salon, aLas23)).toBe(true);
    expect(dentroDeFranja(salon, aLa1)).toBe(true);
    expect(dentroDeFranja(salon, aLas3)).toBe(false);
  });
  it("los horarios son de PARED, no UTC", () => {
    const franja = [{ dia: 3, desdeMinutos: 8 * 60, hastaMinutos: 22 * 60 }];
    // 13:00 UTC = 10:00 AR (adentro) pero 13:00 en UTC tambien esta adentro;
    // el caso que separa es 01:00 UTC del jueves = 22:00 AR del miercoles.
    const borde = new Date("2026-09-10T01:30:00Z");
    expect(dentroDeFranja(franja, borde, "America/Argentina/Buenos_Aires")).toBe(false);
    expect(dentroDeFranja(franja, borde, "UTC")).toBe(false);
    const enUtcSi = new Date("2026-09-09T21:00:00Z");
    expect(dentroDeFranja(franja, enUtcSi, "UTC")).toBe(true);
  });
});

describe("apto medico", () => {
  const pileta = molinete({ exigeAptoMedico: true });
  it("vigente pasa", () => {
    const r = evaluarAcceso(socio({ aptoMedicoHasta: "2026-12-31" }), pileta, "ingreso", { ahora: MIERCOLES_10 });
    expect(r.permitido).toBe(true);
  });
  it("vencido no", () => {
    const r = evaluarAcceso(socio({ aptoMedicoHasta: "2026-01-01" }), pileta, "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("sin_apto_medico");
  });
  it("sin apto cargado tampoco", () => {
    const r = evaluarAcceso(socio({ aptoMedicoHasta: null }), pileta, "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("sin_apto_medico");
  });
  it("el que vence HOY todavia vale", () => {
    const r = evaluarAcceso(socio({ aptoMedicoHasta: "2026-09-09" }), pileta, "ingreso", { ahora: MIERCOLES_10 });
    expect(r.permitido).toBe(true);
  });
  it("donde no se exige, da igual", () => {
    expect(evaluarAcceso(socio({ aptoMedicoHasta: null }), molinete(), "ingreso", { ahora: MIERCOLES_10 }).permitido).toBe(true);
  });
});

describe("antipassback", () => {
  const conAntipassback = molinete({ antipassbackMinutos: 30 });

  it("frena el segundo ingreso seguido", () => {
    const r = evaluarAcceso(socio(), conAntipassback, "ingreso", {
      ahora: MIERCOLES_10,
      ultimoMovimiento: { sentido: "ingreso", fechaHora: new Date("2026-09-09T12:50:00Z") },
    });
    expect(r.motivo).toBe("antipassback");
  });
  it("pero deja pasar si ya salio", () => {
    const r = evaluarAcceso(socio(), conAntipassback, "ingreso", {
      ahora: MIERCOLES_10,
      ultimoMovimiento: { sentido: "egreso", fechaHora: new Date("2026-09-09T12:50:00Z") },
    });
    expect(r.permitido).toBe(true);
  });
  it("y despues de la ventana", () => {
    const r = evaluarAcceso(socio(), conAntipassback, "ingreso", {
      ahora: MIERCOLES_10,
      ultimoMovimiento: { sentido: "ingreso", fechaHora: new Date("2026-09-09T12:00:00Z") },
    });
    expect(r.permitido).toBe(true);
  });
  it("apagado por defecto", () => {
    const r = evaluarAcceso(socio(), molinete(), "ingreso", {
      ahora: MIERCOLES_10,
      ultimoMovimiento: { sentido: "ingreso", fechaHora: new Date("2026-09-09T12:59:00Z") },
    });
    expect(r.permitido).toBe(true);
  });
  it("un movimiento del FUTURO no frena a nadie", () => {
    // Un lector con la hora adelantada trabaria el club entero.
    const r = evaluarAcceso(socio(), conAntipassback, "ingreso", {
      ahora: MIERCOLES_10,
      ultimoMovimiento: { sentido: "ingreso", fechaHora: new Date("2026-09-09T20:00:00Z") },
    });
    expect(r.permitido).toBe(true);
  });
});

describe("aforo", () => {
  const pileta = molinete({ aforoMaximo: 50 });
  it("con lugar entra", () => {
    expect(evaluarAcceso(socio(), pileta, "ingreso", { ahora: MIERCOLES_10, aforoActual: 49 }).permitido).toBe(true);
  });
  it("completo no", () => {
    const r = evaluarAcceso(socio(), pileta, "ingreso", { ahora: MIERCOLES_10, aforoActual: 50 });
    expect(r.motivo).toBe("aforo_completo");
  });
  it("sin aforo configurado no limita", () => {
    expect(evaluarAcceso(socio(), molinete(), "ingreso", { ahora: MIERCOLES_10, aforoActual: 9999 }).permitido).toBe(true);
  });
  it("el aforo se chequea DESPUES de la cuota, para no tapar el motivo real", () => {
    const r = evaluarAcceso(socio({ alDia: false }), pileta, "ingreso", { ahora: MIERCOLES_10, aforoActual: 999 });
    expect(r.motivo).toBe("cuota_impaga");
  });
});

describe("dispositivo", () => {
  it("un lector apagado no deja pasar a nadie, ni al dia", () => {
    const r = evaluarAcceso(socio(), molinete({ activo: false }), "ingreso", { ahora: MIERCOLES_10 });
    expect(r.motivo).toBe("dispositivo_inactivo");
  });
});

describe("forzar: la puerta se abre y queda anotado", () => {
  it("deja pasar y guarda el motivo original", () => {
    const r = evaluarAcceso(socio({ alDia: false }), molinete(), "ingreso", {
      ahora: MIERCOLES_10,
      forzadoPor: "usr_portero",
    });
    expect(r.permitido).toBe(true);
    expect(r.forzado).toBe(true);
    expect(r.motivoOriginal).toBe("cuota_impaga");
  });
  it("un acceso que ya correspondia no queda marcado como forzado", () => {
    const r = evaluarAcceso(socio(), molinete(), "ingreso", {
      ahora: MIERCOLES_10,
      forzadoPor: "usr_portero",
    });
    expect(r.forzado).toBe(false);
  });
});

describe("reconciliar: un duplicado no es un error", () => {
  const evento = (over: Partial<EventoAcceso> & { idempotencyKey: string }) => ({
    dispositivoId: "mol1",
    socioId: "soc1",
    sentido: "ingreso" as const,
    fechaHora: new Date("2026-09-09T13:00:00Z"),
    permitido: true,
    ...over,
  });

  it("separa lo nuevo de lo ya registrado", () => {
    const r = reconciliar([evento({ idempotencyKey: "a" }), evento({ idempotencyKey: "b" })], new Set(["a"]));
    expect(r.aInsertar.map((e) => e.idempotencyKey)).toEqual(["b"]);
    expect(r.duplicados.map((e) => e.idempotencyKey)).toEqual(["a"]);
  });

  it("deduplica el lote contra SI MISMO", () => {
    // Un dispositivo que se reinicia a mitad de envio manda la misma clave dos veces.
    const r = reconciliar([evento({ idempotencyKey: "a" }), evento({ idempotencyKey: "a" })], new Set());
    expect(r.aInsertar).toHaveLength(1);
    expect(r.duplicados).toHaveLength(1);
  });

  it("ordena por cuando PASARON, no por como llegaron", () => {
    const r = reconciliar(
      [
        evento({ idempotencyKey: "tarde", fechaHora: new Date("2026-09-09T15:00:00Z") }),
        evento({ idempotencyKey: "temprano", fechaHora: new Date("2026-09-09T09:00:00Z") }),
      ],
      new Set()
    );
    expect(r.aInsertar.map((e) => e.idempotencyKey)).toEqual(["temprano", "tarde"]);
  });

  it("dos eventos del mismo instante quedan siempre en el mismo orden", () => {
    const mismos = [evento({ idempotencyKey: "zzz" }), evento({ idempotencyKey: "aaa" })];
    expect(reconciliar(mismos, new Set()).aInsertar.map((e) => e.idempotencyKey)).toEqual(["aaa", "zzz"]);
    expect(reconciliar([...mismos].reverse(), new Set()).aInsertar.map((e) => e.idempotencyKey)).toEqual(["aaa", "zzz"]);
  });

  it("descarta lo mal formado con nombre y apellido, sin tumbar el lote", () => {
    const r = reconciliar(
      [
        evento({ idempotencyKey: "buena" }),
        null,
        "hola",
        { idempotencyKey: "", dispositivoId: "m" },
        { idempotencyKey: "x", dispositivoId: "m", sentido: "volando", fechaHora: new Date() },
        { idempotencyKey: "y", dispositivoId: "m", sentido: "ingreso", fechaHora: "no es fecha" },
        { idempotencyKey: "z", sentido: "ingreso", fechaHora: new Date() },
      ],
      new Set()
    );
    expect(r.aInsertar.map((e) => e.idempotencyKey)).toEqual(["buena"]);
    expect(r.invalidos).toHaveLength(6);
    expect(r.invalidos.map((i) => i.motivo)).toContain("sentido invalido");
    expect(r.invalidos.map((i) => i.motivo)).toContain("sin dispositivoId");
  });

  it("rechaza una clave absurdamente larga", () => {
    const r = reconciliar([evento({ idempotencyKey: "x".repeat(500) })], new Set());
    expect(r.aInsertar).toHaveLength(0);
    expect(r.invalidos[0]!.motivo).toContain("larga");
  });

  it("un lote vacio no es un problema", () => {
    expect(reconciliar([], new Set())).toEqual({ aInsertar: [], duplicados: [], invalidos: [] });
  });

  it("conserva el motivo del rechazo que decidio el dispositivo offline", () => {
    const r = reconciliar(
      [evento({ idempotencyKey: "a", permitido: false, motivo: "cuota_impaga", offline: true })],
      new Set()
    );
    expect(r.aInsertar[0]).toMatchObject({ permitido: false, motivo: "cuota_impaga", offline: true });
  });

  it("acepta un socioId nulo: alguien escaneo un carnet que no reconocio", () => {
    const r = reconciliar([evento({ idempotencyKey: "a", socioId: null, permitido: false })], new Set());
    expect(r.aInsertar[0]!.socioId).toBeNull();
  });
});

describe("aforoLuegoDe", () => {
  const ev = (sentido: "ingreso" | "egreso", permitido = true): EventoAcceso => ({
    idempotencyKey: Math.random().toString(),
    dispositivoId: "m",
    socioId: "s",
    sentido,
    fechaHora: new Date(),
    permitido,
  });

  it("suma ingresos y resta egresos", () => {
    expect(aforoLuegoDe(10, [ev("ingreso"), ev("ingreso"), ev("egreso")])).toBe(11);
  });
  it("los rechazados no cuentan", () => {
    expect(aforoLuegoDe(10, [ev("ingreso", false)])).toBe(10);
  });
  it("NUNCA baja de cero", () => {
    // Una salida sin su entrada dejaria el contador negativo y a partir de ahi
    // el aforo miente para siempre.
    expect(aforoLuegoDe(0, [ev("egreso"), ev("egreso")])).toBe(0);
    expect(aforoLuegoDe(1, [ev("egreso"), ev("egreso"), ev("ingreso")])).toBe(1);
  });
  it("un inicial negativo se trata como cero", () => {
    expect(aforoLuegoDe(-5, [ev("ingreso")])).toBe(1);
  });
});

describe("armarPadron", () => {
  it("va flaco: solo lo que hace falta para decidir", () => {
    const filas = armarPadron([{ ...socio(), carnetVersion: 3, aptoMedicoHasta: "2026-12-31" }]);
    expect(filas[0]).toEqual({
      socioId: "soc1",
      categoriaId: "activo",
      estado: "activo",
      alDia: true,
      carnetVersion: 3,
      aptoMedicoHasta: "2026-12-31",
    });
    // Un lector se roba: no viaja nada que no sirva para abrir una puerta.
    expect(Object.keys(filas[0]!)).toHaveLength(6);
  });
  it("normaliza el apto ausente a null", () => {
    expect(armarPadron([{ ...socio(), carnetVersion: 1 }])[0]!.aptoMedicoHasta).toBeNull();
  });
});
