# Estabilizacion y Release Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar Respuesta Humanitaria Venezuela desde la fase actual de estabilizacion hasta una release verificable, manteniendo las donaciones manuales con comprobante y sin pasarela de pago.

**Architecture:** Se conserva el frontend estatico vanilla servido por Vercel, Supabase como unica fuente de datos, PostgREST/RPC para lecturas publicas y la edge function `api` para escrituras. El trabajo se ejecuta en orden: primero coherencia local y despliegue, despues seguridad y datos, luego QA y documentacion.

**Tech Stack:** HTML/CSS/JavaScript vanilla, Supabase Postgres + RLS + Edge Function Deno/TypeScript, Vercel, scripts Node/Python sin dependencias.

## Global Constraints

- No agregar npm, frameworks, bundler, CDN ni dependencias nuevas.
- Toda escritura pasa por `supabase/functions/api/index.ts`; el cliente no escribe tablas directamente.
- Todo valor interpolado en `innerHTML` pasa por `e()`.
- Todo texto visible nuevo se agrega a `locales/es.json` y `locales/en.json`.
- Al tocar assets, `index.html`, `ventana.html` y `sw.js` deben compartir la misma version.
- No ejecutar migraciones destructivas sin backup verificado y rollback documentado.
- No usar datos reales para pruebas; las pruebas de escritura usan filas `ZZTEST` y limpian al final.
- Las donaciones de dinero siguen siendo manuales: comprobante privado, validacion administrativa y cambio de estado; no se construye pasarela.
- No declarar produccion lista sin verificar Vercel, Supabase, edge function, navegador movil y navegador escritorio.

---

### Task 1: Cerrar la release local v106

**Files:**
- Modify: `ventana.html:20`
- Modify: `sw.js:13-23`
- Review: `css/app.css`, `index.html`, `locales/es.json`, `locales/en.json`, `ventana.html`, `sw.js`

**Interfaces:**
- Consumes: los seis cambios locales existentes y los modulos declarados por `index.html` y `ventana.html`.
- Produces: worktree coherente, assets versionados a `106` y service worker capaz de precachear los modulos de admin.

- [ ] **Step 1: Registrar el estado antes de tocar nada**

```powershell
git status --short
git diff --stat
git diff --check
```

Esperado: identificar explicitamente los seis archivos modificados. No borrar ni revertir archivos no relacionados.

- [ ] **Step 2: Alinear el CSS de `ventana.html`**

Cambiar solamente `css/app.css?v=105` a `css/app.css?v=106` en `ventana.html`. No cambiar rutas ni orden de scripts.

- [ ] **Step 3: Completar el precache PWA**

En `sw.js`, despues de `'/js/admin.js' + V`, agregar:

```js
  '/js/admin-datos.js' + V, '/js/admin-personas.js' + V, '/js/admin-centros.js' + V,
```

- [ ] **Step 4: Verificar versionado y referencias**

```powershell
python scripts/verificar-idioma.py
$files = Get-ChildItem js -Filter '*.js' -File
foreach ($file in $files) { node --check $file.FullName }
node --check services/api.js
git diff --check
```

Ademas, comprobar que `index.html`, `ventana.html` y `sw.js` solo usan `v106`/`VERSION = '106'`, y que todas las referencias locales existen.

- [ ] **Step 5: Revisar el diff para commit**

Confirmar que los cambios son solo: areas tactiles, categorias nuevas, version 106, precache y sus locales. No incluir `graphify-out/`, `opencode.json` ni `.agencia-version` en el commit de la app.

---

### Task 2: Verificar despliegue y contrato de produccion

**Files:**
- Review: `README.md`, `vercel.json`, `supabase/functions/api/index.ts`
- Record result: `docs/superpowers/plans/2026-08-04-plan-09-estabilizacion-release.md` or release notes

**Interfaces:**
- Consumes: `DV_PUBLISHABLE_KEY` desde un gestor seguro y el commit aprobado.
- Produces: evidencia fechada de Vercel, Supabase REST y edge function alineados.

- [ ] **Step 1: Verificar resolucion DNS y Vercel**

```powershell
Resolve-DnsName donacionesvenezuela.vercel.app
Invoke-WebRequest https://donacionesvenezuela.vercel.app/ -UseBasicParsing
Invoke-WebRequest https://donacionesvenezuela.vercel.app/ventana.html -UseBasicParsing
Invoke-WebRequest https://donacionesvenezuela.vercel.app/sw.js -UseBasicParsing
```

Esperado: HTTP 200, scripts en `v106` y `VERSION = '106'`.

- [ ] **Step 2: Verificar lectura publica de Supabase**

```powershell
$headers = @{ apikey = $env:DV_PUBLISHABLE_KEY; Authorization = "Bearer $env:DV_PUBLISHABLE_KEY" }
Invoke-WebRequest 'https://zryfwbjvlacorryzdaod.supabase.co/rest/v1/lugares_directorio?select=nombre&limit=1' -Headers $headers -UseBasicParsing
```

Esperado: JSON valido con cero secretos y al menos una fila o un estado vacio valido.

- [ ] **Step 3: Verificar que la edge function desplegada coincide con el repo**

Desde el panel o CLI de Supabase, registrar version activa, fecha de despliegue y hash/commit asociado. Confirmar que contiene `reserva_detalle`, `admin_datos_borrar`, la validacion de reserva viva y el prefijo `admin_`.

- [ ] **Step 4: Guardar evidencia de release**

Registrar URL, HTTP status, version frontend, version edge function, commit y hora UTC. Si DNS falla, marcar el release como bloqueado; no sustituirlo por una suposicion.

---

### Task 3: Normalizar migraciones, backup y rollback

**Files:**
- Review: `supabase/migrations/20260101000000_esquema_base.sql`
- Review: `supabase/migrations/20260101000001_esquema_vistas.sql`
- Review: `supabase/migraciones-historicas/README.md`
- Create: `supabase/OPERACION.md`

**Interfaces:**
- Consumes: introspeccion del proyecto Supabase de produccion.
- Produces: fuente de verdad de esquema, matriz repo/produccion y rollback manual probado o documentado.

- [ ] **Step 1: Exportar el inventario real sin datos sensibles**

Obtener en Supabase nombres de tablas, columnas, vistas, RPCs, indices, RLS, grants y version de la edge function. No guardar dumps con filas, hashes ni secretos en el repo.

- [ ] **Step 2: Comparar el inventario con las dos migraciones base**

Comparar especialmente `archivado_at`, `auditoria_admin`, `rate_limit`, `rescatistas_public`, buckets, triggers y funciones `seguimiento_factura`/`recalcular_recaudado`.

- [ ] **Step 3: Confirmar backup antes de cualquier cambio**

Registrar fecha, alcance y resultado de restauracion del backup. Si no existe backup verificable, detener toda migracion de produccion.

- [ ] **Step 4: Documentar rollback**

En `supabase/OPERACION.md`, documentar para cada migracion: precondiciones, sentencia de rollback, efecto sobre datos, orden de re-aplicacion y como comprobar consistencia si falla a mitad.

- [ ] **Step 5: Definir la fuente de verdad**

Elegir una sola estrategia: migraciones incrementales aplicables por CLI o snapshot reconstruido de produccion. La estrategia elegida debe quedar escrita y no mezclar archivos historicos aplicables con archivos de referencia.

---

### Task 4: Resolver la politica de datos publicos

**Files:**
- Review: `supabase/migrations/20260101000001_esquema_vistas.sql:271-287`
- Review: `security_best_practices_report.md:64-70`
- Modify: nueva migracion con timestamp `20260804000000_politica_datos_publicos.sql`, solo despues de decidir la politica
- Modify: `README.md`, `README-ARQUITECTURA.md` y `security_best_practices_report.md`

**Interfaces:**
- Consumes: decision del propietario sobre telefono de rescatistas, telefono de transportistas y GPS de denuncias.
- Produces: vistas publicas y documentacion coherentes con esa decision.

- [ ] **Step 1: Elegir politica por dato**

Registrar como `publico`, `aproximado` o `privado` cada uno: telefono de rescatistas, telefono de transportistas, GPS de denuncias, video de denuncias y datos de familias.

- [ ] **Step 2: Aplicar solo la politica elegida**

Si un dato pasa a privado, quitarlo de la vista publica, revocar acceso anon donde corresponda y servirlo solo por una accion autenticada o admin. Si permanece publico, documentar la razon de coordinacion de emergencia.

- [ ] **Step 3: Probar el contrato anonimo**

Consultar cada vista publica con `DV_PUBLISHABLE_KEY` y comprobar que no devuelve columnas privadas. Probar tambien que `auditoria_admin`, tablas base y buckets privados siguen rechazando acceso anonimo.

- [ ] **Step 4: Actualizar la documentacion**

Eliminar contradicciones entre el SQL, `README.md`, `README-ARQUITECTURA.md` y el informe de seguridad.

---

### Task 5: Endurecer acceso administrativo

**Files:**
- Modify: configuracion de secretos de Supabase, fuera del repo
- Review/Modify: `supabase/functions/api/index.ts:290-304`
- Review: `js/admin.js:15-17`
- Modify: `security_best_practices_report.md`

**Interfaces:**
- Consumes: acceso de operador a Supabase y una ventana de mantenimiento.
- Produces: clave admin rotada, proteccion de contraseñas filtradas y decision documentada sobre JWT admin.

- [ ] **Step 1: Rotar `ADMIN_KEY`**

Generar una clave nueva fuera del repo, actualizar el hash/configuracion del servidor, cerrar sesiones admin abiertas y comprobar una accion valida y una invalida.

- [ ] **Step 2: Activar leaked-password protection**

En Supabase Authentication, activar la proteccion contra contraseñas filtradas. Comprobar que cuentas existentes confirmadas siguen entrando.

- [ ] **Step 3: Probar bloqueo anti-fuerza-bruta**

Ejecutar 11 intentos invalidos desde una IP de prueba y comprobar rechazo posterior; no usar la clave real en logs ni scripts.

- [ ] **Step 4: Decidir JWT admin**

Si se adopta, implementar `admin_login` con JWT firmado y expiracion corta, sustituir el envio repetido de la clave y probar expiracion/revocacion. Si se pospone, registrar formalmente el riesgo aceptado y la fecha de revision.

---

### Task 6: Cerrar el alcance de la consola de datos

**Files:**
- Review: `docs/superpowers/specs/2026-07-25-consola-datos-admin-design.md:198-221`
- Review: `supabase/functions/api/index.ts:1915-1932`
- Review: `supabase/migrations/20260101000001_esquema_vistas.sql:239-315`
- Modify: `docs/superpowers/plans/2026-08-04-plan-09-estabilizacion-release.md`

**Interfaces:**
- Consumes: decision de release sobre el Grupo B.
- Produces: Plan 2 implementado y probado, o alcance retirado de la release y documentado como backlog.

- [ ] **Step 1: Decidir si Grupo B entra en esta release**

Grupo B incluye facturas, donaciones, movimientos, evidencias, viajes, trayectos, denuncias, familias, historial y entregas.

- [ ] **Step 2: Si entra, definir archivado seguro**

Agregar acciones `admin_archivar`, `admin_restaurar` y `admin_purgar`, filtrar `archivado_at` en vistas/RPC y auditar cada cambio. La purga requiere segunda confirmacion y backup.

- [ ] **Step 3: Si no entra, retirar falsas promesas**

Marcar Plan 2 como backlog fuera de release, evitar que la UI prometa papelera/restauracion y dejar el riesgo documentado.

- [ ] **Step 4: Ejecutar prueba de contrato**

Archivar un registro `ZZTEST`, comprobar que desaparece de vistas publicas y seguimiento, restaurarlo, comprobar que vuelve y purgarlo solo despues del backup.

---

### Task 7: Documentar el flujo manual de donaciones

**Files:**
- Create: `docs/procedimiento-donaciones-manuales.md`
- Modify: `README.md`, `guia-usuario.html`, `README-ARQUITECTURA.md`
- Review: `js/admin.js`, `supabase/functions/api/index.ts`

**Interfaces:**
- Consumes: acciones actuales `donar_dinero`, `admin_registrar_donacion`, `admin_presupuesto_transferido` y `admin_presupuesto_comprado`.
- Produces: procedimiento operativo para donante y admin, sin prometer cobro automatico.

- [ ] **Step 1: Documentar el recorrido del donante**

Seleccionar necesidad, consultar datos de transferencia, enviar comprobante, conservar token `DV-` y consultar el seguimiento.

- [ ] **Step 2: Documentar el recorrido admin**

Revisar comprobante privado, validar monto/referencia, marcar `Registrada` o `Confirmada`, gestionar `PorComprar`, `Transferida` y `Comprada`, y adjuntar evidencias publicas sin PII.

- [ ] **Step 3: Documentar excepciones**

Comprobante ilegible, monto incorrecto, duplicado, donacion anulada, factura reabierta y evidencia privada. Cada caso debe terminar en un estado visible y una accion concreta.

- [ ] **Step 4: Verificar que no hay lenguaje de pasarela**

Buscar `pago automatico`, `checkout`, `tarjeta` y textos equivalentes en UI/documentacion; sustituirlos por instrucciones manuales si generan una promesa falsa.

---

### Task 8: Ejecutar pruebas de backend y limpiar datos

**Files:**
- Test: `scripts/verificar-v01-reserva.mjs`
- Test: `scripts/verificar-v02-identidad.mjs`
- Test: `scripts/verificar-v03-contacto.mjs`
- Test: `scripts/verificar-admin-datos.mjs`

**Interfaces:**
- Consumes: variables seguras `ANON`, `ADMINKEY`, `EMAIL_A`, `PASS_A`, `EMAIL_B`, `PASS_B`, `EMAIL_C`, `PASS_C` solo en el entorno de ejecucion.
- Produces: salida verde y base sin filas/objetos `ZZTEST`.

- [ ] **Step 1: Ejecutar pruebas de sintaxis e idioma**

```powershell
python scripts/verificar-idioma.py
foreach ($file in (Get-ChildItem js -Filter '*.js' -File)) { node --check $file.FullName }
```

- [ ] **Step 2: Ejecutar V01, V02 y V03 contra un entorno permitido**

Usar las variables desde un gestor seguro. No pegar credenciales en el plan, terminal compartida ni logs.

- [ ] **Step 3: Ejecutar las pruebas de consola admin**

Comprobar permisos, lista blanca, validacion, duplicados, bitacora, deshacer, borrado y cascadas.

- [ ] **Step 4: Ejecutar casos adversariales**

Probar XSS en nombre/insumo/factura, `pin_hash` editable, `monto_recaudado` editable, entidad `config`, panel de un centro sobre otro, evidencia privada y 11 claves admin invalidas.

- [ ] **Step 5: Limpiar filas y objetos de prueba**

Eliminar filas `ZZTEST`, entradas de `auditoria_admin` asociadas y objetos de Storage creados por pruebas. Verificar conteos cero antes de liberar.

---

### Task 9: Ejecutar QA E2E y rendimiento

**Files:**
- Test: `scripts/e2e-idioma.js`
- Review: `scripts/e2e-idioma.md`
- Review: `REGLAS.md:142-154`

**Interfaces:**
- Consumes: servidor local y, despues, URL de produccion verificada.
- Produces: matriz fechada de QA en 390px y 1440px, español/ingles, consola limpia y Lighthouse.

- [ ] **Step 1: Levantar servidor local**

```powershell
python -m http.server 8141 --bind 127.0.0.1
```

- [ ] **Step 2: Recorrer vistas publicas**

Probar inicio, centros, necesidades, voluntariado, transportistas, rescatistas, familiar, seguimiento, ofrecer insumo, donar dinero, denuncias, registro de familia, viaje y panel.

- [ ] **Step 3: Recorrer admin**

Probar crear/listar factura, registrar comprobante, compra, personas, vacantes, datos, duplicados, deshacer y viajes atrasados.

- [ ] **Step 4: Repetir idioma en caliente**

Abrir cada vista en español, llenar parcialmente un formulario, cambiar a ingles y confirmar que no se pierde texto, foto, coordenada ni estado.

- [ ] **Step 5: Medir rendimiento**

Ejecutar Lighthouse en rutas publicas y formularios a 390px y escritorio. Registrar Performance, Accessibility, Best Practices y errores de consola.

---

### Task 10: Crear la fuente operativa de fases

**Files:**
- Create: `docs/FASES.md`
- Create: `docs/RELEASE-CHECKLIST.md`
- Modify: `README.md`, `README-ARQUITECTURA.md`, `security_best_practices_report.md`

**Interfaces:**
- Consumes: resultados de Tasks 1-9.
- Produces: una unica fase activa, backlog priorizado y criterios de salida fechados.

- [ ] **Step 1: Registrar fases vigentes**

Usar estas fases: alcance manual, coherencia local, seguridad, datos/migraciones, integracion, QA, release y operacion.

- [ ] **Step 2: Registrar criterios de entrada y salida**

Cada fase debe indicar evidencia requerida, responsable, bloqueo actual y enlace a la prueba o comando que la cierra.

- [ ] **Step 3: Marcar planes historicos**

Marcar como `cerrado`, `parcial`, `pendiente` o `fuera de alcance` los planes antiguos; no usar casillas historicas abiertas como si fueran automaticamente trabajo activo.

- [ ] **Step 4: Mantener un solo backlog**

Eliminar duplicados entre documentos y conservar las decisiones: donacion manual con comprobante, sin pasarela en esta release.

---

### Task 11: Gate final de release

**Files:**
- Review: todos los archivos modificados por Tasks 1-10
- Record: `docs/RELEASE-CHECKLIST.md`

- [ ] **Step 1: Confirmar worktree y commit aprobado**

No debe haber cambios inesperados, secretos, artefactos de auditoria ni archivos de configuracion de agente en el commit de la app.

- [ ] **Step 2: Confirmar produccion**

Vercel, Supabase REST, edge function, headers, CSP, versiones PWA y dominio deben responder correctamente.

- [ ] **Step 3: Confirmar seguridad**

No deben existir endpoints anonimos con PII no aprobada, bypass de admin/panel, evidencias privadas publicas ni secretos en el cliente.

- [ ] **Step 4: Confirmar QA**

La matriz movil/escritorio, español/ingles, flujos manuales de donacion y consola deben tener evidencia verde y consola sin errores.

- [ ] **Step 5: Publicar release**

Solo despues de los cuatro gates anteriores, hacer commit/push y registrar URL, commit, versiones, fecha y riesgos aceptados.

---

## Criterio de salida

La release queda lista cuando el flujo manual de donacion con comprobante esta documentado y probado, el worktree y las versiones estan alineados, produccion coincide con el commit aprobado, los datos publicos cumplen la politica elegida, las pruebas adversariales pasan, no quedan datos `ZZTEST` y existe evidencia fechada de QA movil/escritorio.
