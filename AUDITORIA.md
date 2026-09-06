# Auditoría inicial — Migración Supabase a Firebase

**Proyecto:** Donaciones Venezuela  
**Fecha:** 2026-08-06  
**Alcance:** repositorio completo, código frontend, Edge Function, SQL, configuración, scripts de verificación y documentación.

## Estado ejecutivo

El proyecto no está preparado para un reemplazo directo de cliente. Es una aplicación estática vanilla desplegada en Vercel que concentra el contrato de datos en `services/api.js` y en una Edge Function Supabase de 2.180 líneas. La función implementa autenticación, autorización, límites de tasa, 65 acciones de negocio, almacenamiento de archivos, Telegram y consulta de tasas externas.

La migración es **Nivel 3 / riesgo alto** por la cantidad de reglas de negocio, datos personales, operaciones financieras, archivos privados y efectos secundarios. En esta fase no se modificó código de aplicación ni infraestructura.

No existe hallazgo crítico nuevo que obligue a detener la auditoría, pero la implementación queda bloqueada hasta definir proyecto Firebase, estrategia de build, respaldo verificable, reglas Firestore/Storage y plan de reversión.

## Inventario técnico

| Área | Evidencia actual | Impacto |
|---|---|---|
| Frontend | HTML/CSS/JS vanilla, sin `package.json` ni build | Introducir Firebase modular requiere decidir bundler o CDN |
| Hosting | Vercel estático, `vercel.json`, sin comando de build | Debe conservarse la salida estática y actualizar CSP |
| Datos | PostgreSQL/Supabase: 23 tablas, vistas, funciones, triggers, RLS e índices | Requiere rediseño documental para acceso por agregado en Firestore |
| API | `services/api.js` + `supabase/functions/api/index.ts` | El contrato HTTP tiene 65 acciones y debe preservarse para evitar regresiones |
| Auth | Supabase Auth email/password, sesión en `localStorage` (`dv-sesion`) | Migrar a Firebase Auth y `onAuthStateChanged`, sin copiar refresh tokens |
| Storage | 5 buckets, algunos privados, URLs firmadas y archivos públicos | Requiere reglas por propietario/rol y generación de URLs seguras |
| Integraciones | Telegram opcional, Remitly, dolarapi, WhatsApp, OpenStreetMap | Secretos y fallos deben aislarse en Cloud Functions |
| QA | Scripts Node/Python contra Supabase; no hay lint/build/test estándar | Hay que reemplazar checks y crear pruebas de contrato/emulador |

## Inventario Supabase

### Cliente, REST, RPC y Auth

| Archivo | Función o símbolo | Dependencias | Impacto |
|---|---|---|---|
| `services/api.js` | `config`, `assertConfigured`, `fetchJson` | `supabaseUrl`, `supabaseKey`, REST | Alto: fachada completa de lecturas y escrituras |
| `services/api.js` | `rest(view, query)` | `/rest/v1/` y vistas públicas | Alto: reemplazar por repositorios Firestore o API HTTP |
| `services/api.js` | `rpc(name,args)` | `estadisticas`, `buscar_familiar`, `seguimiento_factura`, `seguimiento_donaciones` | Alto: rediseñar consultas y agregados |
| `services/api.js` | `authPost`, `registrarse`, `iniciarSesion`, `refrescarSesion` | `/auth/v1/` | Alto: Firebase Auth |
| `services/api.js` | `requestPost` | `/functions/v1/api` | Alto: Cloud Function HTTP `api` |
| `js/core.js` | `SUPABASE_URL`, `SUPABASE_KEY` | Valor publicado y fallback hardcodeado | Alto: configuración Firebase y CSP |
| `supabase/functions/api/index.ts` | `createClient` | `@supabase/supabase-js`, Deno | Alto: reemplazar por Firebase Admin SDK |
| `supabase/functions/api/index.ts` | `supa.auth.getUser` | Supabase Auth | Alto: verificar ID token Firebase |

### Tablas, vistas y funciones SQL

Las 23 tablas base son: `config`, `rate_limit`, `lugares`, `insumos`, `centros_panel`, `voluntarios`, `rescatistas`, `motorizados`, `personas`, `vacantes_voluntarios`, `facturas`, `donaciones`, `movimientos_factura`, `evidencias`, `viajes`, `trayectos`, `entregas`, `donaciones_motorizados`, `historial_movimientos`, `familias_damnificadas`, `denuncias`, `tasas` y `auditoria_admin`.

Las vistas públicas o derivadas son: `lugares_directorio`, `traslados_sugeridos`, `facturas_public`, `historial_public`, `entregas_public`, `trayectos_public`, `donaciones_motorizados_public`, `denuncias_public`, `motorizados_public`, `voluntarios_public`, `rescatistas_public`, `vacantes_public`, `familias_public` y `viajes_atrasados`.

Las funciones/RPC detectadas son: `buscar_familiar`, `estadisticas`, `factura_numero_siguiente`, `rate_hit` (sobrecargas), `recalcular_recaudado`, `seguimiento_donaciones` y `seguimiento_factura`.

### Storage

| Bucket | Visibilidad actual | Usos detectados |
|---|---|---|
| `comprobantes` | Privado | Comprobantes de donación |
| `damnificados` | Privado | Fotos de familias/damnificados |
| `denuncias` | Privado | Video y adjuntos de denuncias |
| `presupuestos` | Público | Adjuntos de presupuestos con `getPublicUrl` |
| `registro-transportistas` | Privado | Fotos de registro, documentos y evidencia |

## Acciones de negocio de la Edge Function

Se detectaron 65 acciones: `acceso_perfil`, `admin_actualizar_vacante`, `admin_bitacora`, `admin_cerrar_factura`, `admin_crear_factura`, `admin_crear_presupuesto`, `admin_crear_vacante`, `admin_damnificado_estado`, `admin_damnificados`, `admin_datos_borrar`, `admin_datos_crear`, `admin_datos_deshacer`, `admin_datos_duplicados`, `admin_datos_editar`, `admin_datos_entidades`, `admin_datos_ficha`, `admin_datos_listar`, `admin_denuncia_crear`, `admin_denuncia_estado`, `admin_denuncias`, `admin_donacion_anular`, `admin_donaciones_presupuesto`, `admin_listar_facturas`, `admin_listar_necesidades`, `admin_listar_personas`, `admin_listar_rescatistas`, `admin_listar_vacantes`, `admin_listar_voluntarios`, `admin_presupuesto_comprado`, `admin_presupuesto_transferido`, `admin_presupuestos_por_comprar`, `admin_regenerar_panel`, `admin_registrar_donacion`, `admin_registrar_evidencia`, `admin_registrar_movimiento`, `admin_verificar_persona`, `admin_viaje_resolver`, `admin_viajes_atrasados`, `damnificado_registrar`, `denuncia_crear`, `denuncia_parcial`, `denuncias_listar`, `donar_dinero`, `donar_motorizado`, `donar_necesidad`, `listar_comprados`, `listar_ofertas`, `listar_presupuestos`, `ofrecer_insumo`, `panel_actualizar_lugar`, `panel_crear`, `panel_insumo`, `panel_insumo_borrar`, `panel_ver`, `recoger_oferta`, `registrar_entrega_final`, `registrar_lugar`, `registrar_motorizado`, `registrar_recogida`, `registrar_rescatista`, `registrar_trayecto`, `registrar_voluntario`, `reportar_persona`, `reserva_detalle` y `viaje_iniciar`.

## Hallazgos y riesgos

1. **Alto — contrato grande y centralizado.** Cambiar cada llamada en el frontend a la vez aumenta la superficie de regresión. Se recomienda conservar temporalmente el contrato de acciones detrás de una fachada nueva, con pruebas de contrato, y migrar repositorios por dominio.
2. **Alto — datos personales y financieros.** Familias, documentos, denuncias, comprobantes, PINs y movimientos exigen reglas explícitas, minimización y auditoría en Firebase.
3. **Alto — concurrencia.** Numeración de facturas, reservas, cupos y recaudación no pueden usar lecturas/escrituras separadas. Requieren transacciones o escrituras por lote de Firestore.
4. **Alto — autenticación administrativa.** Hoy existe una clave administrativa enviada en el cuerpo, hash almacenado en `config`, rate limit y CORS `*`. En Firebase se debe usar Auth + claims/roles y dejar secretos únicamente en Functions.
5. **Medio — estrategia de frontend.** El repositorio prohíbe npm/CDN, pero la documentación oficial de Firebase recomienda SDK modular con npm y bundler para producción ([Firebase Web setup](https://firebase.google.com/docs/web/setup)). Esto requiere una decisión explícita de arquitectura.
6. **Medio — almacenamiento.** Hay buckets privados, URLs firmadas, un bucket público y límites MIME/tamaño implementados en código; deberán duplicarse en Storage Rules y Functions.
7. **Medio — QA insuficiente.** No hay runner común de lint/build/tests. Los scripts existentes apuntan directamente a Supabase y deben migrarse a Emulator Suite/Functions.
8. **Medio — documentación contradictoria.** `PRODUCT.md`, `REGLAS.md`, `README*`, `CLAUDE.md` y varios planes describen Supabase como definitivo. Deben actualizarse después de la decisión técnica, no antes.
9. **Medio — adopción Cronos.** La adopción local modificó `.gitignore` y `AGENTS.md`; se debe revisar que no se hayan perdido exclusiones de credenciales antes de hacer commit.

## Archivos de configuración que deben cambiar en una futura fase

`services/api.js`, `js/core.js`, `js/entorno.js`, `vercel.json`, `ventana.html`, `index.html`, scripts de verificación, `supabase/functions/api/index.ts`, SQL/migraciones y documentación Supabase. La configuración local Firebase y los adaptadores `src/firebase/` se añadieron después del checkpoint; estos todavía no sustituyen el contrato de datos en producción.

## Decisiones pendientes del operador

- ID del proyecto Firebase de desarrollo, staging y producción.
- Aprobación de añadir `package.json` y un build mínimo (recomendado) o excepción documentada para módulos CDN.
- Fuente de verdad y formato del respaldo Supabase antes de cargar datos.
- Política de roles: custom claims, colección de perfiles o ambos.
- Retención y visibilidad de denuncias, fotos, comprobantes y datos familiares.
- Ventana de migración, rollback y criterio de corte.
