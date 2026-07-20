// Pantalla de VIAJE del transportista (plan 06). Paso 1 «Voy a recogerlo»:
// barra de 3 etapas, mapa del destino y tiempo estimado de llegada. Al confirmar
// se toman GPS y hora — sin GPS no se inicia, porque ese punto es el origen de
// los kilómetros y de la vigilancia del viaje.
// Es una VISTA-PÁGINA (#viaje), no una ventana flotante: mismo patrón que
// #ofrecer / #donar-dinero / #mi-cuenta.
'use strict';

    // Etapas del ciclo. La actual se deduce del estado de la factura + si ya se
    // inició el viaje en esta sesión.
    function etapasViaje(activa) {
      const etapas = [t('trip.stage1'), t('trip.stage2'), t('trip.stage3')];
      return `<ol class="trip-stages" aria-label="${e(t('trip.stagesLabel'))}">${etapas.map((nombre, i) => {
        const estado = i < activa ? 'done' : (i === activa ? 'current' : 'todo');
        return `<li class="trip-stage is-${estado}"${i === activa ? ' aria-current="step"' : ''}>
          <span class="trip-stage-dot" aria-hidden="true">${i < activa ? '✓' : String(i + 1)}</span>
          <span class="trip-stage-name">${e(nombre)}</span></li>`;
      }).join('')}</ol>`;
    }

    // El destino sale del directorio de lugares (que sí trae lat/lng) cruzando
    // por nombre. La TIENDA de recogida hoy es solo texto, sin coordenadas: no
    // se inventa un punto, simplemente no se pinta (lo añade el plan 08).
    function destinoDelCentro(nombreCentro) {
      const lugares = (estado.lugares || []);
      const objetivo = String(nombreCentro || '').trim().toLowerCase();
      const l = lugares.find((x) => String(x.nombre || '').trim().toLowerCase() === objetivo);
      return (l && l.lat != null && l.lng != null) ? { lat: l.lat, lng: l.lng, nombre: l.nombre } : null;
    }

    function abrirViaje(pr, opciones) {
      const shell = $('#viaje-shell');
      if (!shell) return;
      const op = opciones || {};
      const etapa = op.etapa != null ? op.etapa : (pr.estado === 'Comprada' ? 0 : 1);
      const destino = destinoDelCentro(pr.centro);
      const sesion = (typeof sesionActual === 'function' && sesionActual()) || null;

      cambiarVista('viaje');
      if (!/^#viaje$/i.test(window.location.hash)) window.location.hash = '#viaje';

      const bloqueEta = etapa === 0 ? `
        <div class="field full">
          <label id="viaje-eta-label">${e(t('trip.etaQuestion'))}</label>
          <div class="segmented" role="group" aria-labelledby="viaje-eta-label">
            <button class="btn btn-soft btn-small" type="button" data-eta="30">${e(t('trip.eta30'))}</button>
            <button class="btn btn-soft btn-small" type="button" data-eta="60">${e(t('trip.eta60'))}</button>
            <button class="btn btn-soft btn-small" type="button" data-eta="120">${e(t('trip.eta120'))}</button>
            <button class="btn btn-soft btn-small" type="button" data-eta="otro">${e(t('trip.etaOther'))}</button>
          </div>
          <input id="viaje-eta-otro" class="of-ref-input" type="number" min="5" max="480" step="5"
                 placeholder="${e(t('trip.etaMinutesPh'))}" hidden />
        </div>
        <div class="field full">
          <label for="viaje-nombre">${e(t('cycle.driverName'))}</label>
          <input id="viaje-nombre" required autocomplete="name" value="${e((sesion && sesion.nombre) || '')}" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="button" id="viaje-iniciar">${e(t('trip.startCta'))}</button>
        </div>` : `
        <p class="meta">${e(t('trip.onTheWay'))}</p>
        <div class="form-actions">
          <button class="btn btn-primary" type="button" id="viaje-tengo">${e(t('trip.haveItCta'))}</button>
        </div>`;

      shell.innerHTML = `
        ${etapasViaje(etapa)}
        <p class="section-copy">${e(t('trip.intro', { insumo: mostrarInsumo(pr.insumo), tienda: pr.tienda, centro: pr.centro }))}</p>
        <p class="meta"><strong>${e(t('cycle.pickupAt'))}</strong> ${e(pr.tienda)}${pr.direccion ? ' · ' + e(pr.direccion) : ''}</p>
        <p class="meta"><strong>${e(t('cycle.deliverTo'))}</strong> ${e(pr.centro)}</p>
        ${destino ? '<div id="viaje-mapa" class="of-mapa"></div>' : `<p class="meta">${e(t('trip.noMap'))}</p>`}
        ${bloqueEta}
        <div id="viaje-message" class="form-message" role="status" aria-live="polite"></div>`;

      // Mapa: destino siempre; el punto del transportista se añade cuando el GPS
      // responde, y entonces se traza la línea entre ambos.
      let mapa = null, marcadorYo = null, linea = null;
      if (destino && window.L) {
        mapa = L.map('viaje-mapa').setView([destino.lat, destino.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
        L.marker([destino.lat, destino.lng]).addTo(mapa).bindPopup(e(destino.nombre));
        setTimeout(() => mapa.invalidateSize(), 60);
      }
      const pintarMiPunto = (lat, lng) => {
        if (!mapa) return;
        if (marcadorYo) marcadorYo.setLatLng([lat, lng]); else marcadorYo = L.marker([lat, lng]).addTo(mapa);
        if (linea) mapa.removeLayer(linea);
        linea = L.polyline([[lat, lng], [destino.lat, destino.lng]], { weight: 3, dashArray: '6 6' }).addTo(mapa);
        mapa.fitBounds(linea.getBounds(), { padding: [30, 30] });
      };

      // Reconstrucción al cambiar de idioma, conservando la etapa.
      window.reconstruirViaje = () => {
        if (!$('#viaje-shell') || !$('#viaje-shell').children.length) return;
        abrirViaje(pr, { etapa: etapa });
      };

      if (etapa > 0) {
        const btnTengo = $('#viaje-tengo');
        if (btnTengo) btnTengo.addEventListener('click', () => abrirRegistrarRecogida(pr));
        return;
      }

      // ── Selección de ETA ──
      let etaMinutos = 60;
      const otro = $('#viaje-eta-otro');
      const chips = $$('#viaje-shell [data-eta]');
      const marcar = (btn) => chips.forEach((c) => c.classList.toggle('is-active', c === btn));
      chips.forEach((chip) => chip.addEventListener('click', () => {
        marcar(chip);
        if (chip.dataset.eta === 'otro') { otro.hidden = false; otro.focus(); etaMinutos = null; return; }
        otro.hidden = true;
        etaMinutos = Number(chip.dataset.eta);
      }));
      marcar(chips[1]); // 1 h por defecto

      $('#viaje-iniciar').addEventListener('click', async () => {
        const nombre = $('#viaje-nombre').value.trim();
        if (!nombre) { mostrarMensaje('#viaje-message', 'error', t('trip.nameRequired')); return; }
        let eta = etaMinutos;
        if (eta == null) {
          eta = Math.round(Number(otro.value));
          if (!(eta >= 5 && eta <= 480)) { mostrarMensaje('#viaje-message', 'error', t('trip.etaInvalid')); return; }
        }
        if (!navigator.geolocation) { mostrarMensaje('#viaje-message', 'error', t('trip.gpsUnsupported')); return; }
        const boton = $('#viaje-iniciar');
        boton.disabled = true;
        mostrarMensaje('#viaje-message', 'info', t('trip.gpsAsking'));
        let pos;
        try {
          pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
            resolve, reject, { enableHighAccuracy: true, timeout: 15000 }));
        } catch (err) {
          // Sin GPS no se inicia el viaje: se explica y se deja reintentar.
          boton.disabled = false;
          mostrarMensaje('#viaje-message', 'error', t('trip.gpsRequired'));
          return;
        }
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        pintarMiPunto(lat, lng);
        mostrarMensaje('#viaje-message', 'info', t('trip.starting'));
        try {
          await window.SheetsService.post({
            accion: 'viaje_iniciar', token: pr.token,
            nombreTransportista: nombre, etaMinutos: eta,
            gps: { lat: lat, lng: lng },
            email: (sesion && sesion.email) || ''
          });
          toast(t('trip.started', { eta: eta }));
          await cargarTodo();
          abrirViaje(pr, { etapa: 1 });
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#viaje-message', 'error', String(err && err.message || t('needs.error')));
        }
      });
    }

    window.abrirViaje = abrirViaje;
