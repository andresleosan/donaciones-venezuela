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

    // Puerta dev (misma que core.js): ?dev=1 / ?edit=1 o sessionStorage 'dv-dev'.
    function simDisponible() {
      try {
        const q = new URLSearchParams(location.search);
        if ((q.get('dev') || q.get('edit')) === '1') return true;
        return sessionStorage.getItem('dv-dev') === '1';
      } catch (err) { return false; }
    }

    // Foto de relleno (canvas) para la simulación — no toca la cámara real.
    function fotoSimulada() {
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#7a8b74'; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('SIMULACIÓN', 70, 128);
      return c.toDataURL('image/jpeg', 0.6);
    }

    // Recorre paso 1→2→3 contra las acciones REALES con GPS ficticio (se acerca
    // al destino) y fotos de canvas, ~5 s entre pasos: la línea de tiempo se mueve
    // de verdad sobre datos de mentira. Solo se dispara desde el botón dev.
    async function simularViaje(pr) {
      const espera = (ms) => new Promise((r) => setTimeout(r, ms));
      const d = destinoDelCentro(pr.centro) || { lat: 10.4806, lng: -66.9036 };
      const gps = (f) => ({ lat: d.lat + 0.02 * (1 - f), lng: d.lng - 0.02 * (1 - f) });
      const foto = fotoSimulada();
      const sesion = (typeof sesionActual === 'function' && sesionActual()) || {};
      const nombre = sesion.nombre || 'SIM';
      try {
        await window.SheetsService.post({ accion: 'viaje_iniciar', token: pr.token,
          nombreTransportista: nombre, etaMinutos: 60, gps: gps(0), email: sesion.email || '' });
        await cargarTodo(); abrirViaje(pr, { etapa: 1 }); await espera(5000);
        const p2 = pr.esOferta
          ? { accion: 'recoger_oferta', token: pr.token, nombreTransportista: nombre, centroDestino: pr.centro || '',
              fotoSitio: foto, fotoInsumo: foto, fotoPersona: foto, gps: gps(0.5) }
          : { accion: 'registrar_recogida', token: pr.token, nombreTransportista: nombre, notas: 'sim',
              fotoSitio: foto, fotoInsumo: foto, fotoPersona: foto, gps: gps(0.5) };
        const r2 = await window.SheetsService.post(p2);
        await cargarTodo(); abrirViaje(pr, { etapa: 2, km: r2 && r2.km }); await espera(5000);
        const r3 = await window.SheetsService.post({ accion: 'registrar_entrega_final', token: pr.token,
          nombreReceptor: 'SIM', cargoReceptor: 'sim', fotoCentro: foto, fotoEncargado: foto, gps: gps(1) });
        await cargarTodo(); abrirViaje(pr, { etapa: 3, km: r3 && r3.km });
      } catch (err) {
        mostrarMensaje('#viaje-message', 'error', String(err && err.message || t('needs.error')));
      }
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

      const nombreSesion = (sesion && sesion.nombre) || '';
      let bloquePaso;
      if (etapa === 0) {
        // Paso 1: tiempo estimado + arranque del viaje.
        bloquePaso = `
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
        ${nombreSesion
          ? `<p class="meta"><strong>${e(t('cycle.driverName'))}:</strong> ${e(nombreSesion)}</p>
             <input id="viaje-nombre" type="hidden" value="${e(nombreSesion)}" />`
          : `<div class="field full">
               <label for="viaje-nombre">${e(t('cycle.driverName'))}</label>
               <input id="viaje-nombre" required autocomplete="name" value="" />
             </div>`}
        <div class="form-actions">
          <button class="btn btn-primary" type="button" id="viaje-iniciar">${e(t('trip.startCta'))}</button>
        </div>`;
      } else if (etapa === 1) {
        // Paso 2 «Ya tengo el insumo»: asistente 1-a-1 con TRES cámaras (sitio,
        // insumo, y la persona que entrega). Sin ventana flotante: vive aquí.
        bloquePaso = `
        <form id="recogida-form" class="offer-wizard" novalidate>
          <p class="section-copy">${e(t('cycle.pickupCopy', { insumo: mostrarInsumo(pr.insumo), tienda: pr.tienda, direccion: pr.direccion || '' }))}</p>
          <div data-wiz-step class="field full">
            <label for="rec-nombre">${e(t('cycle.driverName'))}</label>
            <input id="rec-nombre" required autocomplete="name" value="${e(nombreSesion)}" />
            <label for="rec-notas">${e(t('cycle.notes'))}</label>
            <input id="rec-notas" />
          </div>
          ${pasoCamaraHtml('rec-sitio', t('cycle.photoSite'), t('cycle.photoSiteHelp'))}
          ${pasoCamaraHtml('rec-insumo', t('cycle.photoSupply'), t('cycle.photoSupplyHelp'))}
          ${pasoCamaraHtml('rec-persona', t('cycle.personPhoto'), t('cycle.personPhotoHelp'))}
          <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('cycle.pickupSave'))}</button></div>
          <div id="rec-message" class="form-message" role="status" aria-live="polite"></div>
        </form>`;
      } else if (etapa === 2) {
        // Paso 3 «Entrega en el centro»: asistente 1-a-1 con DOS cámaras (la
        // entrega en el centro y la persona que recibe). Sin ventana flotante.
        bloquePaso = `
        ${op.km != null ? `<p class="meta">${e(t('trip.kmSoFar', { km: op.km }))}</p>` : ''}
        <form id="entrega-form" class="offer-wizard" novalidate>
          <p class="section-copy">${e(t('cycle.deliverCopy', { insumo: mostrarInsumo(pr.insumo), centro: pr.centro }))}</p>
          <div data-wiz-step class="field full">
            <label for="ent-receptor">${e(t('cycle.receiverName'))}</label>
            <input id="ent-receptor" required autocomplete="name" />
            <label for="ent-cargo">${e(t('cycle.receiverRole'))}</label>
            <input id="ent-cargo" />
          </div>
          ${pasoCamaraHtml('ent-centro', t('cycle.photoDelivered'), t('cycle.photoSiteHelp'))}
          ${pasoCamaraHtml('ent-encargado', t('cycle.receiverPhoto'), t('cycle.receiverPhotoHelp'))}
          <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('cycle.deliverSave'))}</button></div>
          <div id="ent-message" class="form-message" role="status" aria-live="polite"></div>
        </form>`;
      } else {
        // Etapa 3: ciclo cerrado. Se muestra el recorrido total.
        bloquePaso = `
        <p class="section-copy">${e(t('cycle.deliverSaved'))}</p>
        ${op.km != null ? `<p class="meta"><strong>${e(t('trip.kmTotal', { km: op.km }))}</strong></p>` : ''}`;
      }

      shell.innerHTML = `
        ${etapasViaje(etapa)}
        <p class="section-copy">${e(t('trip.intro', { insumo: mostrarInsumo(pr.insumo), tienda: pr.tienda, centro: pr.centro }))}</p>
        <p class="meta"><strong>${e(t('cycle.pickupAt'))}</strong> ${e(pr.tienda)}${pr.direccion ? ' · ' + e(pr.direccion) : ''}</p>
        <p class="meta"><strong>${e(t('cycle.deliverTo'))}</strong> ${e(pr.centro)}</p>
        ${destino ? '<div id="viaje-mapa" class="of-mapa"></div>' : `<p class="meta">${e(t('trip.noMap'))}</p>`}
        ${bloquePaso}
        ${(etapa === 0 && simDisponible())
          ? `<div class="form-actions"><button class="btn btn-ghost btn-small" type="button" id="viaje-simular">▶ ${e(t('trip.simulate'))}</button></div>`
          : ''}
        <div id="viaje-message" class="form-message" role="status" aria-live="polite"></div>`;

      // Mapa: destino siempre; el punto del transportista se añade cuando el GPS
      // responde, y entonces se traza la línea entre ambos.
      let mapa = null, marcadorYo = null, linea = null;
      if (destino && window.L) {
        mapa = L.map('viaje-mapa').setView([destino.lat, destino.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
        L.marker([destino.lat, destino.lng]).addTo(mapa).bindPopup(e(destino.nombre));
        // Oferta: el punto de recogida (casa del donante) YA tiene coordenadas, así
        // que se pinta la ruta recogida→entrega completa desde el inicio.
        const rc = pr.esOferta && pr.recogidaCoords;
        if (rc && rc.lat != null && rc.lng != null) {
          L.marker([rc.lat, rc.lng]).addTo(mapa).bindPopup(e(pr.ubicacion || ''));
          const ruta = L.polyline([[rc.lat, rc.lng], [destino.lat, destino.lng]], { weight: 3, dashArray: '6 6' }).addTo(mapa);
          mapa.fitBounds(ruta.getBounds(), { padding: [30, 30] });
        }
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
        abrirViaje(pr, { etapa: etapa, km: op.km });
      };

      // Botón dev de simulación (solo ?dev=1, solo etapa 0).
      const simBtn = $('#viaje-simular');
      if (simBtn) simBtn.addEventListener('click', () => {
        simBtn.disabled = true; simBtn.textContent = t('trip.simulating'); simularViaje(pr);
      });

      // ── Paso 2 «Ya tengo el insumo»: 3 cámaras + GPS ──
      if (etapa === 1) {
        // Las fotos se conservan si hay que repintar (cambio de idioma).
        const fotoSitio = (op.fotos && op.fotos.sitio) || [];
        const fotoInsumo = (op.fotos && op.fotos.insumo) || [];
        const fotoPersona = (op.fotos && op.fotos.persona) || [];
        wizPublico('recogida-form');
        montarCamaraOferta('rec-sitio', fotoSitio, 1);
        montarCamaraOferta('rec-insumo', fotoInsumo, 1);
        montarCamaraOferta('rec-persona', fotoPersona, 1);
        window.reconstruirViaje = () => {
          if (!$('#recogida-form')) return;
          abrirViaje(pr, { etapa: 1, fotos: { sitio: fotoSitio, insumo: fotoInsumo, persona: fotoPersona } });
        };
        $('#recogida-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const nombre = $('#rec-nombre').value.trim();
          if (!nombre) { mostrarMensaje('#rec-message', 'error', t('trip.nameRequired')); return; }
          if (!fotoSitio.length || !fotoInsumo.length || !fotoPersona.length) {
            mostrarMensaje('#rec-message', 'error', t('cycle.photosMissing')); return;
          }
          if (!navigator.geolocation) { mostrarMensaje('#rec-message', 'error', t('trip.gpsUnsupported')); return; }
          const boton = $('#recogida-form').querySelector('button[type="submit"]');
          boton.disabled = true;
          mostrarMensaje('#rec-message', 'info', t('trip.gpsAsking'));
          let pos;
          try {
            pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
              resolve, reject, { enableHighAccuracy: true, timeout: 15000 }));
          } catch (err) {
            boton.disabled = false;
            mostrarMensaje('#rec-message', 'error', t('trip.gpsRequired'));
            return;
          }
          mostrarMensaje('#rec-message', 'info', t('messages.driverUploading'));
          try {
            // Oferta → recoger_oferta (paso 2 que no cierra); compra → registrar_recogida.
            const payload = pr.esOferta
              ? { accion: 'recoger_oferta', token: pr.token, nombreTransportista: nombre,
                  centroDestino: pr.centro || '', fotoSitio: fotoSitio[0], fotoInsumo: fotoInsumo[0],
                  fotoPersona: fotoPersona[0], gps: { lat: pos.coords.latitude, lng: pos.coords.longitude } }
              : { accion: 'registrar_recogida', token: pr.token, nombreTransportista: nombre,
                  notas: $('#rec-notas').value.trim(), fotoSitio: fotoSitio[0], fotoInsumo: fotoInsumo[0],
                  fotoPersona: fotoPersona[0], gps: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
            const data = await window.SheetsService.post(payload);
            toast(t('cycle.pickupSaved'));
            await cargarTodo();
            abrirViaje(pr, { etapa: 2, km: data && data.km });
          } catch (err) {
            boton.disabled = false;
            mostrarMensaje('#rec-message', 'error', String(err && err.message || t('needs.error')));
          }
        });
        return;
      }

      // ── Paso 3 «Entrega en el centro»: 2 cámaras + GPS ──
      if (etapa === 2) {
        const fotoCentro = (op.fotos && op.fotos.centro) || [];
        const fotoEncargado = (op.fotos && op.fotos.encargado) || [];
        wizPublico('entrega-form');
        montarCamaraOferta('ent-centro', fotoCentro, 1);
        montarCamaraOferta('ent-encargado', fotoEncargado, 1);
        window.reconstruirViaje = () => {
          if (!$('#entrega-form')) return;
          abrirViaje(pr, { etapa: 2, km: op.km, fotos: { centro: fotoCentro, encargado: fotoEncargado } });
        };
        $('#entrega-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const receptor = $('#ent-receptor').value.trim();
          if (!receptor) { mostrarMensaje('#ent-message', 'error', t('cycle.receiverName')); return; }
          if (!fotoCentro.length || !fotoEncargado.length) {
            mostrarMensaje('#ent-message', 'error', t('cycle.photosMissing')); return;
          }
          if (!navigator.geolocation) { mostrarMensaje('#ent-message', 'error', t('trip.gpsUnsupported')); return; }
          const boton = $('#entrega-form').querySelector('button[type="submit"]');
          boton.disabled = true;
          mostrarMensaje('#ent-message', 'info', t('trip.gpsAsking'));
          let pos;
          try {
            pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
              resolve, reject, { enableHighAccuracy: true, timeout: 15000 }));
          } catch (err) {
            boton.disabled = false;
            mostrarMensaje('#ent-message', 'error', t('trip.gpsRequired'));
            return;
          }
          mostrarMensaje('#ent-message', 'info', t('messages.driverUploading'));
          try {
            const data = await window.SheetsService.post({
              accion: 'registrar_entrega_final', token: pr.token,
              nombreReceptor: receptor, cargoReceptor: $('#ent-cargo').value.trim(),
              fotoCentro: fotoCentro[0], fotoEncargado: fotoEncargado[0],
              gps: { lat: pos.coords.latitude, lng: pos.coords.longitude }
            });
            toast(t('cycle.deliverSaved'));
            await cargarTodo();
            abrirViaje(pr, { etapa: 3, km: data && data.km });
          } catch (err) {
            boton.disabled = false;
            mostrarMensaje('#ent-message', 'error', String(err && err.message || t('needs.error')));
          }
        });
        return;
      }
      // Etapa 3: ciclo cerrado, sin cableado (solo muestra el recorrido total).
      if (etapa >= 3) return;

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
