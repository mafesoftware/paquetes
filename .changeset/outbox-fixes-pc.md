---
"@mafesoftware/outbox": patch
---

`procesarOutbox` (`/drizzle`): las filas reclamadas ahora se ordenan
explícitamente en JS por `coalesce(proximo_intento_en, programado_para)`
(con el id como desempate), antes de pasarlas a la cola del pool de
`concurrencia` — un `UPDATE ... RETURNING` no garantiza conservar el orden
del `ORDER BY` de la CTE que arma el reclamo, así que el orden FIFO
documentado ("Cola del pool y lease") ya no depende de qué plan haya
elegido Postgres.

Además: se sacó una validación redundante de `leaseMs` (`> 0`, ya cubierta
por el piso de `>= 5000`) y se limpiaron comentarios internos con fórmulas
desactualizadas y referencias a rondas de fix anteriores.

Sin cambios en la API pública.
