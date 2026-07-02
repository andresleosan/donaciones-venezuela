// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';
    // ===== Panel interno por centro (token + PIN) =====
    let credencialesPanel = null;

    function abrirPanelCentro(tokenPrefill) {
      credencialesPanel = null;
      abrirModal(t('panel.title'), `
        <form id="panel-auth-form">
          <p class="meta">${e(t('panel.intro'))}</p>
          <div class="form-grid">
            <div class="field"><label for="panel-token">${e(t('panel.tokenLabel'))}</label><input id="panel-token" required placeholder="CTR-XXXX-XXXX-XXXX" value="${e(tokenPrefill || '')}" autocomplete="off" /></div>
            <div class="field"><label for="panel-pin">${e(t('panel.pinLabel'))}</label><input id="panel-pin" type="password" inputmode="numeric" required minlength="4" maxlength="8" autocomplete="off" /></div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${e(t('panel.enter'))}</button>
            <button class="btn btn-ghost" type="button" id="panel-crear-link">${e(t('panel.createCta'))}</button>
          </div>
          <div id="panel-msg" class="form-message"></div>
        </form>
        <div id="panel-body"></div>`);
      $('#panel-auth-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const token = $('#panel-token').value.trim().toUpperCase();
        const pin = $('#panel-pin').value.trim();
        mensajePanel('info', t('panel.checking'));
        try {
          const data = await window.SheetsService.post({ accion: 'panel_ver', token, pin });
          credencialesPanel = { token, pin };
          $('#panel-auth-form').hidden = true;
          renderPanelCentro(data);
        } catch (err) {
          mensajePanel('error', String(err && err.message || t('panel.authError')));
        }
      });
      $('#panel-crear-link').addEventListener('click', abrirCrearPanel);
    }

    function mensajePanel(tipo, texto) {
      const el = $('#panel-msg');
      if (!el) return;
      el.className = `form-message visible ${tipo}`;
      el.textContent = texto;
    }

    function renderPanelCentro(data) {
      const lugar = data.lugar || {};
      const insumos = data.insumos || [];
      const opcionesEstado = (sel) => ['Necesita', 'Disponible', 'Cubierto'].map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${e(tValue('supplyStatus', v) || v)}</option>`).join('');
      const opcionesUrgencia = (sel) => ['Alta', 'Normal', 'Baja'].map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${e(tValue('urgency', v) || v)}</option>`).join('');
      const fila = (i) => `
        <div class="panel-insumo" data-insumo="${e(i.nombre)}">
          <div class="form-grid">
            <div class="field"><label>${e(t('panel.supplyName'))}</label><input data-campo="nombre" value="${e(i.nombre)}" ${i.id ? 'readonly' : ''} /></div>
            <div class="field"><label>${e(t('panel.category'))}</label><input data-campo="categoria" value="${e(i.categoria || '')}" /></div>
            <div class="field"><label>${e(t('panel.status'))}</label><select data-campo="estado">${opcionesEstado(i.estado)}</select></div>
            <div class="field"><label>${e(t('panel.needed'))}</label><input data-campo="cantidadNecesaria" type="number" min="0" value="${e(i.cantidad_necesaria != null ? i.cantidad_necesaria : 1)}" /></div>
            <div class="field"><label>${e(t('panel.received'))}</label><input data-campo="cantidadRecibida" type="number" min="0" value="${e(i.cantidad_recibida != null ? i.cantidad_recibida : 0)}" /></div>
            <div class="field"><label>${e(t('panel.urgency'))}</label><select data-campo="urgencia">${opcionesUrgencia(i.urgencia || 'Normal')}</select></div>
          </div>
          <div class="inline-actions">
            <button class="btn btn-soft btn-small" type="button" data-panel-guardar>${e(t('panel.save'))}</button>
            ${i.id ? `<button class="btn btn-ghost btn-small" type="button" data-panel-borrar>${e(t('panel.delete'))}</button>` : ''}
          </div>
        </div>`;
      const tipos = ['Centro', 'Hospital', 'Refugio'].map((v) => `<option value="${v}" ${v === lugar.tipo ? 'selected' : ''}>${e(tValue('types', v) || v)}</option>`).join('');
      $('#panel-body').innerHTML = `
        <h3>${e(lugar.nombre || '')}</h3>
        <div id="panel-msg2" class="form-message"></div>
        <h3>${e(t('panel.placeData'))}</h3>
        <div class="panel-insumo" id="panel-datos-lugar">
          <div class="form-grid">
            <div class="field"><label>${e(t('panel.typeLabel'))}</label><select id="pd-tipo">${tipos}</select></div>
            <div class="field"><label>${e(t('panel.locationLabel'))}</label><input id="pd-ubicacion" value="${e(lugar.ubicacion || '')}" /></div>
            <div class="field"><label>${e(t('panel.phoneLabel'))}</label><input id="pd-telefono" type="tel" value="${e(lugar.telefono || '')}" /></div>
            <div class="field"><label>${e(t('panel.coordsLabel'))}</label><input id="pd-coords" placeholder="10.4806, -66.9036" value="${lugar.lat != null && lugar.lng != null ? e(lugar.lat + ', ' + lugar.lng) : ''}" /></div>
          </div>
          <div class="inline-actions">
            <button class="btn btn-ghost btn-small" type="button" id="pd-geo">${e(t('panel.useMyLocation'))}</button>
            <button class="btn btn-soft btn-small" type="button" id="pd-guardar">${e(t('panel.savePlace'))}</button>
          </div>
        </div>
        <h3>${e(t('panel.supplies'))}</h3>
        ${insumos.map(fila).join('') || `<p class="meta">${e(t('panel.noSupplies'))}</p>`}
        <h3>${e(t('panel.add'))}</h3>
        ${fila({ nombre: '', categoria: '', estado: 'Necesita', urgencia: 'Normal' })}`;
      $$('#panel-body [data-panel-guardar]').forEach((btn) => btn.addEventListener('click', () => guardarInsumoPanel(btn.closest('.panel-insumo'))));
      $$('#panel-body [data-panel-borrar]').forEach((btn) => btn.addEventListener('click', () => borrarInsumoPanel(btn.closest('.panel-insumo'))));
      $('#pd-geo').addEventListener('click', () => capturarUbicacion('#pd-coords'));
      $('#pd-guardar').addEventListener('click', guardarDatosLugarPanel);
    }

    function parsearCoords(texto) {
      const m = String(texto || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (!m) return null;
      return { lat: Number(m[1]), lng: Number(m[2]) };
    }

    function capturarUbicacion(selector) {
      if (!navigator.geolocation) { toast(t('panel.geoUnavailable')); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => { $(selector).value = pos.coords.latitude.toFixed(6) + ', ' + pos.coords.longitude.toFixed(6); },
        () => toast(t('panel.geoDenied')),
        { timeout: 8000 }
      );
    }

    async function guardarDatosLugarPanel() {
      if (!credencialesPanel) return;
      const coords = parsearCoords($('#pd-coords').value) || {};
      try {
        const data = await window.SheetsService.post(Object.assign({
          accion: 'panel_actualizar_lugar',
          tipo: $('#pd-tipo').value,
          ubicacion: $('#pd-ubicacion').value.trim(),
          telefono: $('#pd-telefono').value.trim()
        }, coords, credencialesPanel));
        renderPanelCentro(data);
        mensajePanel2('success', t('panel.saved'));
        cargarTodo();
      } catch (err) {
        mensajePanel2('error', String(err && err.message || t('panel.saveError')));
      }
    }

    function mensajePanel2(tipo, texto) {
      const el = $('#panel-msg2');
      if (!el) return;
      el.className = `form-message visible ${tipo}`;
      el.textContent = texto;
    }

    function leerFilaPanel(fila) {
      const valor = (campo) => { const el = fila.querySelector(`[data-campo="${campo}"]`); return el ? el.value : ''; };
      return {
        insumoNombre: valor('nombre').trim(),
        categoria: valor('categoria').trim(),
        estado: valor('estado'),
        cantidadNecesaria: valor('cantidadNecesaria'),
        cantidadRecibida: valor('cantidadRecibida'),
        urgencia: valor('urgencia')
      };
    }

    async function guardarInsumoPanel(fila) {
      if (!credencialesPanel) return;
      const campos = leerFilaPanel(fila);
      if (!campos.insumoNombre) { mensajePanel2('error', t('panel.supplyRequired')); return; }
      try {
        const data = await window.SheetsService.post(Object.assign({ accion: 'panel_insumo' }, credencialesPanel, campos));
        renderPanelCentro(data);
        mensajePanel2('success', t('panel.saved'));
        cargarTodo();
      } catch (err) {
        mensajePanel2('error', String(err && err.message || t('panel.saveError')));
      }
    }

    async function borrarInsumoPanel(fila) {
      if (!credencialesPanel) return;
      const campos = leerFilaPanel(fila);
      try {
        const data = await window.SheetsService.post(Object.assign({ accion: 'panel_insumo_borrar' }, credencialesPanel, campos));
        renderPanelCentro(data);
        mensajePanel2('success', t('panel.deleted'));
        cargarTodo();
      } catch (err) {
        mensajePanel2('error', String(err && err.message || t('panel.saveError')));
      }
    }

    function abrirCrearPanel() {
      abrirModal(t('panel.createTitle'), `
        <form id="panel-crear-form">
          <p class="meta">${e(t('panel.createIntro'))}</p>
          <div class="form-grid">
            <div class="field"><label for="pc-nombre">${e(t('panel.nameLabel'))}</label><input id="pc-nombre" required /></div>
            <div class="field"><label for="pc-tipo">${e(t('panel.typeLabel'))}</label><select id="pc-tipo"><option value="Centro">${e(tValue('types', 'Centro') || 'Centro')}</option><option value="Hospital">${e(tValue('types', 'Hospital') || 'Hospital')}</option><option value="Refugio">${e(tValue('types', 'Refugio') || 'Refugio')}</option></select></div>
            <div class="field"><label for="pc-ubicacion">${e(t('panel.locationLabel'))}</label><input id="pc-ubicacion" /></div>
            <div class="field"><label for="pc-telefono">${e(t('panel.phoneLabel'))}</label><input id="pc-telefono" type="tel" /></div>
            <div class="field"><label for="pc-pin">${e(t('panel.pinNewLabel'))}</label><input id="pc-pin" type="password" inputmode="numeric" required minlength="4" maxlength="8" /></div>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('panel.create'))}</button></div>
          <div id="panel-crear-msg" class="form-message"></div>
        </form>`);
      $('#panel-crear-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const msg = $('#panel-crear-msg');
        msg.className = 'form-message visible info';
        msg.textContent = t('panel.creating');
        try {
          const data = await window.SheetsService.post({
            accion: 'panel_crear',
            nombre: $('#pc-nombre').value.trim(),
            tipo: $('#pc-tipo').value,
            ubicacion: $('#pc-ubicacion').value.trim(),
            telefono: $('#pc-telefono').value.trim(),
            pin: $('#pc-pin').value.trim()
          });
          $('#panel-crear-form').innerHTML = `
            <div class="notice success visible">${e(t('panel.tokenCreated'))}</div>
            <p class="tracking-code" style="font-size:1.3rem">${e(data.token)}</p>
            <p class="meta">${e(t('panel.tokenHint'))}</p>`;
          cargarTodo();
        } catch (err) {
          msg.className = 'form-message visible error';
          msg.textContent = String(err && err.message || t('panel.saveError'));
        }
      });
    }

    function abrirPanelDesdeUrl() {
      const hash = decodeURIComponent(window.location.hash || '');
      const match = hash.match(/^#centro\/(CTR-[A-Z0-9-]+)$/i);
      if (match) abrirPanelCentro(match[1].toUpperCase());
      if (/^#admin$/i.test(hash)) abrirAdmin();
      // Shortcuts de la PWA: #<vista> abre esa vista directamente
      const vista = (hash.match(/^#(inicio|donaciones|voluntarios|rescatistas|familiar|seguimiento)$/i) || [])[1];
      if (vista) cambiarVista(vista.toLowerCase());
    }

