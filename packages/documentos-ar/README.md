# @mafesoftware/documentos-ar

CUIT/CUIL, DNI, CBU/CVU, alias y teléfonos argentinos: validación y formato. Sin
dependencias.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros**. Ninguna función de acá tira: la entrada de un usuario, con
guiones, puntos o espacios de más, es un dato de negocio, no un bug — cada
`validarX` devuelve `{ ok: true, ... }` o `{ ok: false, motivo, codigo }`.

```bash
bun add @mafesoftware/documentos-ar
```

La documentación de cada función está en `src/`, con **el motivo de cada
decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué caso cubre.

## API

### `validarCuit(valor: string)`

Valida un CUIT/CUIL: 11 dígitos, prefijo conocido (20/23/24/27 persona,
30/33/34 empresa) y dígito verificador correcto. Acepta guiones, puntos y
espacios.

```ts
import { validarCuit } from "@mafesoftware/documentos-ar";

validarCuit("20-12345678-6");
// { ok: true, normalizado: "20123456786", tipo: "persona" }

validarCuit("20-12345678-7");
// { ok: false, motivo: "El dígito verificador no coincide.", codigo: "digito_verificador_invalido" }
```

**El caso del dígito verificador 10 (regla 23/33).** Para algunos DNI, el
algoritmo da DV=10 bajo el prefijo natural (20 varón, 27 mujer) — y un CUIT no
puede tener ese dígito, porque el último carácter es uno solo (0-9). En la
práctica ARCA resuelve esto reasignando el prefijo a 23, con un DV distinto:

```ts
validarCuit("20200000099"); // { ok: false, ... } — DV=10 bajo el prefijo 20, no existe
validarCuit("23200000099"); // { ok: true, normalizado: "23200000099", tipo: "persona" } — mismo DNI, prefijo 23
```

### `formatearCuit(valor: string): string`

`"20123456786"` → `"20-12345678-6"`. Lo que no llega a 11 dígitos vuelve tal
cual, sin formatear.

```ts
import { formatearCuit } from "@mafesoftware/documentos-ar";

formatearCuit("20123456786"); // "20-12345678-6"
```

### `validarDni(valor: string)`

Valida un DNI: 7 u 8 dígitos, acepta puntos de miles. Rechaza el 0 y
cualquier valor con cero a la izquierda (ningún DNI real empieza con 0).

```ts
import { validarDni } from "@mafesoftware/documentos-ar";

validarDni("12.345.678"); // { ok: true, normalizado: "12345678" }
validarDni("01234567"); // { ok: false, motivo: "Un DNI no empieza con 0.", codigo: "cero_invalido" }
```

### `validarCbu(valor: string)`

Valida un CBU: 22 dígitos en dos bloques (banco+sucursal+DV1, cuenta+DV2).
Rechaza los que empiecen con "000" — esos son CVU (`validarCvu`).

```ts
import { validarCbu } from "@mafesoftware/documentos-ar";

validarCbu("0070445200000031000947");
// { ok: true, normalizado: "0070445200000031000947", banco: "007" }

validarCbu("0000445200000031000947");
// { ok: false, motivo: 'Empieza con "000": es un CVU, no un CBU. Probá con validarCvu.', codigo: "es_cvu" }
```

### `validarCvu(valor: string)`

Valida un CVU (el CBU de una billetera virtual): 22 dígitos, arranca con
"000", mismos dos bloques de dígito verificador que un CBU.

```ts
import { validarCvu } from "@mafesoftware/documentos-ar";

validarCvu("0000031400000000123459");
// { ok: true, normalizado: "0000031400000000123459" }
```

### `validarAlias(valor: string)`

Valida un alias CBU: de 6 a 20 caracteres, `[a-z0-9.-]`. No distingue
mayúsculas de minúsculas — normaliza a minúsculas.

```ts
import { validarAlias } from "@mafesoftware/documentos-ar";

validarAlias("JUAN.PEREZ.MP"); // { ok: true, normalizado: "juan.perez.mp" }
```

### `enmascarar(valor: string, visibles = 4): string`

Deja visibles los últimos `visibles` caracteres y reemplaza el resto por
`"*"`.

```ts
import { enmascarar } from "@mafesoftware/documentos-ar";

enmascarar("2850590940090418135201"); // "******************5201"
```

### `telefonoAE164(valor: string): string | null`

Normaliza un celular argentino a E.164 (`"+549"` + área + abonado). Entiende
"+54", "9", "0" y "15" en cualquier combinación de espacios, guiones o
paréntesis. `null` si no se puede determinar.

```ts
import { telefonoAE164 } from "@mafesoftware/documentos-ar";

telefonoAE164("011 15-4444-5555"); // "+5491144445555"
telefonoAE164("(0351) 15 555-1234"); // "+5493515551234"
```

### `aWhatsApp(valor: string): string | null`

El mismo número, en el formato que espera la API de WhatsApp (E.164 sin el
`"+"`).

```ts
import { aWhatsApp } from "@mafesoftware/documentos-ar";

aWhatsApp("011 15-4444-5555"); // "5491144445555"
```

### `CONDICIONES_IVA`

Las condiciones frente al IVA más comunes, con su `idArca` (el id numérico
que usa ARCA en la factura electrónica) cuando se conoce con certeza. Las
que no se pudieron verificar quedan sin `idArca` en vez de con un valor
adivinado.

```ts
import { CONDICIONES_IVA } from "@mafesoftware/documentos-ar";

CONDICIONES_IVA.find((c) => c.codigo === "monotributo");
// { codigo: "monotributo", nombre: "Monotributo", idArca: 6 }
```

## Probar

```bash
bun test
```
