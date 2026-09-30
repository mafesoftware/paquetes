# @mafesoftware/clientes

Validación de documento (DNI/CUIT) y normalización para detectar
duplicados (email, teléfono, documento) de clientes o prospectos — para
los productos de MAFE Software que dan de alta clientes/prospectos y
necesitan avisar "ya existe uno con este documento/teléfono/email" antes
de insertar, o alimentar una sugerencia de fusión.

Núcleo puro: sin DB ni framework. Compone
[`@mafesoftware/documentos-ar`](../documentos-ar) para el algoritmo del
dígito verificador — este paquete nunca lo reimplementa.

```bash
bun add @mafesoftware/clientes
```

## API

### `validarDocumentoCliente(tipo, valor): ResultadoDocumentoCliente`

Valida y normaliza un DNI o un CUIT. Nunca tira.

```ts
type TipoDocumentoCliente = 'dni' | 'cuit';
type ResultadoDocumentoCliente = { ok: true; normalizado: string } | { ok: false; mensaje: string };
```

```ts
import { validarDocumentoCliente } from '@mafesoftware/clientes';

validarDocumentoCliente('dni', '12.345.678');
// { ok: true, normalizado: "12345678" }

validarDocumentoCliente('cuit', '20-12345678-7');
// { ok: false, mensaje: "..." } — dígito verificador inválido
```

### `normalizarTelefono(telefono): string`

Normaliza un teléfono argentino para comparar duplicados: solo dígitos,
sin el código de país (`54`), sin el `9` de celular, sin el `0` de discado
local — así `"+54 9 11 1234-5678"` y `"11 1234-5678"` normalizan al mismo
valor. Nunca tira: vacío o `null`/`undefined` normaliza a cadena vacía.

```ts
import { normalizarTelefono } from '@mafesoftware/clientes';

normalizarTelefono('+54 9 11 1234-5678'); // "1112345678"
normalizarTelefono('11 1234-5678'); // "1112345678"
```

### `esMismoTelefono(a, b): boolean`

¿Dos teléfonos son el mismo número, normalizados? Dos cadenas vacías
**nunca** "coinciden" entre sí (no hay nada que comparar) — evita marcar
como duplicados dos registros que simplemente no cargaron el teléfono.

```ts
import { esMismoTelefono } from '@mafesoftware/clientes';

esMismoTelefono('+54 9 11 1234-5678', '11 1234-5678'); // true
esMismoTelefono('', ''); // false
```

### `normalizarDni(dni): string`

Normaliza un DNI/documento a solo dígitos, para comparar duplicados.

### `normalizarEmail(email): string`

Normaliza un email para comparar duplicados: minúsculas, sin espacios de
borde.

```ts
import { normalizarDni, normalizarEmail } from '@mafesoftware/clientes';

normalizarDni('12.345.678'); // "12345678"
normalizarEmail('  Juan@Mail.com '); // "juan@mail.com"
```

## Lo que este paquete NO hace

La fusión en sí (mover cuenta corriente, reservas, prospectos u otras
tablas del cliente perdedor al ganador, y archivar al perdedor con un
puntero) es lógica transaccional atada al schema de cada app — no hay una
parte pura de eso para extraer acá. Cada app implementa su propio
`fusionarClientes`/`fusionarProspectos` usando estas utilidades solo para
**detectar** el duplicado antes de fusionar, no para ejecutar la fusión.
