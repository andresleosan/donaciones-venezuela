// Auto-registro de damnificados (página-ventana /registro-familia). Una familia
// se registra a sí misma con todos sus datos + fotos antiguas de lo perdido. El
// envío es público (sin login) pero el destino es PRIVADO solo-admin: la edge fn
// escribe en familias_damnificadas (RLS) y sube las fotos al bucket privado.
// Nada de esto se lista jamás en público. Reusa los helpers globales de core.js.
'use strict';

    function abrirRegistroFamilia() {
      const coords = { lat: null, lng: null };
      const fotos = [];               // dataURLs (jpeg comprimido)
      let filaSeq = 0;

      const relaciones = ['self', 'spouse', 'child', 'parent', 'grandparent', 'sibling', 'other'];
      const opcionesRel = relaciones.map((r) => `<option value="${e(r)}">${e(t('registro.rel.' + r))}</option>`).join('');

      const filaIntegrante = () => {
        const i = filaSeq++;
        return `<div class="fam-miembro card" data-fila="${i}">
          <div class="form-grid">
            <div class="field"><label for="fam-m-nombre-${i}">${e(t('registro.mName'))}</label><input id="fam-m-nombre-${i}" data-campo="nombre" /></div>
            <div class="field"><label for="fam-m-rel-${i}">${e(t('registro.mRel'))}</label><select id="fam-m-rel-${i}" data-campo="parentesco">${opcionesRel}</select></div>
            <div class="field"><label for="fam-m-edad-${i}">${e(t('registro.mAge'))}</label><input id="fam-m-edad-${i}" data-campo="edad" type="number" min="0" max="120" inputmode="numeric" /></div>
            <div class="field"><label for="fam-m-ocup-${i}">${e(t('registro.mJob'))}</label><input id="fam-m-ocup-${i}" data-campo="ocupacion" placeholder="${e(t('registro.mJobPh'))}" /></div>
          </div>
          <div class="field full"><label for="fam-m-med-${i}">${e(t('registro.mMed'))}</label><input id="fam-m-med-${i}" data-campo="condicionMedica" placeholder="${e(t('registro.mMedPh'))}" /></div>
          <div class="field full"><label for="fam-m-notas-${i}">${e(t('registro.mNotes'))}</label><input id="fam-m-notas-${i}" data-campo="notas" /></div>
          <button class="btn btn-ghost btn-small fam-quitar" type="button" data-quitar="${i}">${e(t('registro.removeMember'))}</button>
        </div>`;
      };

      abrirModal(t('registro.pageTitle'), `<form id="fam-form" novalidate>
        <p class="section-copy">${e(t('registro.intro'))}</p>
        <p class="field-help fam-privacy">🔒 ${e(t('registro.privacy'))}</p>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.contactTitle'))}</h3>
          <div class="form-grid">
            <div class="field"><label for="fam-nombre">${e(t('registro.name'))}</label><input id="fam-nombre" required placeholder="${e(t('registro.namePh'))}" /></div>
            <div class="field"><label for="fam-tel">${e(t('registro.phone'))}</label><input id="fam-tel" type="tel" inputmode="tel" /></div>
            <div class="field"><label for="fam-email">${e(t('registro.email'))}</label><input id="fam-email" type="email" autocomplete="email" /></div>
          </div>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.stayTitle'))}</h3>
          <div class="field full"><label for="fam-aloj">${e(t('registro.stayWhere'))}</label><textarea id="fam-aloj" rows="2" placeholder="${e(t('registro.stayWherePh'))}"></textarea></div>
          <div class="form-grid">
            <div class="field"><label for="fam-muni">${e(t('registro.municipio'))}</label><input id="fam-muni" /></div>
            <div class="field"><label for="fam-estado">${e(t('registro.estado'))}</label><input id="fam-estado" /></div>
          </div>
          <div class="form-actions fam-gps">
            <button class="btn btn-soft btn-small" type="button" id="fam-gps-btn">📍 ${e(t('registro.gpsBtn'))}</button>
            <span class="meta" id="fam-gps-txt" aria-live="polite">${e(t('registro.gpsNone'))}</span>
          </div>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.membersTitle'))}</h3>
          <p class="field-help">${e(t('registro.membersHelp'))}</p>
          <div id="fam-integrantes"></div>
          <button class="btn btn-soft btn-small" type="button" id="fam-agregar">＋ ${e(t('registro.addMember'))}</button>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.livelihoodTitle'))}</h3>
          <div class="field full"><label for="fam-sustento">${e(t('registro.livelihood'))}</label><textarea id="fam-sustento" rows="2" placeholder="${e(t('registro.livelihoodPh'))}"></textarea></div>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.deceasedTitle'))}</h3>
          <div class="form-grid">
            <div class="field"><label for="fam-fallecidos">${e(t('registro.deceasedCount'))}</label><input id="fam-fallecidos" type="number" min="0" max="99" inputmode="numeric" value="0" /></div>
          </div>
          <div class="field full"><label for="fam-fallecidos-det">${e(t('registro.deceasedDetail'))}</label><input id="fam-fallecidos-det" placeholder="${e(t('registro.deceasedDetailPh'))}" /></div>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.lossesTitle'))}</h3>
          <label class="check-inline"><input type="checkbox" id="fam-casa" checked /> ${e(t('registro.lostHouse'))}</label>
          <label class="check-inline"><input type="checkbox" id="fam-vehiculo" /> ${e(t('registro.lostVehicle'))}</label>
          <div class="field full" id="fam-vehiculo-det-wrap" hidden><label for="fam-vehiculo-det">${e(t('registro.vehicleDetail'))}</label><input id="fam-vehiculo-det" placeholder="${e(t('registro.vehicleDetailPh'))}" /></div>
          <div class="field full"><label for="fam-bienes">${e(t('registro.lostItems'))}</label><textarea id="fam-bienes" rows="3" placeholder="${e(t('registro.lostItemsPh'))}"></textarea></div>
        </section>

        <section class="fam-seccion">
          <h3 class="fam-seccion-titulo">${e(t('registro.photosTitle'))}</h3>
          <p class="field-help">${e(t('registro.photosHelp'))}</p>
          <input id="fam-fotos-input" type="file" accept="image/*" multiple />
          <div id="fam-fotos-grid" class="fam-fotos-grid"></div>
        </section>

        <input id="fam-web" name="web" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field" />
        <div class="form-actions"><button class="btn btn-primary" type="submit" id="fam-enviar">${e(t('registro.submit'))}</button></div>
        <div id="fam-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);

      recordarModal(() => abrirRegistroFamilia());

      // Semilla: una fila (quien registra suele ser el primer integrante).
      const cont = $('#fam-integrantes');
      cont.insertAdjacentHTML('beforeend', filaIntegrante());
      $('#fam-agregar').addEventListener('click', () => {
        cont.insertAdjacentHTML('beforeend', filaIntegrante());
      });
      cont.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-quitar]');
        if (!b) return;
        const fila = b.closest('[data-fila]');
        if (cont.querySelectorAll('[data-fila]').length > 1) fila.remove();
      });

      // Detalle de vehículo solo si perdió uno.
      $('#fam-vehiculo').addEventListener('change', (ev) => {
        $('#fam-vehiculo-det-wrap').hidden = !ev.target.checked;
      });

      // GPS opcional de dónde se están quedando.
      $('#fam-gps-btn').addEventListener('click', () => {
        if (!navigator.geolocation) { $('#fam-gps-txt').textContent = t('registro.gpsError'); return; }
        $('#fam-gps-txt').textContent = t('registro.gpsAsking');
        navigator.geolocation.getCurrentPosition(
          (pos) => { coords.lat = pos.coords.latitude; coords.lng = pos.coords.longitude;
            $('#fam-gps-txt').textContent = t('registro.gpsSet', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) }); },
          () => { $('#fam-gps-txt').textContent = t('registro.gpsError'); },
          { enableHighAccuracy: true, timeout: 10000 });
      });

      // Fotos: se comprimen en el navegador (≤1600px, jpeg) para subir livianas.
      $('#fam-fotos-input').addEventListener('change', async (ev) => {
        const files = Array.from(ev.target.files || []);
        for (const file of files) {
          if (fotos.length >= 12) break;
          try { fotos.push(await famComprimir(file)); } catch (err) { /* archivo no válido */ }
        }
        ev.target.value = '';
        famPintarFotos();
      });
      const grid = $('#fam-fotos-grid');
      grid.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-foto]');
        if (!b) return;
        fotos.splice(Number(b.dataset.foto), 1);
        famPintarFotos();
      });
      function famPintarFotos() {
        grid.innerHTML = fotos.map((src, i) => `<div class="fam-foto-thumb"><img src="${e(src)}" alt="" /><button class="fam-foto-x" type="button" data-foto="${i}" aria-label="${e(t('registro.photoRemove'))}">✕</button></div>`).join('');
      }

      $('#fam-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const nombre = $('#fam-nombre').value.trim();
        if (!nombre) { mostrarMensaje('#fam-message', 'error', t('registro.nameRequired')); return; }
        const integrantes = $$('#fam-integrantes [data-fila]').map((fila) => {
          const o = {};
          fila.querySelectorAll('[data-campo]').forEach((c) => { o[c.dataset.campo] = c.value.trim(); });
          return o;
        }).filter((o) => o.nombre || o.parentesco || o.edad);
        const boton = $('#fam-enviar');
        boton.disabled = true;
        mostrarMensaje('#fam-message', 'info', t('registro.sending'));
        try {
          const r = await window.SheetsService.post({
            accion: 'damnificado_registrar',
            web: $('#fam-web').value,
            responsableNombre: nombre,
            responsableTelefono: $('#fam-tel').value.trim(),
            responsableEmail: $('#fam-email').value.trim(),
            alojamiento: $('#fam-aloj').value.trim(),
            municipio: $('#fam-muni').value.trim(),
            estadoGeo: $('#fam-estado').value.trim(),
            gps: (coords.lat != null) ? coords : null,
            integrantes,
            sustentoPrincipal: $('#fam-sustento').value.trim(),
            fallecidos: $('#fam-fallecidos').value,
            fallecidosDetalle: $('#fam-fallecidos-det').value.trim(),
            perdioCasa: $('#fam-casa').checked,
            perdioVehiculo: $('#fam-vehiculo').checked,
            vehiculosDetalle: $('#fam-vehiculo-det').value.trim(),
            bienesPerdidos: $('#fam-bienes').value.trim(),
            fotos
          });
          famExito(r && r.codigo);
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#fam-message', 'error', String((err && err.message) || t('registro.error')));
        }
      });
    }

    function famComprimir(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('archivo'));
        fr.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('imagen'));
          img.onload = () => {
            const max = 1600;
            let w = img.width, h = img.height;
            if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.82));
          };
          img.src = fr.result;
        };
        fr.readAsDataURL(file);
      });
    }

    function famExito(codigo) {
      const root = $('#modal-root .modal-body') || $('#modal-root');
      root.innerHTML = `<div class="wizard-success">
        <span class="wizard-success-icon" aria-hidden="true">✓</span>
        <h2>${e(t('registro.successTitle'))}</h2>
        <p class="section-copy">${e(t('registro.successBody'))}</p>
        <div class="recibo"><div class="recibo-row"><span class="meta">${e(t('registro.codeLabel'))}</span><span class="token-value"><strong>${e(codigo || '')}</strong></span></div>
        <p class="meta">${e(t('registro.saveCode'))}</p>
        <button class="btn btn-soft btn-small" type="button" id="fam-copiar" data-copy="${e(codigo || '')}">${e(t('registro.copyCode'))}</button></div>
        <div class="wizard-success-actions"><a class="btn btn-primary" href="/">${e(t('registro.backHome'))}</a></div>
      </div>`;
      const copiar = $('#fam-copiar');
      if (copiar) copiar.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(copiar.dataset.copy || ''); toast(t('registro.copied')); }
        catch (err) { toast(copiar.dataset.copy || ''); }
      });
    }

    window.abrirRegistroFamilia = abrirRegistroFamilia;
