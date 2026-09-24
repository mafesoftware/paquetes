# @mafesoftware/reservas

Motor de disponibilidad, turnos y lista de espera. Puro.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/reservas
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### La grilla de un día: `generarTurnos`

```ts
import { generarTurnos } from "@mafesoftware/reservas";

const turnos = generarTurnos({
  espacio: { id: "cancha-1", duracionMinutos: 60, cupo: 1 },
  diaISO: "2026-09-09",
  franjas: [{ dia: 3, desde: "08:00", hasta: "22:00" }], // miércoles
  reservas: reservasDelDia,
  bloqueos: bloqueosDelDia,
  ahora: new Date(),
  socioId: socioQueMira.id, // opcional: sus propios turnos salen como "propio"
});
// cada Turno: { inicio, fin, estado: "libre"|"ocupado"|"bloqueado"|"pasado"|"propio", lugares, enEspera }
```

### ¿Puede reservar? `puedeReservar`

```ts
import { puedeReservar } from "@mafesoftware/reservas";

const r = puedeReservar({
  socio: { id: "socio-1", categoriaId: "activo", alDia: true },
  espacio: { id: "cancha-1", duracionMinutos: 60, cupo: 1 },
  inicio: turno.inicio,
  fin: turno.fin,
  reglas: { exigeCuotaAlDia: true, anticipacionMaximaDias: 7, topeSimultaneas: 2 },
  reservasDelTurno: reservasDeEseTurno,
  reservasDelSocio: reservasFuturasDelSocio,
  ahora: new Date(),
});
if (r.puede && r.entraEnEspera) {
  // r.posicion: en qué lugar de la lista de espera queda
} else if (!r.puede) {
  // r.motivo: "cuota_impaga" | "sin_lugar" | "tope_simultaneas" | …
}
```

### Cancelaciones y solapamiento

```ts
import { proximoEnEspera, seSolapan, verificarSolapamiento, ocupaLugar } from "@mafesoftware/reservas";

proximoEnEspera(reservasDelTurno, cupo); // la reserva a promover, o null

seSolapan(turnoA.inicio, turnoA.fin, turnoB.inicio, turnoB.fin); // true si se pisan (bordes no cuentan)

// El chequeo que corre la ACCIÓN del servidor, no la pantalla:
verificarSolapamiento(inicio, fin, reservasExistentes, cupo); // { libre, ocupadas }

ocupaLugar(reserva); // false para "cancelada" y "ausente"
```

## Probar

```bash
bun test
```
