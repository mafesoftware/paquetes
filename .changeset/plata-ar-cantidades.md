---
"@mafesoftware/plata-ar": minor
---

Agrega `formatearCantidad`, `cantidadParaInput` y `normalizarCantidad` para cantidades guardadas como decimal exacto en texto (columna `numeric`): `"150.000"` se muestra `"150"` (no ciento cincuenta mil), y lo tipeado a la argentina (`"1.500"`, `"2,5"`) vuelve a la forma con punto decimal. Salen de Gestión360.
