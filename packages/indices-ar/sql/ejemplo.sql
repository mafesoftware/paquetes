-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arman `tablaIndices()` + `tablaValoresIndice()` +
-- `tablaCotizaciones()` de `@mafesoftware/indices-ar/drizzle` (sin
-- opciones: tabla "indices"/"valores_indice"/"cotizaciones", columna de
-- tenant "organizacion_id" uuid NULLABLE). No es una migración: cada app
-- genera las suyas con drizzle-kit (o escribe la suya propia si no usa
-- Drizzle) a partir de su propio esquema — esto es solo la forma. Generado
-- con `generateDrizzleJson`/`generateMigration` de `drizzle-kit/api` sobre
-- el esquema real de las tres fábricas, no escrito a mano.

CREATE TABLE "indices" (
	"codigo" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"fuente" text NOT NULL,
	"frecuencia" text NOT NULL
);

-- "organizacion_id" es NULLABLE a propósito en las dos tablas de abajo:
-- NULL es el valor GLOBAL de la plataforma, un uuid concreto es el override
-- de esa organización (spec 02 §3.1). Ver el JSDoc de
-- `columnaTenantOpcional` en el paquete para el porqué (a diferencia de
-- `columnaTenant` de `@mafesoftware/tenant/drizzle`, siempre NOT NULL en el
-- resto de las tablas de negocio).

CREATE TABLE "valores_indice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacion_id" uuid,
	"indice" text NOT NULL,
	"periodo" text NOT NULL,
	"valor" numeric(20, 8) NOT NULL,
	"estado" text NOT NULL,
	"fecha_publicacion" date NOT NULL,
	"fuente" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "cotizaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacion_id" uuid,
	"fecha" date NOT NULL,
	"fuente" text NOT NULL,
	"compra" numeric(20, 6) NOT NULL,
	"venta" numeric(20, 6) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- Dos índices únicos PARCIALES por tabla, en vez de uno solo sobre (tenant,
-- ...): Postgres trata cada NULL como distinto de cualquier otro, así que
-- un único índice "a secas" dejaría pasar DOS filas globales (organizacion_id
-- IS NULL) del mismo (indice, periodo) / (fecha, fuente) -- exactamente lo
-- que hay que impedir. Con un índice filtrado por "IS NOT NULL" para los
-- overrides y otro por "IS NULL" para las filas globales, cada mitad se
-- comporta como "una fila por combinación".
CREATE UNIQUE INDEX "valores_indice_tenant_indice_periodo_key" ON "valores_indice" USING btree ("organizacion_id","indice","periodo") WHERE "valores_indice"."organizacion_id" is not null;
CREATE UNIQUE INDEX "valores_indice_global_indice_periodo_key" ON "valores_indice" USING btree ("indice","periodo") WHERE "valores_indice"."organizacion_id" is null;
CREATE UNIQUE INDEX "cotizaciones_tenant_fecha_fuente_key" ON "cotizaciones" USING btree ("organizacion_id","fecha","fuente") WHERE "cotizaciones"."organizacion_id" is not null;
CREATE UNIQUE INDEX "cotizaciones_global_fecha_fuente_key" ON "cotizaciones" USING btree ("fecha","fuente") WHERE "cotizaciones"."organizacion_id" is null;
