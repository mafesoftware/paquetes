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

## Probar

```bash
bun test
```
