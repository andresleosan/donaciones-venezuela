# Rediseño del Admin — objetivo del loop y reglas de aceptación

**Origen:** `/critica-de-diseno` + `/impeccable` + `/build-loop` (2026-07-12). Luis delegó:
"logra por ti mismo el objetivo más cercano a lo que pedí, constrúyelo hasta que
funcione de la manera ideal, cierra el loop y haz el commit."

## Decisiones fijadas (respuestas de Luis)
- **Alcance:** TODO el admin por pasos (cada tarea de creación = su propio asistente).
- **Superficie:** vista de pantalla completa (`#admin`), no modal.
- **Materiales:** el video de YouTube no fue accesible desde el VPS; las condiciones
  se fundan en el patrón canónico de formularios multi-paso + referencias reales de
  Mobbin (Glide multi-step form: "Step 2 of 3", una sección por paso, Continuar/Atrás,
  paso Confirmar; Retool stepped container: stepper numerado 1→2→3, Previous/Next).

## Objetivo (síntesis)
Rediseñar el módulo admin como una **consola de pantalla completa** donde el admin
elige una tarea y la completa mediante un **asistente por pasos** con **barra de
progreso superior**, avanzando **un grupo de datos a la vez** (Atrás/Siguiente), con
un **paso final de confirmación** que resume antes de enviar y un **estado de éxito**
con los datos generados (nº de factura, token, referencia) copiables.

- **Crear** (asistentes por pasos): Registrar donación (flagship: dinero no atado a un
  insumo), Crear presupuesto, Publicar vacante.
- **Gestionar** (paneles de revisión rediseñados, acciones puntuales): Facturas + sus
  operaciones (donación/movimiento/evidencia/cerrar), Vacantes abiertas, Personas por
  verificar, Rescatistas (solo lectura), Regenerar panel de centro.

## Reglas de aceptación (verificables — PASA/NO PASA)
1. **Superficie:** `#admin` es una vista full-screen; auth por clave admin primero;
   tras autenticar se ve la consola. No es un `<dialog>`.
2. **Barra de progreso superior:** cada asistente muestra un stepper horizontal arriba,
   con paso actual resaltado (`aria-current`) y completados marcados; refleja progreso real.
3. **Un paso a la vez:** solo un paso visible; Atrás (off en paso 1) y Siguiente; el
   último es Confirmar.
4. **Validación por paso:** Siguiente no avanza con requeridos vacíos/ inválidos;
   error inline.
5. **Confirmación:** el paso final resume todo lo ingresado antes de enviar.
6. **Éxito accionable:** tras enviar, estado de éxito con datos generados copiables +
   "empezar otra tarea".
7. **Flagship donación no asignada:** asistente que crea/elige el objetivo y registra
   la donación de dinero no atada a insumo, terminando con nº+token; payloads
   `admin_crear_factura` + `admin_registrar_donacion` correctos.
8. **Paridad funcional:** TODAS las acciones admin actuales siguen disponibles y
   funcionando; ninguna se pierde.
9. **Diseño (rúbrica critica-de-diseno):** tokens Stripe existentes (sin hex nuevos
   inventados), contraste AA, sin baneos impeccable (side-stripes, gradient text,
   eyebrows por doquier), responsive 390/1440 sin overflow, motion con
   `prefers-reduced-motion`. Veredicto PASA.
10. **i18n es/en/fr** para todo texto nuevo; sin claves crudas visibles.
11. **Sin errores de consola** y sin regresiones en otras vistas.
12. **Versiones + seguridad:** subir `?v=`; adminKey por acción; `e()` en toda
    interpolación; sin secretos expuestos.

## Cierre del loop
PASA ⟺ 12/12 reglas verificadas (incluye veredicto de diseño PASA y E2E de la donación
flagship). Al PASAR: commit + push. Mientras alguna falle: iterar.
