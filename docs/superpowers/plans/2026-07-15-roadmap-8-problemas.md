# Roadmap — 8 problemas de «Funcionalidad de la app donaciones.txt»

Fuente: `Funcionalidad de la app donaciones.txt` (Drive, 2026-07-14). Cada problema
tiene su plan en `docs/superpowers/plans/2026-07-15-plan-0N-*.md`, pensado para
ejecutarse con **/build-loop** (uno por corrida, en orden).

## Objetivo transversal (aplica a TODOS los planes)

> **Transparencia automática**: cada paso que da un voluntario, transportista o
> centro escribe un movimiento codificado (`mov(codigo, datos)` en la edge fn,
> patrón R1.5) para que el donante vea, sin que nadie escriba nada a mano,
> **cuál fue la última actualización del insumo y dónde está** en el transporte.
>
> **Versión de prueba**: decidido con Luis (2026-07-15) — datos semilla ficticios
> **más** un botón de simulación (visible solo con `?dev=1`, misma puerta que
> `editAssistantDisponible()`) que avanza los pasos de un viaje solo. Nada de esto
> se ve en modo público.

## Decisiones fijadas (grill-me 2026-07-15)

| # | Decisión | Respuesta de Luis |
|---|---|---|
| D1 | Simulación | **Ambas**: semilla + botón demo (solo `?dev=1`) |
| D2 | AWS SES | Cuenta AWS **sí**, **sin dominio** → verificar email remitente + production access + SES como SMTP de Supabase Auth |
| D3 | Denuncias públicas | Video + **fecha, hora y coordenadas del punto exacto**; la identidad del denunciante solo la ve el admin |
| D4 | Alerta extravío >2h | **Panel + correo** (cron pg_cron → edge fn → SES) |

> **Revisión 2026-07-17**: los 8 planes fueron profundizados requisito a
> requisito contra el .txt (cada plan lleva ahora la cita literal del problema
> y una tabla de trazabilidad requisito→tarea). Descubrimientos que cambiaron
> los planes: la sesión de `#acceso` ya se guarda pero en `sessionStorage`
> sin tokens y **rechaza al usuario sin roles** (el donante — lo corrige el
> plan 02 T3); las ofertas **ya guardan coords y centro sugerido** en su meta
> (plan 07 aprovecha); `recoger_oferta` hoy cierra la factura de golpe (plan
> 07 la convierte en ciclo Ofrecida→EnCamino→Recogida→Entregada); el ciclo y
> los presupuestos viven como meta JSON en `facturas.descripcion` (plan 08
> extiende ese JSON, cero migraciones de columnas); la tabla nueva `viajes`
> (plan 06) concentra ETA/GPS/km/alertas.

## Estado y orden de ejecución

| Orden | Plan | Problema | Estado actual | Depende de |
|---|---|---|---|---|
| 1 | plan-02-iniciar-sesion | 2 | **Parcial** — OTP Supabase Auth ya vive en `#acceso` (`/auth/v1/otp` + `acceso_perfil`); falta botón en la barra, persistir sesión y nombre visible | — |
| 2 | plan-05-aws-ses | 5 | **Config, no código** — Supabase ya manda los códigos; SES solo quita el límite de ~2-4 correos/hora. Mayormente pasos manuales de Luis en la consola AWS | Puede ir en paralelo; el *production access* tarda ~24 h, pedirlo temprano |
| 3 | plan-03-registrar-voluntario | 3 | **Parcial** — wizard ya existe; la cédula es `<input type="file">` (`index.html:529`); título y «ciudad→parroquia» son cambios de claves; «no funciona» por diagnosticar | — |
| 4 | plan-04-crear-centro | 4 | **Parcial** — flujo existe en `js/panel.js` (`campoFoto('pc-cedula')` = file input); wizard roto por diagnosticar | Reusa la guía de cédula del plan 03 |
| 5 | plan-01-denuncias | 1 | **Nuevo** — no existe nada (grep «denuncia» = 0) | Plan 02 (requiere sesión) |
| 6 | plan-06-proceso-transportista | 6 | **Parcial** — trayecto/recogida/entrega existen con wizard+cámara; faltan mapa, ETA, GPS/hora por paso, km y foto de la persona | Plan 02 |
| 7 | plan-07-voy-a-recogerla | 7 | **Parcial** — `abrirRecogerOferta` (`js/admin.js:861`) pide el nombre a mano; faltan autollenado por sesión, mapa, estado «en camino», alerta >2h y denuncia desde admin | Planes 02, 06, 01; correo usa 05 |
| 8 | plan-08-administracion | 8 | **Parcial** — presupuestos ya existen (`admin_crear_presupuesto`, campo presentación bilingüe); faltan Track Donation, atar presupuesto a necesidades del centro, mapa de tienda, adjunto | Plan 01 (estado «con denuncia») |

## Cómo se corre cada plan con /build-loop

1. Materiales de la corrida = el plan + `REGLAS.md` + este roadmap.
2. En F2 (/reglas-loop), usar las reglas propuestas al final de cada plan
   (todas verificables; los scripts de chequeo ya existen en `scripts/`).
3. Recordatorios de jaula: el hook deniega Bash con `>`/`2>&1` hacia rutas
   absolutas → toda redirección vive dentro de scripts del workspace; nunca
   escribir en la base de PRODUCCIÓN desde tests (patrón: monkeypatch de
   `window.SheetsService.post` que captura y lanza).
4. Al cerrar cada corrida: `verificar-idioma.py` exit 0, `e2e-idioma.js` ok:true,
   versión `?v=`/`VERSION` subida (R5.4), commit como **Luismadef45** y push a
   `origin` (R5.5).

## Referencias UX (Mobbin, 2026-07-15)

- **Transportista (planes 06/07)**: Shopee «Kirim Instant» — mapa arriba, barra
  de 4 etapas (recogida→camino→entrega→recibido), ETA visible, datos del viaje
  debajo. foodpanda — al entregar, «el repartidor dejó una foto del sitio».
- **Denuncias (plan 01)**: Citizen — mapa + ubicación actual + botón grande de
  cámara; Kino/Edits — grabación: visor a pantalla completa, disparador grande
  centrado abajo (coincide con R3.3), cronómetro visible arriba.
