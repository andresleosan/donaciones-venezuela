// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';
    // ===== Panel interno por centro (Firebase Auth + claims) =====
    //
    // Ya no hay token CTR-… ni PIN: el acceso al panel ES la cuenta. El servidor
    // resuelve el centro desde el claim `panelLugarId`, asi que ninguna accion
    // del panel lleva credenciales en el cuerpo.

    // Catálogo de insumos frecuentes: el centro los agrega tocando una tarjeta;
    // si falta alguno, usa "Otro insumo". Los nombres son canónicos y se
    // traducen con mostrarInsumo()/tValue('categories', …).
    const CATALOGO_INSUMOS = [
      { categoria: 'Agua potable', items: ['Agua potable', 'Agua embotellada'] },
      { categoria: 'Alimentos', items: ['Arroz', 'Leche en polvo'] },
      { categoria: 'Medicamentos', items: ['Analgésicos', 'Sueros fisiológicos'] },
      { categoria: 'Insumos médicos', items: ['Gasas estériles', 'Guantes', 'Oxímetros', 'Material médico'] },
      { categoria: 'Higiene', items: ['Jabón', 'Kits de higiene', 'Pañales'] },
      { categoria: 'Ropa', items: ['Ropa de adulto', 'Calzado', 'Mantas'] },
      { categoria: 'Otros', items: ['Colchonetas', 'Plantas eléctricas', 'Herramientas', 'Equipos'] }
    ];
    const CATEGORIAS_INSUMO = ['Agua potable', 'Alimentos', 'Medicamentos', 'Insumos médicos', 'Higiene', 'Ropa', 'Otros'];

    function abrirPanelCentro() {
      abrirModal(t('panel.title'), `
        <p class="meta">${e(t('panel.intro'))}</p>
        <div id="panel-msg" class="form-message"></div>
        <div class="form-actions" id="panel-acciones"></div>
        <div id="panel-body"></div>`);
      return cargarPanelCentro();
    }

    async function cargarPanelCentro() {
      // Esperar a que Firebase termine de restaurar la sesión guardada: si no,
      // quien ya había entrado ve «entra con tu cuenta» al abrir /panel-centro.
      if (window.DVSesion && window.DVSesion.listo) await window.DVSesion.listo;
      const acciones = $('#panel-acciones');
      acciones.innerHTML = `<button class="btn btn-ghost" type="button" id="panel-crear-link">${e(t('panel.createCta'))}</button>`;
      $('#panel-crear-link').addEventListener('click', abrirCrearPanel);

      if (typeof sesionActual === 'function' && !sesionActual()) {
        mensajePanel('info', t('panel.needSession'));
        // /panel-centro es ventana.html: no tiene router de hash ni vista de acceso.
        acciones.insertAdjacentHTML('afterbegin', `<a class="btn btn-primary" href="/#acceso">${e(t('session.login'))}</a>`);
        return;
      }

      mensajePanel('info', t('panel.checking'));
      try {
        const data = await window.SheetsService.post({ accion: 'panel_ver' });
        mensajePanel('info', '');
        $('#panel-msg').className = 'form-message';
        acciones.innerHTML = '';
        renderPanelCentro(data);
      } catch (err) {
        // 403 = la cuenta existe pero no administra ningun centro: es el caso
        // normal de quien entra a mirar, no un error que haya que depurar.
        const sinAcceso = err && err.status === 403;
        mensajePanel(sinAcceso ? 'info' : 'error',
          sinAcceso ? t('panel.noAccess') : String((err && err.message) || t('panel.openError')));
      }
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
      const existentes = new Set(insumos.map((i) => normalizar(i.nombre)));
      const tipos = ['Centro', 'Hospital', 'Refugio'].map((v) => `<option value="${v}" ${v === lugar.tipo ? 'selected' : ''}>${e(tValue('types', v) || v)}</option>`).join('');

      // Catálogo: una tarjeta-chip por insumo frecuente. Tocar = agregar.
      const catalogoHtml = CATALOGO_INSUMOS.map((grupo) => {
        const chips = grupo.items.map((item) => {
          const ya = existentes.has(normalizar(item));
          return `<button type="button" class="chip-add${ya ? ' ya' : ''}" data-add-insumo="${e(item)}" data-add-cat="${e(grupo.categoria)}"${ya ? ' disabled' : ''}>${ya ? '✓ ' : '+ '}${e(mostrarInsumo(item))}</button>`;
        }).join('');
        return `<div class="catalogo-grupo"><span class="catalogo-cat">${e(tValue('categories', grupo.categoria) || grupo.categoria)}</span><div class="segmented">${chips}</div></div>`;
      }).join('');

      // Una tarjeta editable por insumo ya en la lista del centro.
      const chipsEstado = (i) => ['Necesita', 'Disponible', 'Cubierto'].map((v) => `<button type="button" class="chip-btn" data-estado="${v}" aria-pressed="${(i.estado || 'Necesita') === v}">${e(tValue('supplyStatus', v) || v)}</button>`).join('');
      const chipsUrgencia = (i) => ['Alta', 'Normal', 'Baja'].map((v) => `<button type="button" class="chip-btn urg-${v}" data-urgencia="${v}" aria-pressed="${(i.urgencia || 'Normal') === v}">${e(tValue('urgency', v) || v)}</button>`).join('');
      const tarjeta = (i) => `
        <div class="insumo-card" data-insumo="${e(i.nombre)}" data-categoria="${e(i.categoria || '')}">
          <div class="insumo-card-head">
            <div class="insumo-title"><strong>${e(mostrarInsumo(i.nombre))}</strong>${i.categoria ? `<span class="badge gray">${e(tValue('categories', i.categoria) || i.categoria)}</span>` : ''}</div>
            <button type="button" class="insumo-del" data-panel-borrar aria-label="${e(t('panel.delete'))}">🗑</button>
          </div>
          <div class="insumo-row"><span class="insumo-lbl">${e(t('panel.status'))}</span><div class="segmented" data-grupo="estado">${chipsEstado(i)}</div></div>
          <div class="insumo-row"><span class="insumo-lbl">${e(t('panel.urgency'))}</span><div class="segmented" data-grupo="urgencia">${chipsUrgencia(i)}</div></div>
          <div class="insumo-cant">
            <label class="field-mini"><span>${e(t('panel.needed'))}</span><input type="number" min="0" data-campo="cantidadNecesaria" value="${e(i.cantidad_necesaria != null ? i.cantidad_necesaria : 1)}" /></label>
            <label class="field-mini"><span>${e(t('panel.received'))}</span><input type="number" min="0" data-campo="cantidadRecibida" value="${e(i.cantidad_recibida != null ? i.cantidad_recibida : 0)}" /></label>
          </div>
        </div>`;

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
        <h3>${e(t('panel.catalogTitle'))}</h3>
        <p class="meta">${e(t('panel.catalogIntro'))}</p>
        <div class="catalogo">${catalogoHtml}</div>
        <div class="catalogo-otro">
          <button type="button" class="btn btn-ghost btn-small" id="insumo-otro-toggle" aria-expanded="false">+ ${e(t('panel.addCustom'))}</button>
          <div id="insumo-otro-form" hidden>
            <div class="form-grid">
              <div class="field"><label for="io-nombre">${e(t('panel.supplyName'))}</label><input id="io-nombre" /></div>
              <div class="field"><label for="io-categoria">${e(t('panel.category'))}</label><select id="io-categoria">${CATEGORIAS_INSUMO.map((c) => `<option value="${e(c)}">${e(tValue('categories', c) || c)}</option>`).join('')}</select></div>
            </div>
            <div class="inline-actions"><button type="button" class="btn btn-soft btn-small" id="io-add">${e(t('panel.addToList'))}</button></div>
          </div>
        </div>
        <h3>${e(t('panel.supplies'))} (${insumos.length})</h3>
        <div class="insumo-list">${insumos.map(tarjeta).join('') || `<p class="meta">${e(t('panel.noSupplies'))}</p>`}</div>`;

      $('#pd-geo').addEventListener('click', () => capturarUbicacion('#pd-coords'));
      $('#pd-guardar').addEventListener('click', guardarDatosLugarPanel);
      $$('#panel-body [data-add-insumo]').forEach((btn) => btn.addEventListener('click', () => agregarInsumoPanel(btn.dataset.addInsumo, btn.dataset.addCat)));

      const otroToggle = $('#insumo-otro-toggle');
      otroToggle.addEventListener('click', () => {
        const form = $('#insumo-otro-form');
        const abrir = form.hidden;
        form.hidden = !abrir;
        otroToggle.setAttribute('aria-expanded', String(abrir));
        if (abrir) $('#io-nombre').focus();
      });
      $('#io-add').addEventListener('click', () => {
        const nombre = $('#io-nombre').value.trim();
        if (!nombre) { mensajePanel2('error', t('panel.supplyRequired')); return; }
        agregarInsumoPanel(nombre, $('#io-categoria').value);
      });

      $$('#panel-body .insumo-card').forEach((card) => {
        card.querySelectorAll('.segmented .chip-btn').forEach((chip) => chip.addEventListener('click', () => {
          chip.parentElement.querySelectorAll('.chip-btn').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
          guardarTarjetaInsumo(card);
        }));
        card.querySelectorAll('[data-campo]').forEach((inp) => inp.addEventListener('change', () => guardarTarjetaInsumo(card)));
        const del = card.querySelector('[data-panel-borrar]');
        if (del) del.addEventListener('click', () => borrarTarjetaInsumo(card));
      });
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
      const coords = parsearCoords($('#pd-coords').value) || {};
      try {
        const data = await window.SheetsService.post(Object.assign({
          accion: 'panel_actualizar_lugar',
          tipo: $('#pd-tipo').value,
          ubicacion: $('#pd-ubicacion').value.trim(),
          telefono: $('#pd-telefono').value.trim()
        }, coords));
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

    function leerTarjetaInsumo(card) {
      const val = (sel) => { const el = card.querySelector(sel); return el ? el.value : ''; };
      const activo = (grupo, attr) => { const b = card.querySelector(`.segmented[data-grupo="${grupo}"] [aria-pressed="true"]`); return b ? b.dataset[attr] : ''; };
      return {
        insumoNombre: card.dataset.insumo,
        categoria: card.dataset.categoria || '',
        estado: activo('estado', 'estado') || 'Necesita',
        urgencia: activo('urgencia', 'urgencia') || 'Normal',
        cantidadNecesaria: val('[data-campo="cantidadNecesaria"]'),
        cantidadRecibida: val('[data-campo="cantidadRecibida"]')
      };
    }

    // Re-render tras cada acción conservando la posición de scroll (evita el
    // salto al tope cuando se edita una tarjeta al final de la lista).
    async function persistirInsumo(payload, msgOkKey) {
      const y = window.scrollY;
      try {
        const data = await window.SheetsService.post(Object.assign({ accion: payload.accion }, payload.datos));
        renderPanelCentro(data);
        window.scrollTo({ top: y });
        mensajePanel2('success', t(msgOkKey));
        cargarTodo();
      } catch (err) {
        mensajePanel2('error', String(err && err.message || t('panel.saveError')));
      }
    }

    function agregarInsumoPanel(nombre, categoria) {
      if (!nombre) return;
      return persistirInsumo({ accion: 'panel_insumo', datos: {
        insumoNombre: nombre, categoria: categoria || '', estado: 'Necesita', urgencia: 'Normal', cantidadNecesaria: 1, cantidadRecibida: 0
      } }, 'panel.saved');
    }

    function guardarTarjetaInsumo(card) {
      const campos = leerTarjetaInsumo(card);
      if (!campos.insumoNombre) { mensajePanel2('error', t('panel.supplyRequired')); return; }
      return persistirInsumo({ accion: 'panel_insumo', datos: campos }, 'panel.saved');
    }

    function borrarTarjetaInsumo(card) {
      return persistirInsumo({ accion: 'panel_insumo_borrar', datos: leerTarjetaInsumo(card) }, 'panel.deleted');
    }

    function abrirCrearPanel() {
      // La cédula se toma SOLO con la cámara (R3.2) con guía visual; la ubicación
      // exacta sale del GPS, no de texto libre (R3.1). El formulario es un
      // asistente una-casilla-a-la-vez (R2.x).
      const fotoCedula = [];
      const fotoSitio = [];
      abrirModal(t('panel.createTitle'), `
        <form id="panel-crear-form">
          <p class="meta">${e(t('panel.createIntro'))}</p>
          <div class="form-grid">
            <div class="field"><label for="pc-nombre">${e(t('panel.nameLabel'))}</label><input id="pc-nombre" required /></div>
            <div class="field"><label for="pc-tipo">${e(t('panel.typeLabel'))}</label><select id="pc-tipo"><option value="Centro">${e(tValue('types', 'Centro') || 'Centro')}</option><option value="Hospital">${e(tValue('types', 'Hospital') || 'Hospital')}</option><option value="Refugio">${e(tValue('types', 'Refugio') || 'Refugio')}</option></select></div>
            <div class="field"><label for="pc-ubicacion">${e(t('panel.locationLabel'))}</label><input id="pc-ubicacion" placeholder="${e(t('panel.refNamePlaceholder'))}" /></div>
            <div class="field"><label for="pc-coords">${e(t('panel.coordsLabel'))}</label><input id="pc-coords" placeholder="10.4806, -66.9036" readonly /><button class="btn btn-ghost btn-small" type="button" id="pc-geo">${e(t('panel.useMyLocation'))}</button></div>
            ${pasoCamaraHtml('pc-sitio', t('panel.sitePhoto'), t('panel.sitePhotoHelp'))}
            <div class="field"><label for="pc-telefono">${e(t('panel.phoneLabel'))}</label><input id="pc-telefono" type="tel" required /></div>
            <div class="field"><label for="pc-email">${e(t('common.email'))}</label><input id="pc-email" type="email" required autocomplete="email" /></div>
            ${pasoCamaraHtml('pc-cedula', t('modal.photoId'), t('modal.photoIdHelp'), { guia: 'cedula' })}
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('panel.create'))}</button></div>
          <div id="panel-crear-msg" class="form-message"></div>
        </form>`);
      recordarModal(abrirCrearPanel); // sobrevive al cambio de idioma (R1.3/R1.4)
      wizPublico('panel-crear-form');
      montarCamaraOferta('pc-cedula', fotoCedula, 1);
      montarCamaraOferta('pc-sitio', fotoSitio, 1);
      $('#pc-geo').addEventListener('click', () => capturarUbicacion('#pc-coords'));
      $('#panel-crear-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const msg = $('#panel-crear-msg');
        // `panel_crear` exige sesion: la cuenta es la que queda como responsable
        // del centro, no un PIN elegido en el formulario.
        if (window.DVSesion && window.DVSesion.listo) await window.DVSesion.listo;
        if (typeof sesionActual === 'function' && !sesionActual()) {
          msg.className = 'form-message visible error';
          msg.textContent = t('panel.needSession');
          return;
        }
        if (!fotoCedula.length) {
          msg.className = 'form-message visible error';
          msg.textContent = t('messages.volunteerPhotoMissing');
          return;
        }
        if (!fotoSitio.length) {
          msg.className = 'form-message visible error';
          msg.textContent = t('panel.sitePhotoMissing');
          return;
        }
        try {
          // Las fotos ya no viajan en el JSON: se suben a Storage privado
          // (categoria `centers`, que solo lee el admin) y la accion recibe el
          // path. Asi un formulario grande no depende de un cuerpo de 4 MB.
          msg.className = 'form-message visible info';
          msg.textContent = t('panel.uploading');
          const [cedula, sitio] = await Promise.all([
            window.DVFirebase.subirFotoPrivada('centers', fotoCedula[0]),
            window.DVFirebase.subirFotoPrivada('centers', fotoSitio[0])
          ]);

          msg.className = 'form-message visible info';
          msg.textContent = t('panel.creating');
          const coords = parsearCoords($('#pc-coords').value) || {};
          await window.SheetsService.post(Object.assign({
            accion: 'panel_crear',
            nombre: $('#pc-nombre').value.trim(),
            tipo: $('#pc-tipo').value,
            ubicacion: $('#pc-ubicacion').value.trim(),
            telefono: $('#pc-telefono').value.trim(),
            email: $('#pc-email').value.trim(),
            fotoCedulaPath: cedula.path,
            fotoSitioPath: sitio.path
          }, coords));
          $('#panel-crear-form').innerHTML = `
            <div class="notice success visible">${e(t('panel.created'))}</div>
            <p class="meta">${e(t('panel.createdHint'))}</p>`;
          cargarTodo();
        } catch (err) {
          msg.className = 'form-message visible error';
          msg.textContent = String(err && err.message || t('panel.saveError'));
        }
      });
    }

    // Router por hash: la vista activa vive en location.hash, así el botón
    // "atrás" del navegador recorre los menús y sólo sale del sitio desde el
    // inicio. Los deep-links a páginas (centro/admin) redirigen a su página.
    function abrirPanelDesdeUrl() {
      const hashRaw = decodeURIComponent(window.location.hash || '');
      // Los enlaces #centro/CTR-… de la epoca del token siguen llegando desde
      // mensajes antiguos: se aceptan, pero el token ya no significa nada.
      if (/^#centro(\/|$)/i.test(hashRaw)) { window.location.href = '/panel-centro'; return; }
      if (/^#admin$/i.test(hashRaw)) { window.location.href = '/admin'; return; }
      // El token de seguimiento (#seguimiento/DV-…) lo pinta cargarSeguimientoDesdeUrl.
      if (/^#seguimiento\//i.test(hashRaw)) return;
      const VISTAS = ['inicio', 'donaciones', 'ayuda', 'donar', 'ayudar', 'necesidades', 'acceso', 'transporte', 'centro', 'voluntarios', 'rescatistas', 'familiar', 'seguimiento', 'ofrecer', 'denuncias'];
      const hash = hashRaw.replace(/^#/, '').toLowerCase();
      // #ofrecer se construye al vuelo: sin esto, entrar directo o recargar
      // dejaba la página vacía (solo el título).
      if (hash === 'ofrecer' && typeof abrirOfrecerInsumo === 'function') { abrirOfrecerInsumo({}); return; }
      // Denunciar EXIGE sesión (cualquiera, incluido el donante sin rol). Sin
      // sesión: guarda el retorno y manda a #acceso (tras entrar vuelve aquí).
      if (hash === 'denunciar') {
        if (typeof sesionActual === 'function' && sesionActual()) {
          if (typeof abrirDenunciar === 'function') abrirDenunciar();
          return;
        }
        try { sessionStorage.setItem('dv-retorno', '#denunciar'); } catch (err) { /* privado */ }
        if (typeof toast === 'function') toast(t('report.needSession'));
        window.location.hash = '#acceso';
        return;
      }
      // Lista pública de denuncias: se construye al vuelo (como #ofrecer).
      if (hash === 'denuncias' && typeof abrirDenuncias === 'function') { abrirDenuncias(); return; }
      // Páginas construidas al vuelo: sin esto, fijar su hash dispara este mismo
      // manejador y las mandaba al inicio (rebote).
      // «Mi sesión» se reconstruye sola desde la sesión guardada; si no hay
      // sesión, abrirMenuSesion ya redirige a #acceso.
      if (hash === 'mi-cuenta' && typeof abrirMenuSesion === 'function') { abrirMenuSesion(); return; }
      // «Donar dinero» necesita un presupuesto en contexto: si ya está pintada se
      // conserva; en carga directa o recarga no hay cómo reconstruirla → inicio.
      if (hash === 'donar-dinero') {
        const shellDinero = $('#donar-dinero-shell');
        if (shellDinero && shellDinero.children.length) { cambiarVista('donar-dinero'); return; }
        cambiarVista('inicio');
        return;
      }
      // El viaje necesita el presupuesto en contexto: igual que donar-dinero.
      if (hash === 'viaje') {
        const shellViaje = $('#viaje-shell');
        if (shellViaje && shellViaje.children.length) { cambiarVista('viaje'); return; }
        cambiarVista('inicio');
        return;
      }
      cambiarVista(VISTAS.indexOf(hash) >= 0 ? hash : 'inicio');
    }
