# Changelog

## 0.1.0

Primer release del paquete: retenciones impositivas argentinas — Ganancias
(RG 830, mínimo no sujeto acumulado o escala), IVA (sobre el IVA del
comprobante), SUSS construcción (con/sin mano de obra) e IIBB (padrón
ARBA/AGIP o Convenio Multilateral), exclusiones/certificados de no
retención, y el formateo de ancho fijo/delimitado que usan las
exportaciones SICORE/SIRE/ARBA/AGIP. `/drizzle` (peerDependency opcional)
trae `tablaPadronIibb`/`tablaExclusiones`.

Extraído de Obriq (`src/lib/dominio/retenciones/`), donde ya era núcleo
puro por diseño (sin `@/db`, `next` ni nada de la app).
