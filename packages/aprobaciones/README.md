# @mafesoftware/aprobaciones

Motor de aprobaciones por niveles: qué circuito aplica a un documento y en
qué estado está una solicitud, dados sus votos — para cualquier producto de
MAFE Software que necesite un flujo tipo "esta orden de compra de más de
$X en el proyecto Y necesita 2 de 3 aprobaciones del nivel gerencial antes
de seguir". Extraído de Obriq (`src/lib/dominio/aprobaciones/circuito.ts`).

Núcleo puro: sin DB ni framework, sin `process.env`. Montos en centavos
(`bigint`), nunca `number`.

```bash
bun add @mafesoftware/aprobaciones
```

## Conceptos

- **Circuito**: la configuración de cuándo y cómo se aprueba un `tipo` de
  documento (`tipo` es `string` libre — cada producto define los suyos,
  ej. `"orden_compra"`, `"reembolso"`, `"publicacion"`). **Versionado por
  fila**: cada edición es una versión nueva (`version + 1`); la anterior
  queda inactiva pero nunca se borra, y una solicitud ya abierta sigue
  resuelta contra el **snapshot** del circuito con el que se abrió —
  editar el circuito no cambia solicitudes en curso.
- **Condiciones**: filtros opcionales (`montoDesde`, `montoHasta`,
  `proyectoId`, `rubroId`, `proveedorId`) que acotan a qué documentos
  aplica un circuito. Todos `null` = aplica a cualquier documento de ese
  `tipo`.
- **Niveles**: pasos secuenciales (`orden` 1, 2, 3...). Cada nivel lista
  quién puede votar (`usuarios` puntuales y/o `roles` — cualquier usuario
  con ese rol al momento del voto cuenta) y un `minimo` de votos
  "aprobar" para darlo por completo y pasar al siguiente.
- **Solicitud**: el proceso de aprobación abierto sobre un documento
  puntual. Su estado sale de aplicar los `Voto[]` emitidos sobre el
  snapshot del circuito — este paquete no persiste nada, solo calcula.

## API

### `elegirCircuito(circuitos, documento): Circuito | null`

El circuito que aplica a `documento`, entre los `circuitos` (pasarle solo
los **activos**, de cualquier `tipo` — la función ya filtra por
`tipo === documento.tipo`). Si varios coinciden, gana el más específico
(más condiciones no nulas); empate → mayor `montoDesde` (`null` cuenta
como el mínimo posible); empate → mayor `version`. Si ninguno coincide,
`null` — el documento no requiere aprobación.

```ts
import { elegirCircuito, type Circuito, type DocAprobable } from '@mafesoftware/aprobaciones';

const circuitos: Circuito[] = [
  {
    id: 'c-general',
    version: 1,
    tipo: 'orden_compra',
    condiciones: { montoDesde: 0n, montoHasta: null, proyectoId: null, rubroId: null, proveedorId: null },
    niveles: [{ orden: 1, usuarios: ['jefe-obra'], roles: [], minimo: 1 }],
    creadorPuedeAprobar: false,
  },
];

const doc: DocAprobable = {
  tipo: 'orden_compra',
  id: 'oc-1',
  monto: 150_000n, // $ 1.500,00 en centavos
  moneda: 'ARS',
  proyectoId: null,
  rubroIds: [],
  proveedorId: null,
  creadoPor: 'usuario-1',
};

elegirCircuito(circuitos, doc); // el circuito "c-general"
```

### `estadoSolicitud(snapshot, votos, documento): EstadoSolicitud`

El estado de una solicitud dado el `snapshot` del circuito (el `Circuito`
completo tal como estaba al abrirla) y los `Voto[]` emitidos hasta ahora:

```ts
type EstadoSolicitud = {
  nivelActual: number | null; // el nivel que todavía está votando, o null si ya terminó
  completa: boolean;
  rechazada: boolean;
  puedeVotar: (usuarioId: string, roles: string[]) => boolean;
};
```

Reglas:

- Secuencial por `orden`: un nivel se completa al llegar a su `minimo` de
  votos `"aprobar"`, recién ahí se habilita el siguiente.
- Un solo voto `"rechazar"`, en cualquier nivel, rechaza toda la
  solicitud — no hace falta que todos los niveles anteriores ya estuvieran
  completos.
- **Auto-aprobación bloqueada**: si `circuito.creadorPuedeAprobar` es
  `false`, `documento.creadoPor` nunca puede votar su propia solicitud,
  aunque figure entre los `usuarios`/`roles` habilitados del nivel.
- `puedeVotar` también es `false` si la solicitud ya está
  completa/rechazada, si el usuario ya votó en el nivel actual, o si no
  está habilitado en ese nivel (ni por `usuarios` ni por `roles`).

```ts
import { estadoSolicitud, type Voto } from '@mafesoftware/aprobaciones';

const votos: Voto[] = [{ nivel: 1, usuarioId: 'jefe-obra', decision: 'aprobar', comentario: null, en: new Date().toISOString() }];

const estado = estadoSolicitud(circuitos[0]!, votos, doc);
estado.completa; // true (minimo del nivel 1 era 1)
estado.puedeVotar('jefe-obra', []); // false — ya votó
```

## Lo que este paquete NO hace

No persiste nada: ni circuitos, ni solicitudes, ni votos. Guardar el
snapshot al abrir una solicitud, insertar cada voto y decidir en qué
transacción hacerlo es responsabilidad de cada app, sobre su propio
schema — no hay una parte genérica de eso para extraer acá (a diferencia
de, por ejemplo, `@mafesoftware/numeradores`, donde la tabla y la
operación atómica SÍ son iguales entre apps). Ver
`src/lib/aprobaciones/` y `src/db/schema/aprobaciones.ts` en Obriq para un
ejemplo completo de app que compone este motor con su propia
persistencia.
