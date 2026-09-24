# @mafesoftware/carnet-qr

Credencial digital firmada (Ed25519), verificable offline.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/carnet-qr
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### Alta del club

```ts
import { generarClaves } from "@mafesoftware/carnet-qr";

const { privadaPem, publicaPem } = generarClaves(); // una vez, al dar de alta el club
// privadaPem la guarda el club; publicaPem va en cada dispositivo/molinete.
```

### Emitir y verificar

```ts
import { emitirCarnet, verificarCarnet } from "@mafesoftware/carnet-qr";

const token = emitirCarnet(
  {
    clubId: "club-1",
    socioId: "socio-42",
    numeroSocio: "0042",
    nombre: "Juana Pérez",
    categoria: "activo",
    version: 1,
    emitidoEn: new Date(),
    valeHasta: new Date(Date.now() + 365 * 86_400_000),
  },
  privadaPem
); // "GF1.<datos base64url>.<firma base64url>" — esto va adentro del QR

const r = verificarCarnet(token, { publicaPem, versionVigente: 1 });
if (r.ok) {
  // r.datos: los mismos campos que se emitieron
} else {
  // r.motivo: "formato" | "firma" | "vencido" | "todavia_no_vale" | "version_revocada"
}
```

### Comparación en tiempo constante

```ts
import { compararEnTiempoConstante } from "@mafesoftware/carnet-qr";

compararEnTiempoConstante(tokenDelDispositivo, tokenGuardado); // sin filtrar por timing
```

## Probar

```bash
bun test
```
