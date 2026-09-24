-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arma `@mafesoftware/numeradores/drizzle` con
-- `tablaNumeradores()` (sin opciones: tabla "numeradores", columna de
-- tenant "organizacion_id" uuid — la que da `columnaTenant()` de
-- `@mafesoftware/tenant/drizzle`). No es una migración: cada app genera
-- las suyas con drizzle-kit (o escribe la suya propia si no usa Drizzle) a
-- partir de su propio esquema — esto es solo la forma. Generado con
-- `generateDrizzleJson`/`generateMigration` de `drizzle-kit/api` sobre el
-- esquema real de `tablaNumeradores()`, no escrito a mano.

CREATE TABLE "numeradores" (
	"organizacion_id" uuid NOT NULL,
	"ambito" text DEFAULT '' NOT NULL,
	"tipo" text NOT NULL,
	"prefijo" text DEFAULT '' NOT NULL,
	"relleno" integer DEFAULT 0 NOT NULL,
	-- El "1" de acá sale como expresión SQL (no un literal bigint de JS) por
	-- una limitación de drizzle-kit/api al armar el snapshot en JSON del
	-- esquema (ver el comentario en tabla.ts) — el resultado en la base es
	-- el mismo: la primera fila de cada (tenant, ámbito, tipo) arranca con
	-- "proximo" = 1.
	"proximo" bigint DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- "ambito" DEFAULT '' (nunca NULL): un índice único de Postgres trata cada
-- NULL como distinto de cualquier otro, así que dos filas "sin ámbito" del
-- mismo tenant y tipo NO chocarían si la columna admitiera NULL. Con ''
-- fijo, este índice único sí las distingue como la MISMA fila — es lo que
-- hace atómico el INSERT ... ON CONFLICT de `siguienteNumero`.
CREATE UNIQUE INDEX "numeradores_tenant_ambito_tipo_key" ON "numeradores" USING btree ("organizacion_id","ambito","tipo");
