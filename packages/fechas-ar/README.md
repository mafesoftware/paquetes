# @mafesoftware/fechas-ar

Dias de calendario vs instantes, con zona horaria explicita. Sin dependencias.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/fechas-ar
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### Días de calendario (se leen en UTC)

Un día elegido en un `<input type="date">` (`"2026-08-19"`) se guarda como
medianoche UTC; estas funciones lo leen de vuelta tal cual, sin que la zona
del navegador le reste un día.

```ts
import { diaCorto, diaLargo, paraInputFecha, hoyEnInput } from "@mafesoftware/fechas-ar";

diaCorto("2026-08-19");        // "19/08/26"
diaLargo("2026-08-19");        // "19 de agosto de 2026"
paraInputFecha(new Date("2026-08-19T00:00:00Z")); // "2026-08-19"
hoyEnInput();                  // el día de hoy, anclado a America/Argentina/Buenos_Aires
```

### Instantes (se muestran en la zona de la institución)

```ts
import { horaCorta, diaDeInstante, diaLargoDeInstante, diaYHora, haceCuanto } from "@mafesoftware/fechas-ar";

const ingreso = new Date("2026-08-26T11:48:00Z"); // 08:48 en Argentina (UTC-3)
horaCorta(ingreso);          // "08:48"
diaDeInstante(ingreso);      // "26 ago"
diaLargoDeInstante(ingreso); // "26 de agosto de 2026"
diaYHora(ingreso);           // "26/08/26, 08:48"
haceCuanto(ingreso, new Date("2026-08-26T12:48:00Z")); // "hace 1 hora"
```

### Zona horaria: día ↔ instante y rangos

```ts
import { diaEnZona, inicioDelDia, finDelDia, instanteEnZona, instanteDelDia } from "@mafesoftware/fechas-ar";

diaEnZona(ingreso);                 // "2026-08-26" (el día de calendario en la zona)
inicioDelDia("2026-08-26");         // el instante en que arranca el 26 en la zona
finDelDia("2026-08-26");            // el instante en que arranca el 27 (límite exclusivo)
instanteEnZona("2026-08-26", "08:00"); // las 08:00 de pared del 26, en la zona
instanteDelDia("2026-08-26");       // un instante representativo del día (mediodía UTC)
```

`ZONA_AR` (`"America/Argentina/Buenos_Aires"`) es la zona por defecto en todas
estas funciones; un club de otro país pasa la suya como último parámetro.

### Aritmética de días y de horarios

```ts
import { sumarDiasISO, diasEntre, diaDeSemana, aMinutos, deMinutos } from "@mafesoftware/fechas-ar";

sumarDiasISO("2026-08-19", 5); // "2026-08-24"
diasEntre("2026-08-19", "2026-08-24"); // 5
diaDeSemana("2026-08-19"); // 3 (miércoles; 0 = domingo)
aMinutos("08:30");  // 510
deMinutos(510);      // "08:30"
```

## API 0.2

Una tercera familia, de **calendario puro**: recibe y devuelve
`"YYYY-MM-DD"`/`"YYYY-MM"`, nunca un `Date`. Un formato roto o un calendario
imposible (`"2026-02-30"`) tira `ErrorFecha`, no devuelve `null` ni `NaN`.

### Errores (`errores.ts`)

```ts
import { ErrorFecha, type CodigoErrorFecha } from "@mafesoftware/fechas-ar";

try {
  // ...
} catch (e) {
  if (e instanceof ErrorFecha) {
    e.codigo; // "formato_invalido" | "fecha_invalida" | "dia_invalido"
  }
}
```

### Períodos mensuales (`periodo.ts`)

```ts
import { esPeriodo, etiquetaPeriodo, periodoDe, sumarPeriodos, type Periodo } from "@mafesoftware/fechas-ar";

esPeriodo("2026-09");        // true
esPeriodo("2026-13");        // false: no hay mes 13
periodoDe("2026-09-24");     // "2026-09"
sumarPeriodos("2026-11", 3); // "2027-02" (n negativo resta; n === 0 devuelve el mismo período)
etiquetaPeriodo("2026-09");  // "sep-2026"
```

### Meses de cuota (`meses.ts`)

```ts
import { sumarMeses } from "@mafesoftware/fechas-ar";

// dia es el día objetivo (1..31 o "ultimo"), clamped al último día real del
// mes resultante: nunca se desborda al mes siguiente.
sumarMeses("2026-01-31", 1, 31);     // "2026-02-28" (2026 no es bisiesto)
sumarMeses("2028-01-31", 1, 31);     // "2028-02-29" (2028 sí lo es)
sumarMeses("2026-01-15", 2, "ultimo"); // "2026-03-31"
```

### Días hábiles (`habiles.ts`)

Los feriados se inyectan (spec 06 §3.1): cada organización trae los suyos.

```ts
import { esHabil, siguienteHabil, anteriorHabil } from "@mafesoftware/fechas-ar";

const feriados = new Set(["2026-09-04"]); // viernes feriado

esHabil("2026-09-05", feriados);       // false: sábado
esHabil("2026-09-04", feriados);       // false: feriado (aunque sea viernes)
siguienteHabil("2026-09-04", feriados); // "2026-09-07": viernes feriado + fin de semana -> lunes
siguienteHabil("2026-09-01", feriados); // "2026-09-01": ya es hábil, se devuelve igual (documentado)
anteriorHabil("2026-09-06", feriados);  // "2026-09-03": domingo -> sábado y viernes tampoco sirven (feriado) -> jueves
```

## Probar

```bash
bun test
```
