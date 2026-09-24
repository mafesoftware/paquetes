import { describe, it, expect } from "vitest";
import {
  ZONA_AR,
  aMinutos,
  deMinutos,
  diaCorto,
  diaDeInstante,
  diaDeSemana,
  diaEnZona,
  diaLargo,
  diaLargoDeInstante,
  diaYHora,
  diasEntre,
  ErrorFecha,
  finDelDia,
  haceCuanto,
  horaCorta,
  hoyEnInput,
  inicioDelDia,
  instanteDelDia,
  instanteEnZona,
  paraInputFecha,
  sumarDiasISO,
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
  it("inicioDelDia y finDelDia tambien aceptan un Date, no solo un string", () => {
    const dia = new Date("2026-08-19T15:00:00Z");
    expect(inicioDelDia(dia, "UTC").toISOString()).toBe("2026-08-19T00:00:00.000Z");
    expect(finDelDia(dia, "UTC").toISOString()).toBe("2026-08-20T00:00:00.000Z");
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
  it("diasEntre cuenta el 29 de febrero de un ano bisiesto (requisito 0.2)", () => {
    expect(diasEntre("2028-02-28", "2028-03-01")).toBe(2);
    expect(diasEntre("2028-02-01", "2029-02-01")).toBe(366);
  });

  it("diasEntre valida los dos argumentos: tira ErrorFecha con un dia de calendario imposible", () => {
    // Antes de la validacion, Date.parse rodaba el "30 de febrero" al 2 de
    // marzo sin avisar, y esto daba -1 en vez de tirar.
    expect(() => diasEntre("2026-02-30", "2026-03-01")).toThrow(ErrorFecha);
    try {
      diasEntre("2026-02-30", "2026-03-01");
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("fecha_invalida");
    }
  });
  it("diasEntre valida el segundo argumento tambien", () => {
    expect(() => diasEntre("2026-03-01", "2026-02-30")).toThrow(ErrorFecha);
  });
  it("diasEntre tira ErrorFecha (formato_invalido) con basura o un formato roto", () => {
    expect(() => diasEntre("not-a-date", "2026-03-01")).toThrow(ErrorFecha);
    expect(() => diasEntre("2026-03-01", "2026-13-01")).toThrow(ErrorFecha);
    try {
      diasEntre("not-a-date", "2026-03-01");
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("formato_invalido");
    }
    try {
      diasEntre("2026-03-01", "2026-13-01");
    } catch (e) {
      expect((e as ErrorFecha).codigo).toBe("fecha_invalida"); // mes 13: formato bien, calendario mal
    }
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
  it("tambien acepta un Date, no solo un string", () => {
    expect(diaEnZona(instanteDelDia(new Date("2026-08-19T00:00:00Z")), "UTC")).toBe("2026-08-19");
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
  it("dia de un instante, corto", () => {
    expect(diaDeInstante(new Date("2026-08-19T11:48:00Z"), ZONA_AR)).toBe("19 ago");
  });
  it("dia de un instante, largo", () => {
    expect(diaLargoDeInstante(new Date("2026-08-19T11:48:00Z"), ZONA_AR)).toBe("19 de agosto de 2026");
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

describe("los dias en que la medianoche NO existe", () => {
  /**
   * En Chile, el 6 de septiembre de 2026 el reloj salta de las 24:00 del 5
   * directo a la 01:00 del 6: **las 00:00 de ese día no existen**.
   *
   * La corrección de dos pasadas caía una hora antes y devolvía las 23:00 del
   * día anterior. El síntoma es de una hora, un día al año, y silencioso: el
   * rango `[inicioDelDia, finDelDia)` del 6 se llevaba la última hora del 5, así
   * que un pago o un acceso de las 23:30 aparecía en el reporte del día
   * siguiente. El 5, en cambio, terminaba una hora antes.
   *
   * Argentina hoy no tiene horario de verano, pero la zona del club **sale de la
   * base** y este paquete se reusa en los otros productos: el que se rompe es
   * el club de Santiago, no el nuestro.
   */
  const SANTIAGO = "America/Santiago";

  it("el arranque del día es la primera hora que SÍ existe", () => {
    const arranque = inicioDelDia("2026-09-06", SANTIAGO);
    expect(diaEnZona(arranque, SANTIAGO)).toBe("2026-09-06");
    // Y es la 01:00 local, no las 00:00 que no existieron.
    expect(horaCorta(arranque, SANTIAGO)).toBe("01:00");
  });

  it("y no se solapa con el día anterior", () => {
    // Sin esto, la última hora del 5 caía adentro del 6.
    const finDel5 = finDelDia("2026-09-05", SANTIAGO);
    const inicioDel6 = inicioDelDia("2026-09-06", SANTIAGO);
    expect(finDel5.getTime()).toBe(inicioDel6.getTime());
    expect(diaEnZona(new Date(finDel5.getTime() - 60_000), SANTIAGO)).toBe("2026-09-05");
  });

  it("la propiedad vale para todo el año y en zonas de media hora y de 45 minutos", () => {
    // Es la afirmación que importa: el arranque de un día pertenece a ESE día.
    // Un solo día mal corre los reportes, el estado de cuota y el aforo.
    const zonas = [
      "America/Argentina/Buenos_Aires",
      "America/Santiago",
      "America/Sao_Paulo",
      "Asia/Kolkata",
      "Australia/Lord_Howe",
      "Pacific/Chatham",
      "Europe/Madrid",
      "UTC",
    ];
    const fallas: string[] = [];
    for (const zona of zonas) {
      let dia = "2026-01-01";
      for (let i = 0; i < 365; i++) {
        if (diaEnZona(inicioDelDia(dia, zona), zona) !== dia) fallas.push(`${zona} ${dia}`);
        dia = sumarDiasISO(dia, 1);
      }
    }
    expect(fallas).toEqual([]);
  });

  it("el fin de un día sigue siendo el arranque del siguiente, sin huecos", () => {
    const zonas = ["America/Santiago", "Europe/Madrid", "Pacific/Chatham"];
    for (const zona of zonas) {
      let dia = "2026-01-01";
      for (let i = 0; i < 365; i++) {
        expect(finDelDia(dia, zona).getTime(), `${zona} ${dia}`).toBe(
          inicioDelDia(sumarDiasISO(dia, 1), zona).getTime()
        );
        dia = sumarDiasISO(dia, 1);
      }
    }
  });
});

describe("instanteEnZona: la hora de pared del club", () => {
  /**
   * Vive acá y no en `@mafesoftware/reservas` porque **estaba duplicada**, y la
   * aritmética de husos duplicada es exactamente cómo una parte del sistema
   * termina contestando distinto que la otra sobre el mismo momento — que es el
   * bug que ya pasó con "este turno ya pasó".
   */
  it("las 08:00 en Buenos Aires son las 11:00 UTC", () => {
    expect(instanteEnZona("2026-06-15", "08:00", "America/Argentina/Buenos_Aires").toISOString()).toBe(
      "2026-06-15T11:00:00.000Z"
    );
  });

  it("funciona en un huso de media hora", () => {
    // Kolkata es +5:30: las 08:00 de allá son las 02:30 UTC.
    expect(instanteEnZona("2026-06-15", "08:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-06-15T02:30:00.000Z"
    );
  });

  it("y en uno de tres cuartos de hora", () => {
    // Chatham es +12:45 en invierno del norte.
    const t = instanteEnZona("2026-06-15", "08:00", "Pacific/Chatham");
    expect(horaCorta(t, "Pacific/Chatham")).toBe("08:00");
  });

  it("la hora de pared que pide es la que devuelve, todo el año", () => {
    // Es la afirmación que importa para la grilla: un turno de las 08:00 tiene
    // que arrancar a las 08:00 del club, no a las 07:00 ni a las 09:00.
    const fallas: string[] = [];
    for (const zona of ["America/Santiago", "Europe/Madrid", "America/Sao_Paulo", "Australia/Lord_Howe"]) {
      let dia = "2026-01-01";
      for (let i = 0; i < 365; i++) {
        for (const hhmm of ["00:00", "08:00", "23:00"]) {
          const t = instanteEnZona(dia, hhmm, zona);
          const marca = horaCorta(t, zona);
          // La única excepción admitida es que esa hora no haya existido: ahí
          // devuelve la primera posterior, y eso es más tarde, nunca más temprano.
          if (marca !== hhmm && marca < hhmm) fallas.push(`${zona} ${dia} ${hhmm} -> ${marca}`);
        }
        dia = sumarDiasISO(dia, 1);
      }
    }
    expect(fallas).toEqual([]);
  });

  it("si la hora no existió, devuelve la primera posterior y no la anterior", () => {
    // En Santiago el 6-sep-2026 el reloj salta de 24:00 a 01:00: las 00:00 no
    // existieron. Un turno de las 00:00 tiene que quedar a la 01:00, no a las
    // 23:00 del día anterior — antes de que el club abra.
    const t = instanteEnZona("2026-09-06", "00:00", "America/Santiago");
    expect(diaEnZona(t, "America/Santiago")).toBe("2026-09-06");
    expect(horaCorta(t, "America/Santiago")).toBe("01:00");
  });

  it("con un hhmm que no es una hora valida, no busca: devuelve la aproximacion cruda", () => {
    // aMinutos("24:00") da null (24 no es una hora, aunque "24:00:00Z" sea un
    // Date válido: rueda a la medianoche del día siguiente), así que no hay
    // minutosPedidos con qué comparar y la función no entra a la búsqueda por
    // hora de pared.
    expect(aMinutos("24:00")).toBeNull();
    const t = instanteEnZona("2026-06-15", "24:00", "UTC");
    expect(t.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });
});
