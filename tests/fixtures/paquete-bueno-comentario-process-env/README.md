# bueno-comentario-process-env

Paquete de ejemplo para probar que el chequeo de pureza de `verificarPaquete`
ignora `process.env` cuando aparece SOLO dentro de un comentario (JSDoc o de
línea), no en código real.

## API

### `saludar(nombre: string): string`

```ts
import { saludar } from '@mafesoftware/bueno-comentario-process-env';

saludar('Mundo'); // "Hola, Mundo!"
```
