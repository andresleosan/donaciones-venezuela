# Stack real y objetivo — Donaciones Venezuela

**Fecha:** 2026-08-06  
**Nivel:** 3 (datos personales, operaciones financieras, archivos privados, backend serverless y reglas de autorización).  
**Estado:** plataforma Firebase preparada localmente; aplicación funcional todavía usa Supabase.

## Stack actual auditado

- Frontend: HTML, CSS y JavaScript vanilla.
- Backend: Supabase Edge Function en Deno/TypeScript.
- Persistencia: PostgreSQL, vistas, RPC, RLS y Supabase Storage.
- Hosting: Vercel estático, sin build formal previo.
- Integraciones: Telegram opcional, fuentes de tasa externas, WhatsApp y OpenStreetMap.
- QA: scripts Node/Python puntuales; sin suite de contrato/emulador.

## Stack objetivo aprobado para la migración

- Frontend: vanilla conservando la UX actual, empaquetado con Vite.
- SDK cliente: Firebase Web modular.
- Auth: Firebase Authentication email/password, persistencia gestionada por SDK, `onAuthStateChanged` y claims de rol.
- Datos: Cloud Firestore, repositorios por agregado, índices explícitos y transacciones.
- Archivos: Firebase Storage, privado por defecto y URLs temporales para acceso autorizado.
- Backend: Firebase Cloud Functions para acciones privilegiadas, integraciones y validación de tokens.
- Hosting: Vercel mantiene la entrega del frontend; Functions se despliegan en Firebase.
- QA: Firebase Emulator Suite, pruebas de reglas, contratos de API, build y pruebas manuales.

## Estructura objetivo

```text
firebase/
  firestore.rules
  firestore.indexes.json
  storage.rules
src/firebase/
  firebase-config.js
  firebase-auth.js
  firebase-firestore.js
  firebase-storage.js
  repositories/
  services/
functions/
  src/
```

## Decisiones y límites

1. Se mantiene la UI vanilla; no se introduce React/Vue.
2. Se conserva inicialmente el contrato de acciones para reducir regresiones; las acciones se migran por dominio.
3. No se copian hashes, refresh tokens ni secretos Supabase a Firebase.
4. Firestore/Storage permanecen cerrados hasta tener reglas probadas.
5. No hay despliegue productivo ni migración destructiva sin backup verificado y confirmación explícita.

## Decisiones de arquitectura

- Migración incremental por contratos y dominios. Mantener Supabase reduce el costo inmediato, pero no cumple la estandarización aprobada; un reemplazo big-bang reduce la convivencia, pero concentra demasiado riesgo sobre 65 acciones y datos sensibles.
- Monorepo modular para frontend y Functions. Separar repositorios o servicios ahora no aporta escalado, despliegue ni equipos independientes suficientes para justificar su coordinación adicional.
- Documentos canónicos privados y proyecciones públicas separadas. Las Rules autorizan documentos completos y no pueden sanitizar campos durante una lectura.
- Archivos privados por defecto. El navegador conserva paths; el acceso temporal futuro se autoriza y firma desde Functions por un máximo de 15 minutos.

La decisión completa, alternativas y consecuencias viven en `docs/adr/ADR-001-migracion-supabase-firebase.md`.

## Entornos Firebase

- Desarrollo: `donaciones-venezuela-4fc29`.
- Staging: proyecto separado obligatorio, no creado en esta fase.
- Producción: proyecto separado obligatorio, no creado en esta fase.
- Pruebas locales: `demo-donaciones-venezuela`, reservado a Emulator Suite.

`.firebaserc` no contendrá aliases ficticios para staging o producción. Sus IDs se definirán solo cuando exista autorización para crear esos entornos.

## Región

Functions: `us-east1`, elegida por proximidad a Venezuela y elegibilidad de cuota gratuita aplicable a Storage en esa región. La ubicación de Firestore y Storage remoto se confirmará antes de crear recursos fuera de desarrollo.

## Costo

| Escenario | Estimación mensual | Control |
|---|---:|---|
| Desarrollo local con Emulator Suite | USD 0 | Sin recursos remotos |
| Carga baja | USD 0-10 | Recalcular con MAU, operaciones y GB reales |
| Archivos, egreso o consultas con fan-out | USD 10-100+ | Revisar diseño y presupuesto antes de habilitar |

Blaze no está autorizado y no hay alertas configuradas en este alcance. Antes de activarlo se requiere confirmación explícita y alertas de facturación en USD 5, 20 y 50. Las alertas notifican, pero no son topes de gasto ni detienen el consumo.

## Variables

El frontend usa `VITE_FIREBASE_*` desde `.env` local/Vercel. La configuración web no es un secreto. Credenciales Admin, Telegram, cron y proveedores externos deben permanecer en Secret Manager de Functions.
