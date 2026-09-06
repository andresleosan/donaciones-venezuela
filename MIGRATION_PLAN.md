# Plan de migración Supabase → Firebase

**Estado:** fase de plataforma iniciada; migración funcional aún no iniciada.  
**Principio:** migrar por contratos y dominios, con rollback verificable y sin eliminar SQL ni código hasta demostrar equivalencia.

**Proyecto Firebase confirmado:** `donaciones-venezuela-4fc29`  
**Reglas iniciales:** Firestore y Storage bloqueados por defecto; no se ha desplegado ninguna regla.

La estructura local ya incluye `firebase/`, `src/firebase/`, `firebase.json`, `.firebaserc`, `package.json` y `vite.config.js`. El build de Vite pasa y copia las páginas/recursos legacy a `dist`, pero el frontend sigue usando temporalmente Supabase; por eso el producto aún no está migrado ni listo para declarar cumplimiento final.

## 1. Mapa de equivalencias

| Supabase actual | Firebase propuesto | Riesgo | Estrategia |
|---|---|---|---|
| Supabase Auth email/password | Firebase Authentication email/password | Alto | Adaptador de Auth, `onAuthStateChanged`, persistencia local/session configurable, ID tokens |
| `/rest/v1/` y vistas públicas | Repositorios Firestore o Function de lectura | Alto | Mantener shape de `SheetsService`, paginación e índices explícitos |
| `supabase.from()` | `getDocs`, `getDoc`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc` | Alto | Un repositorio por agregado; pruebas por acción |
| RPC `estadisticas` | documentos agregados o Function de lectura | Alto | Precalcular contadores; no escanear colecciones completas |
| RPC `buscar_familiar` | consulta indexada y/o Function con campos normalizados | Alto | PII solo con autorización; limitar resultados |
| RPC `seguimiento_factura` / `seguimiento_donaciones` | subcolecciones `movimientos`, `donaciones` + Function si requiere combinación | Alto | Mantener forma de respuesta y orden temporal |
| Edge Function `/functions/v1/api` | Cloud Function HTTP `api` | Alto | Conservar 65 acciones, validar token/rol/esquema y hacer operaciones atómicas |
| `createClient` con service role | Firebase Admin SDK en Functions | Alto | Nunca enviar credenciales Admin al navegador |
| PostgreSQL tablas | Colecciones Firestore | Alto | Modelo en `FIRESTORE_SCHEMA.md`, IDs estables y referencias explícitas |
| Vistas SQL | consultas indexadas, documentos derivados o Functions | Alto | No reproducir joins costosos en cada request |
| Triggers/funciones SQL | transacciones, Functions y jobs idempotentes | Alto | Recalcular agregados dentro de una frontera transaccional |
| RLS | Firestore Security Rules + claims + Functions | Alto | Probar reglas con Emulator Suite; reglas no son filtros |
| Storage privado | Firebase Storage privado | Alto | Reglas por rol/propietario, URLs temporales desde backend |
| `getPublicUrl` de `presupuestos` | Storage público controlado o URL firmada | Medio | Confirmar que no exista PII antes de mantener visibilidad pública |
| `rate_hit` | Firestore transaction/TTL o mecanismo distribuido en Function | Alto | Diseñar límites por IP/identidad/acción sin depender de latencia del cliente |
| `factura_numero_siguiente` | contador transaccional | Alto | Transacción con reserva de número y rollback lógico |
| Telegram | Function con secreto en Secret Manager | Medio | Timeout, retry acotado y fail-soft |
| Remitly/dolarapi | Function aislada | Medio | Timeout, fuente primaria/secundaria, cache y auditoría de tasa |

## 2. Estructura objetivo

```text
firebase/
  firebase.json
  firestore.rules
  firestore.indexes.json
  storage.rules
src/firebase/
  firebase-config.js
  firebase-auth.js
  firebase-firestore.js
  firebase-storage.js
  services/
  repositories/
functions/
  src/index.ts
```

Se recomienda añadir un build mínimo (Vite/esbuild) sin convertir la interfaz en un framework. La alternativa de módulos CDN existe, pero la documentación de Firebase recomienda npm/bundler para producción ([setup](https://firebase.google.com/docs/web/setup), [alternativa CDN](https://firebase.google.com/docs/web/alt-setup)).

## 3. Fases, gates y rollback

### Fase A — preparación

Antes de `T04`, aprobar el ADR, documentar variables, entornos, costos, backup, restauración y reversión, y preparar Emulator Suite local. `donaciones-venezuela-4fc29` se usa solo para desarrollo; staging y producción deben ser proyectos separados y permanecen sin crear. **Gate previo a T04:** contratos documentados y pruebas locales de plataforma, sin acceso productivo.

### Fase B — plataforma

Añadir build, configuración Firebase, reglas iniciales y Function local con health check. **Rollback:** revertir los adaptadores locales y volver a la salida estática actual. No desplegar ni activar Blaze en esta fase.

### Fase C — Auth

Migrar registro, login, logout, refresco y roles. No copiar hashes ni refresh tokens de Supabase; hacer migración de usuarios mediante flujo seguro de restablecimiento o importación soportada. **Gate:** pruebas de sesión y autorización.

### Fase D — lectura

Antes de `T06`, ejecutar y aprobar el ensayo restaurable descrito en `BACKUP_RESTORE_PLAN.md`. Después, implementar colecciones, índices y repositorios por dominio. Comparar respuestas Supabase/Firebase en un entorno de doble lectura; no cambiar UI todavía. **Rollback:** cambiar el adaptador de lectura.

### Fase E — Storage

Migrar buckets, metadata y políticas; comprobar descargas, expiración y límites. **Rollback:** mantener objetos fuente hasta validar checksum y acceso.

### Fase F — escrituras y acciones

Portar `api` por grupos: perfiles, lugares/insumos, donaciones/facturas, transporte/viajes, denuncias y admin. Cada grupo requiere pruebas de contrato, idempotencia y transacciones. **Rollback:** detener el grupo y conservar Supabase solo durante la ventana controlada.

### Fase G — datos y corte

Transformar tablas a colecciones, cargar en staging, validar conteos, totales y relaciones, y ejecutar ensayo de corte. El corte productivo necesita confirmación explícita, backup final verificado con RPO objetivo de 15 minutos, reconciliación y procedimiento de reversión probado. Supabase permanece disponible durante la ventana de reversión.

### Fase H — limpieza

Eliminar `@supabase/supabase-js`, endpoints, migraciones y referencias solo después de una búsqueda global limpia, build, pruebas y verificación manual. En esta fase se genera `MIGRATION_REPORT.md`.

## 4. Criterios de aceptación

- Cero referencias funcionales o documentales obsoletas a Supabase, salvo historial explícitamente marcado.
- Build reproducible y despliegue Vercel documentado.
- 65 acciones cubiertas por pruebas de contrato.
- Reglas Firestore/Storage probadas con emulador para anónimo, usuario, panel y admin.
- Conteos, montos, estados, relaciones y objetos verificados contra el respaldo.
- Sin errores de consola, lint, build ni pruebas.

## 5. Bloqueadores actuales

Permanecen abiertos la creación autorizada de proyectos separados de staging y producción, la rotación de credenciales legacy, el ensayo de backup y restauración previo a `T06`, la aprobación de la ventana de corte y cualquier autorización futura para Blaze. El proyecto de desarrollo, Vite, los roles objetivo y la retención de PII ya están documentados.

Por las reglas de Cronos, este plan no autoriza acceso a datos productivos, creación de entornos remotos, activación de Blaze, migraciones destructivas ni despliegues. Los gates operativos de `BACKUP_RESTORE_PLAN.md` siguen pendientes hasta que exista evidencia real de su ejecución autorizada.
