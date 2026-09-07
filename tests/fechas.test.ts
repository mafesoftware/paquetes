import { describe, it, expect } from "vitest";
import {
  ZONA_AR,
  diaCorto,
  diaLargo,
  paraInputFecha,
  hoyEnInput,
  diaEnZona,
  inicioDelDia,
  finDelDia,
  sumarDiasISO,
  diasEntre,
  instanteDelDia,
  horaCorta,
  diaYHora,
  haceCuanto,
  diaDeSemana,
  aMinutos,
  deMinutos,
} from "../src/index.ts";

describe("dias de calendario: se leen en UTC", () => {
  it("un dia elegido se muestra tal cual se eligio, no un dia menos", () => {
    // El bug: new Date("2026-08-19") es medianoche UTC; leido en es-AR da el 18.
    expect(diaCorto("2026-08-19")).toBe("19/08/26");
  });
  it("largo", () => {
    expect(diaLargo("2026-08-19")).toBe("19 de agosto de 2026");
  });
  it("paraInputFecha es la vuelta exacta de diaCorto", () => {
    const guardado = new Date("2026-08-19T00:00:00Z");
    expect(paraInputFecha(guardado)).toBe("2026-08-19");
    expect(diaCorto(paraInputFecha(guardado))).toBe("19/08/26");
  });
  it("el 1 de enero no se corre al 31 de diciembre", () => {
    expect(diaCorto("2027-01-01")).toBe("01/01/27");
  });
});

describe("hoyEnInput y diaEnZona: anclados a la institucion, no al proceso", () => {
  it("a las 23:30 de la Argentina todavia es hoy, aunque en UTC ya sea manana", () => {
    const nocheAR = new Date("2026-08-19T02:30:00Z"); // 23:30 del 18 en AR
    expect(hoyEnInput(ZONA_AR, nocheAR)).toBe("2026-08-18");
  });
  it("y a las 00:30 de la Argentina ya es el dia nuevo", () => {
    const madrugada = new Date("2026-08-19T03:30:00Z");
    expect(hoyEnInput(ZONA_AR, madrugada)).toBe("2026-08-19");
  });
  it("otra zona da otro dia para el mismo instante", () => {
    const i = new Date("2026-08-19T02:30:00Z");
    expect(diaEnZona(i, ZONA_AR)).toBe("2026-08-18");
    expect(diaEnZona(i, "UTC")).toBe("2026-08-19");
  });
});

describe("rangos: el dia se corta en la zona de la institucion", () => {
  it("el dia arranca a las 03:00 UTC en la Argentina", () => {
    expect(inicioDelDia("2026-08-19", ZONA_AR).toISOString()).toBe("2026-08-19T03:00:00.000Z");
  });
  it("y termina cuando arranca el siguiente", () => {
    expect(finDelDia("2026-08-19", ZONA_AR).toISOString()).toBe("2026-08-20T03:00:00.000Z");
  });
  it("un ingreso de las 21:36 cae DENTRO del dia que lo registro", () => {
    // 21:36 del 19 en AR = 00:36 del 20 en UTC. Comparado crudo, quedaba afuera.
    const ingreso = new Date("2026-08-20T00:36:00Z");
    expect(ingreso >= inicioDelDia("2026-08-19", ZONA_AR)).toBe(true);
    expect(ingreso < finDelDia("2026-08-19", ZONA_AR)).toBe(true);
  });
  it("respeta el horario de verano de una zona que lo tiene", () => {
    // Santiago de Chile cambia de huso; el dia no siempre arranca a la misma hora UTC.
    const enero = inicioDelDia("2026-01-15", "America/Santiago");
    const julio = inicioDelDia("2026-07-15", "America/Santiago");
    expect(enero.getUTCHours()).not.toBe(julio.getUTCHours());
  });
  it("funciona con un huso de media hora", () => {
    const i = inicioDelDia("2026-08-19", "Asia/Kolkata");
    expect(i.toISOString()).toBe("2026-08-18T18:30:00.000Z");
  });
  it("en UTC el dia arranca a medianoche", () => {
    expect(inicioDelDia("2026-08-19", "UTC").toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });
});

describe("aritmetica de dias", () => {
  it("suma cruzando fin de mes", () => {
    expect(sumarDiasISO("2026-08-31", 1)).toBe("2026-09-01");
  });
  it("resta", () => {
    expect(sumarDiasISO("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("cruza un ano bisiesto", () => {
    expect(sumarDiasISO("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("diasEntre cuenta dias enteros", () => {
    expect(diasEntre("2026-08-01", "2026-08-31")).toBe(30);
    expect(diasEntre("2026-08-31", "2026-08-01")).toBe(-30);
  });
  it("diasEntre no se corre por el horario de verano", () => {
    expect(diasEntre("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("instanteDelDia", () => {
  it("cae adentro del mismo dia en toda America y Europa", () => {
    const i = instanteDelDia("2026-08-19");
    for (const z of [ZONA_AR, "America/Los_Angeles", "America/Santiago", "America/Mexico_City", "Europe/Madrid", "UTC"]) {
      expect(diaEnZona(i, z)).toBe("2026-08-19");
    }
  });
  it("y NO alcanza pasando UTC+12: es el limite conocido, no un descuido", () => {
    // Si alguna vez hay un club en Nueva Zelanda, instanteDelDia tiene que
    // recibir la zona. Hasta entonces este test documenta hasta donde llega.
    expect(diaEnZona(instanteDelDia("2026-08-19"), "Pacific/Auckland")).toBe("2026-08-20");
  });
});

describe("instantes: se muestran en la zona de la institucion", () => {
  it("un ingreso de las 08:48 no sale 11:48 aunque el server corra en UTC", () => {
    expect(horaCorta(new Date("2026-08-19T11:48:00Z"), ZONA_AR)).toBe("08:48");
  });
  it("dia y hora, que es lo que va en un papel", () => {
    expect(diaYHora(new Date("2026-08-19T11:48:00Z"), ZONA_AR)).toBe("19/08/26, 08:48");
  });
  it("otra zona, otra hora", () => {
    expect(horaCorta(new Date("2026-08-19T11:48:00Z"), "UTC")).toBe("11:48");
  });
});

describe("haceCuanto", () => {
  const ahora = new Date("2026-08-19T12:00:00Z");
  it("segundos", () => {
    expect(haceCuanto(new Date("2026-08-19T11:59:30Z"), ahora)).toContain("30");
  });
  it("minutos", () => {
    expect(haceCuanto(new Date("2026-08-19T11:55:00Z"), ahora)).toContain("5");
  });
  it("horas", () => {
    expect(haceCuanto(new Date("2026-08-19T09:00:00Z"), ahora)).toContain("3");
  });
  it("dias", () => {
    expect(haceCuanto(new Date("2026-08-16T12:00:00Z"), ahora)).toContain("3");
  });
});

describe("horarios de grilla", () => {
  it("diaDeSemana lee en UTC, sin correrse", () => {
    expect(diaDeSemana("2026-08-19")).toBe(3); // miercoles
  });
  it("aMinutos", () => {
    expect(aMinutos("08:30")).toBe(510);
    expect(aMinutos("00:00")).toBe(0);
    expect(aMinutos("23:59")).toBe(1439);
  });
  it("aMinutos rechaza basura y horas imposibles", () => {
    expect(aMinutos("25:00")).toBeNull();
    expect(aMinutos("08:70")).toBeNull();
    expect(aMinutos("hola")).toBeNull();
  });
  it("deMinutos es la vuelta", () => {
    expect(deMinutos(510)).toBe("08:30");
    expect(deMinutos(aMinutos("21:45")!)).toBe("21:45");
  });
  it("deMinutos envuelve el dia", () => {
    expect(deMinutos(1440)).toBe("00:00");
    expect(deMinutos(-60)).toBe("23:00");
  });
});
