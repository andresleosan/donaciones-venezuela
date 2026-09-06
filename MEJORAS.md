# Mejoras y decisiones necesarias

Este documento acompaña a `AUDITORIA.md`. No es autorización para aplicar cambios en producción.

## Prioridad inmediata

1. Crear proyectos Firebase separados para desarrollo, staging y producción; activar Auth, Firestore, Storage, Functions y App Check según el tráfico real.
2. Obtener un respaldo exportable de Supabase y verificar que puede restaurarse antes de transformar datos.
3. Definir el contrato de identidad y roles. La recomendación es Firebase Auth email/password, `onAuthStateChanged`, custom claims para `admin`/`panel` y perfiles no sensibles en Firestore.
4. Decidir build. Recomendación: Vite o esbuild mínimo, manteniendo la UI vanilla y publicando `dist` en Vercel. Firebase recomienda el SDK modular instalado con npm y un bundler para producción ([documentación](https://firebase.google.com/docs/web/setup)).
5. Definir límites, retención, cifrado lógico, auditoría y acceso de soporte para PII, comprobantes, denuncias y fotos.

## Mejoras de diseño

- Separar `src/firebase/` (configuración y adaptadores SDK), `src/repositories/` (consultas por agregado) y `src/services/` (casos de uso). `services/api.js` debe dejar de conocer REST y convertirse en fachada de compatibilidad durante una fase acotada.
- Mantener una Cloud Function HTTP `api` con el contrato actual para acciones de escritura y operaciones privilegiadas; cada acción debe verificar ID token, rol, esquema de entrada y límite de tasa.
- Usar transacciones para numeración, reservas, cupos, donaciones y recálculo de totales. Firestore garantiza atomicidad de transacciones y lotes, con reintentos finitos ([transacciones y lotes](https://firebase.google.com/docs/firestore/manage-data/transactions)).
- No exponer consultas amplias a clientes. Las reglas de Firestore no filtran resultados; una consulta debe cumplir por completo las reglas ([reglas y consultas](https://firebase.google.com/docs/firestore/security/rules-query)).
- Mantener archivos privados por defecto y emitir URLs temporales desde Functions; `presupuestos` solo será público si se confirma que no contiene PII.
- Mover Telegram, tasas externas y cualquier credencial a Functions; definir timeout, reintentos con backoff, idempotencia y comportamiento fail-soft.
- Introducir Emulator Suite, pruebas de reglas, pruebas de contrato para las 65 acciones y una prueba de migración de datos antes del corte.

## Mejoras de seguridad

- Eliminar la clave administrativa compartida del navegador y reemplazarla por Auth + claims o una sesión de panel de corta duración.
- No persistir refresh tokens ni secretos propios en `localStorage`; dejar que Firebase gestione la persistencia y usar `getIdToken()` cuando la API lo requiera ([persistencia de Auth](https://firebase.google.com/docs/auth/web/auth-state-persistence?hl=en)).
- Cambiar CORS `*` por orígenes explícitos. Las Functions HTTP no tienen CORS habilitado por defecto y permiten configurarlo por origen ([HTTP events](https://firebase.google.com/docs/functions/http-events)).
- Actualizar CSP de `vercel.json` y preconnects de HTML para eliminar `*.supabase.co` y permitir solo dominios Firebase estrictamente necesarios.
- Preservar los límites de tamaño/MIME del código también en reglas y Functions; registrar intentos rechazados sin guardar secretos ni PII innecesaria.

## Orden recomendado de entrega

1. Decisiones, respaldo y proyecto Firebase.
2. Build mínimo y configuración SDK sin cambiar flujos.
3. Auth y autorización.
4. Firestore de lectura y repositorios.
5. Storage.
6. Function `api` por grupos de acciones.
7. Migración de datos y corte.
8. Limpieza de Supabase, documentación final y pruebas de regresión.

