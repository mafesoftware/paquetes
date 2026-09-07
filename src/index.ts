/**
 * Dos familias de fecha que NO se mezclan.
 *
 * ## 1. Un DÍA elegido en un calendario
 *
 * Un `<input type="date">` devuelve `"2026-08-19"`. `new Date("2026-08-19")`
 * lo interpreta como **medianoche UTC**, y eso es lo que termina guardado en
 * la columna `timestamptz`. Al mostrarlo con `toLocaleDateString("es-AR")`,
 * el navegador lo pasa a hora argentina (UTC−3): las 00:00 del 19 se vuelven
 * las 21:00 del **18**, y la pantalla muestra un día menos que el que se
 * eligió.
 *
 * No es cosmético: una cuota que dice vencer el 18 cuando vence el 19 le
 * cobra recargo a un socio que pagó en término.
 *
 * La regla: **lo que se eligió en un calendario se lee en UTC**, porque en UTC
 * está guardado. Son `diaCorto`, `diaLargo`, `paraInputFecha`, `hoyEnInput`.
 *
 * ## 2. Un INSTANTE: cuándo pasó algo
 *
 * Cuándo entró el socio por el molinete, cuándo se cobró, cuándo se abrió la
 * caja. `toLocaleTimeString` usa la zona de QUIEN CORRE el código, y en Vercel
 * el servidor corre en **UTC**: un ingreso de las 08:48 salía "11:48". Se
 * escapa porque en la máquina de desarrollo —que está en la Argentina— el
 * número sale bien, y falla recién en producción.
 *
 * Vale para las dos puntas: estas pantallas son componentes cliente que Next
 * igual renderiza en el servidor, así que sin la zona fijada el primer pintado
 * dice una hora y la hidratación la corrige a otra.
 *
 * **La zona es un dato de la institución, no del proceso.** Todas las
 * funciones de instante la reciben; el default es la Argentina porque es donde
 * está el grueso, pero un club uruguayo o chileno pasa la suya.
 *
 * ## 3. Un RANGO de días
 *
 * `inicioDelDia(dia, zona)` y `finDelDia(dia, zona)`: lo que pasó después de
 * las 21:00 de acá ya es "mañana" en UTC, y un ingreso de las 21:36 quedaba
 * afuera del día que lo registró. En los tests se lee como un flake que solo
 * aparece entre las 21 y las 24.
 *
 * El paquete es PURO y no tiene dependencias: lo importan las pantallas, que
 * son cliente.
 */

/** La zona por defecto. Un club de otro país pasa la suya. */
export const ZONA_AR = "America/Argentina/Buenos_Aires";

/* ============================================================
   DÍAS: lo que alguien eligió en un calendario. Se leen en UTC.
   ============================================================ */

/** El día elegido, tal cual se eligió: `"19/08/26"`. */
export function diaCorto(f: Date | string, locale = "es-AR"): string {
  return new Date(f).toLocaleDateString(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/** El día elegido, largo: `"19 de agosto de 2026"`. */
export function diaLargo(f: Date | string, locale = "es-AR"): string {
  return new Date(f).toLocaleDateString(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * De una fecha guardada al `"2026-08-19"` que espera un `<input type="date">`.
 *
 * `toISOString().slice(0, 10)` ya da UTC, así que es la vuelta exacta de
 * `diaCorto`: lo que se muestra es lo que vuelve al calendario al editar.
 */
export function paraInputFecha(f: Date | string): string {
  return new Date(f).toISOString().slice(0, 10);
}

/**
 * El día de HOY, como lo espera un `<input type="date">`.
 *
 * Va **anclado a la zona de la institución** y no a la del reloj de quien
 * mira, por dos motivos que apuntan al mismo lado. En Vercel el servidor corre
 * en UTC: entre las 21 y la medianoche de acá, `toISOString()` ya está en el
 * día siguiente, así que un formulario que se abre a la noche traería la fecha
 * de mañana. Y como el campo se renderiza en el servidor y se hidrata en el
 * navegador, dos zonas distintas darían dos textos distintos para el mismo
 * campo — el parpadeo clásico de la hidratación.
 */
export function hoyEnInput(zona = ZONA_AR, ahora = new Date()): string {
  return diaEnZona(ahora, zona);
}

/** El día de calendario (`"2026-08-19"`) al que pertenece un instante. */
export function diaEnZona(instante: Date | string, zona = ZONA_AR): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instante));
  const parte = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/* ============================================================
   RANGOS: de un día de calendario a los instantes que lo delimitan.
   ============================================================ */

/**
 * El instante en que ARRANCA un día de calendario, en la zona dada.
 *
 * Resuelto por búsqueda del desplazamiento real de la zona ese día, así que
 * funciona con horario de verano y con husos de media hora — a diferencia de
 * restar tres horas a mano, que es lo que estaba escrito en cuatro lugares.
 */
export function inicioDelDia(dia: Date | string, zona = ZONA_AR): Date {
  const iso = typeof dia === "string" ? dia.slice(0, 10) : paraInputFecha(dia);
  // Primera aproximación: medianoche UTC. Después se corrige por el
  // desplazamiento que la zona tenía EN ESE INSTANTE (no en otro).
  const tentativa = new Date(`${iso}T00:00:00Z`);
  const desfase = desplazamientoMinutos(tentativa, zona);
  const corregida = new Date(tentativa.getTime() + desfase * 60_000);
  // Segunda pasada: si el desfase cambió (cruce de horario de verano) se
  // recalcula con el desplazamiento del instante corregido.
  const desfase2 = desplazamientoMinutos(corregida, zona);
  return desfase2 === desfase
    ? corregida
    : new Date(tentativa.getTime() + desfase2 * 60_000);
}

/**
 * El instante en que TERMINA un día de calendario: el arranque del siguiente.
 *
 * Es lo que hace falta para que un "hasta el 31" incluya el 31 entero. Se usa
 * como límite EXCLUSIVO (`< finDelDia`).
 */
export function finDelDia(dia: Date | string, zona = ZONA_AR): Date {
  const iso = typeof dia === "string" ? dia.slice(0, 10) : paraInputFecha(dia);
  return inicioDelDia(sumarDiasISO(iso, 1), zona);
}

/** Suma días a un `"2026-08-19"` sin pasar por husos. */
export function sumarDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Cuántos días enteros hay entre dos días de calendario. */
export function diasEntre(desdeISO: string, hastaISO: string): number {
  const a = Date.parse(`${desdeISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hastaISO.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Cuántos minutos hay que RESTARLE a un instante UTC para que su reloj de
 * pared en `zona` marque la misma hora. Negativo al oeste de Greenwich.
 */
function desplazamientoMinutos(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0);
  const hora = p("hour") === 24 ? 0 : p("hour");
  const comoUTC = Date.UTC(p("year"), p("month") - 1, p("day"), hora, p("minute"), p("second"));
  return -(comoUTC - instante.getTime()) / 60_000;
}

/**
 * De un DÍA de calendario al INSTANTE con el que se anota un hecho de ese día.
 *
 * Se usa cuando un día elegido a mano tiene que guardarse en una columna donde
 * **todo lo demás es un instante** — si no, un hecho del 26 aparece listado
 * como "25", justo la fecha con la que después se lo busca contra el papel.
 *
 * **El mediodía UTC no sirve para CUALQUIER huso**, aunque se lea como si sí:
 * cubre de UTC−12 a UTC+11, y en Auckland (UTC+12) ya es el día siguiente. Es
 * suficiente para América y Europa, que es donde hay clubes, y por eso alcanza;
 * pero si algún día hay uno en Nueva Zelanda o en Kiribati, esta función tiene
 * que recibir la zona y usar `inicioDelDia` + medio día. Lo guarda un test.
 */
export function instanteDelDia(dia: Date | string): Date {
  const f = typeof dia === "string" ? new Date(`${dia.slice(0, 10)}T00:00:00Z`) : new Date(dia);
  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), 12, 0, 0));
}

/* ============================================================
   INSTANTES: cuándo pasó algo. Se muestran en la zona de la institución.
   ============================================================ */

/** La hora de un instante: `"08:48"`. */
export function horaCorta(f: Date | string, zona = ZONA_AR, locale = "es-AR"): string {
  return new Date(f).toLocaleTimeString(locale, {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** El día de un instante, corto: `"26 ago"`. */
export function diaDeInstante(f: Date | string, zona = ZONA_AR, locale = "es-AR"): string {
  return new Date(f).toLocaleDateString(locale, {
    timeZone: zona,
    day: "numeric",
    month: "short",
  });
}

/** El día de un instante, largo: `"26 de agosto de 2026"`. */
export function diaLargoDeInstante(f: Date | string, zona = ZONA_AR, locale = "es-AR"): string {
  return new Date(f).toLocaleDateString(locale, {
    timeZone: zona,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Día y hora de un instante: `"26/08/26, 08:48"`. Es lo que va en un papel. */
export function diaYHora(f: Date | string, zona = ZONA_AR, locale = "es-AR"): string {
  return new Date(f).toLocaleString(locale, {
    timeZone: zona,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * "hace 5 minutos", "hace 2 horas", "hace 3 días".
 *
 * Para el latido de un dispositivo y el último ingreso, donde el número
 * exacto importa menos que si fue recién o hace rato.
 */
export function haceCuanto(f: Date | string, ahora = new Date(), locale = "es-AR"): string {
  const ms = ahora.getTime() - new Date(f).getTime();
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const escalas: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["month", 2_592_000_000],
    ["year", 31_536_000_000],
  ];
  let elegida: [Intl.RelativeTimeFormatUnit, number] = escalas[0]!;
  for (const e of escalas) if (Math.abs(ms) >= e[1]) elegida = e;
  return fmt.format(-Math.round(ms / elegida[1]), elegida[0]);
}

/** El día de la semana de un día de calendario. 0 = domingo. */
export function diaDeSemana(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/** `"08:30"` → 510. Los horarios de una grilla se guardan como minutos. */
export function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 510 → `"08:30"`. */
export function deMinutos(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
