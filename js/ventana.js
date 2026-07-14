// Página-cascarón: cada "ventana" (antes un modal <dialog>) es ahora su propia
// URL. Reusa EXACTAMENTE los mismos módulos que index (core/vistas/panel/admin),
// así que los assets ya vienen de caché → carga rápido. Sólo cambia cómo se
// presenta (página completa, sin ventana flotante) y a dónde vuelve al cerrar.
'use strict';

    // 1) abrirModal → render de página completa (sin top-layer, sin backdrop).
    //    Mantiene un <dialog open> para que los .close() existentes sigan
    //    funcionando; su evento close vuelve al inicio.
    window.abrirModal = function (titulo, contenido) {
      if (titulo) document.title = titulo;
      const root = document.getElementById('modal-root');
      root.innerHTML = '<dialog open class="ventana-dialog"><div class="modal-body">' + contenido + '</div></dialog>';
      root.querySelector('dialog').addEventListener('close', volverAlInicio);
    };

    // 2) toast → se guarda y lo muestra el inicio tras volver (el submit hace
    //    .close() y luego toast(); el evento close se despacha como tarea, así
    //    que el toast se guarda antes de navegar).
    window.toast = function (msg) {
      try { sessionStorage.setItem('ventana-toast', String(msg == null ? '' : msg)); } catch (e) { /* modo privado */ }
    };

    // 3) cargarTodo → no-op aquí: el inicio recarga datos frescos al volver, y
    //    así estas páginas no vuelven a bajar TODO el estado desde Supabase.
    window.cargarTodo = async function () {};

    function volverAlInicio() { window.location.href = '/'; }

    // ¿Qué ventana se pide? Primero la ruta limpia (/registrar-transportista),
    // si no, ?v=. Los parámetros (id, nombre, token) llegan por query.
    function ventanaSolicitada() {
      const params = new URLSearchParams(window.location.search);
      const path = window.location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
      const ruta = (path && path !== 'ventana') ? path : (params.get('v') || '');
      return { ruta: ruta, id: params.get('id') || '', nombre: params.get('nombre') || '', token: params.get('token') || '' };
    }

    document.addEventListener('DOMContentLoaded', async () => {
      await initI18n();
      const solicitud = ventanaSolicitada();
      const id = solicitud.id;
      // Sembrar el motorizado objetivo (id + nombre) para las ventanas que lo
      // necesitan, en vez de recargar todo el estado → carga rápido.
      if (id) estado.motorizados = [{ id: id, nombre: solicitud.nombre }];
      const rutas = {
        'registrar-transportista': function () { abrirRegistrarMotorizado(); },
        'apoyar-transportista': function () { abrirDonarMotorizado(id); },
        'trayectos': function () { abrirTrayectos(id); },
        'historial': function () { abrirHistorial(solicitud.nombre); },
        'crear-centro': function () { abrirCrearPanel(); },
        'panel-centro': function () { abrirPanelCentro(solicitud.token); },
        'admin': function () { abrirAdmin(); }
      };
      const abrir = rutas[solicitud.ruta];
      if (!abrir) { volverAlInicio(); return; }
      abrir();
    });
