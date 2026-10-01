# Changelog

## 0.1.0

Primer release del paquete: parseo de extractos bancarios argentinos
(`parsearExtracto`/`detectarBanco`, CSV/XLSX/PDF de 6 bancos — Galicia,
Santander, BBVA, Macro, Nación, Provincia — más `parsearConMapeo` genérico
para mapeo manual) y motor de sugerencia de matches de conciliación
(`sugerirMatches`, reglas `referencia_cuit`/`importe_fecha`/`combinacion`,
con `buscarCombinacion` y `clasificarSoloExtracto`).

Extraído de Obriq (`src/lib/dominio/conciliacion/` y `src/lib/extractos/`).
