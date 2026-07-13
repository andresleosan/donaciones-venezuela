(function () {
  'use strict';

  let deferredPrompt = null;
  let standalone = false;

  function $(selector) { return document.querySelector(selector); }
  function tx(key, fallback, params) {
    return typeof window.t === 'function' ? window.t(key, params) : String(fallback).replace(/\{(\w+)\}/g, (_, name) => params && params[name] != null ? params[name] : '');
  }

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function estaInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function renderEstado() {
    const card = $('#pwa-install-card');
    if (!card) return;
    standalone = estaInstalada();
    const online = navigator.onLine;
    const status = $('#pwa-connection-status');
    const badge = $('#pwa-availability-badge');
    const install = $('#pwa-install-btn');
    const iosHelp = $('#pwa-ios-help');
    const queueStatus = $('#pwa-queue-status');
    const title = $('#pwa-card-title');
    const copy = $('#pwa-card-copy');
    const installLabel = $('#pwa-install-btn');
    const iosText = $('#pwa-ios-help');
    if (title) title.textContent = tx('pwa.title', 'Usa la app sin conexión');
    if (copy) copy.textContent = tx('pwa.copy', 'La información pública se guarda para consultarla sin internet y los formularios pendientes se envían al volver la conexión.');
    if (installLabel) installLabel.textContent = tx('pwa.install', 'Instalar aplicación');
    if (iosText) iosText.textContent = tx('pwa.ios', 'En iPhone o iPad: abre Compartir y elige “Añadir a pantalla de inicio”.');
    card.dataset.state = standalone ? 'installed' : (online ? 'online' : 'offline');
    if (status) status.textContent = online ? tx('pwa.online', 'Con conexión · tus datos se sincronizan') : tx('pwa.offline', 'Sin conexión · trabajando con datos guardados');
    if (badge) badge.textContent = tx('pwa.availability', 'Disponible sin conexión');
    if (standalone) {
      card.hidden = true;
    } else {
      card.hidden = false;
      if (install) install.hidden = !deferredPrompt;
      if (iosHelp) iosHelp.hidden = !esIOS();
    }
    if (queueStatus && window.SheetsService && typeof window.SheetsService.getQueueCount === 'function') {
      window.SheetsService.getQueueCount().then((count) => {
        queueStatus.textContent = count ? tx('pwa.pendingCount', '{count} formulario(s) pendiente(s) de enviar', { count }) : '';
      }).catch(() => {});
    }
  }

  function configurarInstalacion() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      renderEstado();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      renderEstado();
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('#pwa-install-btn');
      if (!button || !deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) { /* el usuario puede cerrar el diálogo */ }
      deferredPrompt = null;
      renderEstado();
    });
  }

  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, { once: true });
  }

  function iniciar() {
    configurarInstalacion();
    registrarServiceWorker();
    renderEstado();
    window.addEventListener('online', renderEstado);
    window.addEventListener('offline', renderEstado);
    window.addEventListener('dv-offline-change', renderEstado);
    window.addEventListener('dv-language-change', renderEstado);
    window.setTimeout(renderEstado, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
