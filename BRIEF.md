# Brief de migración

## Usuarios prioritarios

1. Personas donantes y voluntarias: necesitan autenticarse y registrar operaciones sin perder datos.
2. Centros y equipos de atención: necesitan consultar necesidades, familias y entregas con permisos mínimos.
3. Administración y auditoría: necesitan operaciones financieras, trazabilidad y controles de acceso.

## Backlog priorizado (RICE simplificado)

Puntaje = (alcance + impacto + confianza + esfuerzo invertido) / 4. El esfuerzo vale 5 cuando es pequeño.

| Orden | Entrega | Alcance | Impacto | Confianza | Esfuerzo | Puntaje |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Reglas Firestore/Storage + Emulator Suite | 5 | 5 | 5 | 3 | 4.50 |
| 2 | Firebase Auth y sesión segura | 5 | 5 | 5 | 3 | 4.50 |
| 3 | Contrato `api` y verificación de ID token | 5 | 5 | 4 | 2 | 4.00 |
| 4 | Repositorios de lecturas públicas | 5 | 4 | 4 | 2 | 3.75 |
| 5 | Storage de fotos, comprobantes y denuncias | 4 | 5 | 4 | 2 | 3.75 |
| 6 | Pruebas de regresión y observabilidad | 5 | 4 | 4 | 2 | 3.75 |
| 7 | Limpieza Supabase y documentación final | 3 | 3 | 5 | 4 | 3.75 |
| 8 | Migración y reconciliación de datos | 5 | 5 | 3 | 1 | 3.50 |

## Fuera de la primera entrega

- Rediseño visual o cambio de framework.
- Nuevas funcionalidades no presentes en Supabase.
- Publicación de datos familiares o denuncias.
- Optimización prematura de consultas sin evidencia de carga.
