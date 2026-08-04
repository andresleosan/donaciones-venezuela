// Damnificados. Dos flujos:
//  1) abrirRegistroFamilia (ventana /registro-familia): el responsable registra a
//     su familia, PASO A PASO (reusa wizPublico, como los demás formularios). Envío
//     público sin login → la edge fn escribe en familias_damnificadas (RLS) y sube
//     las fotos al bucket PRIVADO. Nada de esto se lista jamás en público.
//  2) abrirFamiliasAfectadas (ventana /familias-afectadas): lista PÚBLICA y
//     ANONIMIZADA (vista familias_public por PostgREST). Solo área general, conteos
//     y banderas de alto nivel; nombres, contacto, dirección, GPS, condiciones
//     médicas y fotos NUNCA salen de aquí.
// Reusa los helpers globales de core.js ($, e, t, tValue, abrirModal, toast…).
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
          <div class="fam-miembro-grid">
            <label for="fam-m-nombre-${i}">${e(t('registro.mName'))}</label>
            <input id="fam-m-nombre-${i}" data-campo="nombre" />
            <label for="fam-m-rel-${i}">${e(t('registro.mRel'))}</label>
            <select id="fam-m-rel-${i}" data-campo="parentesco">${opcionesRel}</select>
            <label for="fam-m-edad-${i}">${e(t('registro.mAge'))}</label>
            <input id="fam-m-edad-${i}" data-campo="edad" type="number" min="0" max="120" inputmode="numeric" />
            <label for="fam-m-ocup-${i}">${e(t('registro.mJob'))}</label>
            <input id="fam-m-ocup-${i}" data-campo="ocupacion" placeholder="${e(t('registro.mJobPh'))}" />
            <label for="fam-m-med-${i}">${e(t('registro.mMed'))}</label>
            <input id="fam-m-med-${i}" data-campo="condicionMedica" placeholder="${e(t('registro.mMedPh'))}" />
            <label for="fam-m-notas-${i}">${e(t('registro.mNotes'))}</label>
            <input id="fam-m-notas-${i}" data-campo="notas" />
          </div>
          <button class="btn btn-ghost btn-small fam-quitar" type="button" data-quitar="${i}">${e(t('registro.removeMember'))}</button>
        </div>`;
      };

      // Cada bloque [data-wiz-step] es UNA pantalla del asistente. Los campos sueltos
      // (.field) también son una pantalla cada uno (así lo maneja wizPublico).
      abrirModal(t('registro.pageTitle'), `<form id="fam-form" novalidate>
        <p class="section-copy">${e(t('registro.intro'))}</p>
        <p class="field-help fam-privacy">🔒 ${e(t('registro.privacy'))}</p>

        <div data-wiz-step class="field full" data-paso="contacto">
          <label for="fam-nombre">${e(t('registro.name'))}</label>
          <input id="fam-nombre" required placeholder="${e(t('registro.namePh'))}" />
          <label for="fam-tel">${e(t('registro.phone'))}</label>
          <input id="fam-tel" type="tel" inputmode="tel" />
          <label for="fam-email">${e(t('registro.email'))}</label>
          <input id="fam-email" type="email" autocomplete="email" />
        </div>

        <div data-wiz-step class="field full" data-paso="donde">
          <label for="fam-aloj">${e(t('registro.stayWhere'))}</label>
          <textarea id="fam-aloj" rows="2" placeholder="${e(t('registro.stayWherePh'))}"></textarea>
          <label for="fam-muni">${e(t('registro.municipio'))}</label>
          <input id="fam-muni" />
          <label for="fam-estado">${e(t('registro.estado'))}</label>
          <input id="fam-estado" />
          <div class="fam-gps">
            <button class="btn btn-soft btn-small" type="button" id="fam-gps-btn">📍 ${e(t('registro.gpsBtn'))}</button>
            <span class="meta" id="fam-gps-txt" aria-live="polite">${e(t('registro.gpsNone'))}</span>
          </div>
        </div>

        <div data-wiz-step class="field full" data-paso="familia">
          <label>${e(t('registro.membersTitle'))}</label>
          <p class="field-help">${e(t('registro.membersHelp'))}</p>
          <div id="fam-integrantes"></div>
          <button class="btn btn-soft btn-small" type="button" id="fam-agregar">＋ ${e(t('registro.addMember'))}</button>
        </div>

        <div class="field full" data-paso="sustento">
          <label for="fam-sustento">${e(t('registro.livelihood'))}</label>
          <p class="field-help">${e(t('registro.livelihoodHelp'))}</p>
          <textarea id="fam-sustento" rows="2" placeholder="${e(t('registro.livelihoodPh'))}"></textarea>
        </div>

        <div data-wiz-step class="field full" data-paso="fallecidos">
          <label for="fam-fallecidos">${e(t('registro.deceasedCount'))}</label>
          <input id="fam-fallecidos" type="number" min="0" max="99" inputmode="numeric" value="0" />
          <label for="fam-fallecidos-det">${e(t('registro.deceasedDetail'))}</label>
          <input id="fam-fallecidos-det" placeholder="${e(t('registro.deceasedDetailPh'))}" />
        </div>

        <div data-wiz-step class="field full" data-paso="bienes">
          <label>${e(t('registro.lossesTitle'))}</label>
          <label class="check-inline"><input type="checkbox" id="fam-casa" checked /> ${e(t('registro.lostHouse'))}</label>
          <label class="check-inline"><input type="checkbox" id="fam-vehiculo" /> ${e(t('registro.lostVehicle'))}</label>
          <div id="fam-vehiculo-det-wrap" hidden><label for="fam-vehiculo-det">${e(t('registro.vehicleDetail'))}</label><input id="fam-vehiculo-det" placeholder="${e(t('registro.vehicleDetailPh'))}" /></div>
          <label for="fam-bienes">${e(t('registro.lostItems'))}</label>
          <textarea id="fam-bienes" rows="3" placeholder="${e(t('registro.lostItemsPh'))}"></textarea>
        </div>

        <div data-wiz-step class="field full" data-paso="fotos">
          <label>${e(t('registro.photosTitle'))}</label>
          <p class="field-help">${e(t('registro.photosHelp'))}</p>
          <input id="fam-fotos-input" type="file" accept="image/*" capture="environment" multiple />
          <div id="fam-fotos-grid" class="fam-fotos-grid"></div>
        </div>

        <input id="fam-web" name="web" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field" />
        <div class="form-actions"><button class="btn btn-primary" type="submit" id="fam-enviar">${e(t('registro.submit'))}</button></div>
        <div id="fam-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);

      recordarModal(() => abrirRegistroFamilia());

      const cont = $('#fam-integrantes');
      cont.insertAdjacentHTML('beforeend', filaIntegrante());
      $('#fam-agregar').addEventListener('click', () => cont.insertAdjacentHTML('beforeend', filaIntegrante()));
      cont.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-quitar]');
        if (!b) return;
        if (cont.querySelectorAll('[data-fila]').length > 1) b.closest('[data-fila]').remove();
      });

      $('#fam-vehiculo').addEventListener('change', (ev) => {
        $('#fam-vehiculo-det-wrap').hidden = !ev.target.checked;
      });

      $('#fam-gps-btn').addEventListener('click', () => {
        if (!navigator.geolocation) { $('#fam-gps-txt').textContent = t('registro.gpsError'); return; }
        $('#fam-gps-txt').textContent = t('registro.gpsAsking');
        navigator.geolocation.getCurrentPosition(
          (pos) => { coords.lat = pos.coords.latitude; coords.lng = pos.coords.longitude;
            $('#fam-gps-txt').textContent = t('registro.gpsSet', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) }); },
          () => { $('#fam-gps-txt').textContent = t('registro.gpsError'); },
          { enableHighAccuracy: true, timeout: 10000 });
      });

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

      // Cambiar de idioma reconstruye este modal entero (core.js: cambiarIdioma →
      // guardarEstadoModal / restaurarEstadoModal). Lo que no vive en un control
      // con id —las fotos, el GPS y los integrantes añadidos— se salva por este
      // gancho, igual que .of-cam salva las suyas con __camara. RQ-IDIOMA-4.
      const dialogFam = $('#modal-root dialog');
      if (dialogFam) dialogFam.__estadoExtra = {
        guardar() {
          return {
            fotos: fotos.slice(),
            coords: { lat: coords.lat, lng: coords.lng },
            miembros: Array.from(cont.querySelectorAll('[data-fila]')).map((fila) => {
              const datos = {};
              Array.from(fila.querySelectorAll('[data-campo]')).forEach((c) => { datos[c.dataset.campo] = c.value; });
              return datos;
            })
          };
        },
        restaurar(est) {
          if (!est) return;
          if (est.fotos && est.fotos.length) { fotos.push.apply(fotos, est.fotos); famPintarFotos(); }
          if (est.coords && est.coords.lat != null) {
            coords.lat = est.coords.lat;
            coords.lng = est.coords.lng;
            $('#fam-gps-txt').textContent = t('registro.gpsSet', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) });
          }
          // Por POSICIÓN, no por id: al reconstruirse, filaSeq vuelve a 0 y los
          // ids de las filas no tienen por qué coincidir con los de antes.
          const filas = est.miembros || [];
          if (!filas.length) return;
          cont.innerHTML = '';
          filaSeq = 0;
          filas.forEach(() => cont.insertAdjacentHTML('beforeend', filaIntegrante()));
          Array.from(cont.querySelectorAll('[data-fila]')).forEach((fila, i) => {
            Object.keys(filas[i]).forEach((campo) => {
              const c = fila.querySelector('[data-campo="' + campo + '"]');
              if (c) c.value = filas[i][campo];
            });
          });
        }
      };

      // Resumen legible por paso (lo muestra la pantalla de "Confirmar").
      function famResumen(p) {
        switch (p.dataset.paso) {
          case 'contacto': return $('#fam-nombre').value.trim() || '—';
          case 'donde': return [$('#fam-aloj').value.trim(), $('#fam-muni').value.trim(), $('#fam-estado').value.trim()].filter(Boolean).join(' · ') || '—';
          case 'familia': {
            const n = $$('#fam-integrantes [data-fila]').filter((f) => (f.querySelector('[data-campo="nombre"]').value || '').trim()).length;
            return n ? t('registro.summaryMembers', { n: n }) : '—';
          }
          case 'fallecidos': {
            const n = Number($('#fam-fallecidos').value) || 0;
            return n ? String(n) : t('registro.deceasedNone');
          }
          case 'bienes': {
            const partes = [];
            if ($('#fam-casa').checked) partes.push(t('registro.lostHouse'));
            if ($('#fam-vehiculo').checked) partes.push(t('registro.lostVehicle'));
            if ($('#fam-bienes').value.trim()) partes.push('…');
            return partes.join(' · ') || '—';
          }
          case 'fotos': return fotos.length ? t('registro.summaryPhotos', { n: fotos.length }) : '—';
          default: return '';
        }
      }

      // Asistente 1-a-1 (mismo motor que transportista / recogida / entrega).
      wizPublico('fam-form', {
        validar: (p) => {
          if (p.dataset.paso) p.dataset.wizDone = famResumen(p);
          return undefined; // deja correr la validez nativa (nombre requerido)
        }
      });

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
        famMensaje('#fam-message', 'info', t('registro.sending'));
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
            integrantes: integrantes,
            sustentoPrincipal: $('#fam-sustento').value.trim(),
            fallecidos: $('#fam-fallecidos').value,
            fallecidosDetalle: $('#fam-fallecidos-det').value.trim(),
            perdioCasa: $('#fam-casa').checked,
            perdioVehiculo: $('#fam-vehiculo').checked,
            vehiculosDetalle: $('#fam-vehiculo-det').value.trim(),
            bienesPerdidos: $('#fam-bienes').value.trim(),
            fotos: fotos
          });
          famExito(r && r.codigo);
        } catch (err) {
          boton.disabled = false;
          famMensaje('#fam-message', 'error', String((err && err.message) || t('registro.error')));
        }
      });
    }

    // mostrarMensaje vive en vistas.js, que NO se carga en ventana.html; helper local.
    function famMensaje(sel, tipo, txt) {
      const box = $(sel);
      if (!box) return;
      box.className = `form-message visible ${tipo}`;
      box.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
      box.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');
      box.textContent = txt;
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

    // ── Página pública: familias afectadas (anónima) ──
    async function abrirFamiliasAfectadas() {
      abrirModal(t('familiasPub.pageTitle'), `<div class="fam-pub">
        <header class="fam-pub-head">
          <h1>${e(t('familiasPub.title'))}</h1>
          <p class="section-copy">${e(t('familiasPub.intro'))}</p>
          <p class="field-help fam-privacy">🔒 ${e(t('familiasPub.privacy'))}</p>
        </header>
        <div id="fam-pub-lista" class="fam-pub-lista" aria-live="polite"><p class="meta">${e(t('familiasPub.loading'))}</p></div>
        <p class="meta fam-pub-ayuda">${e(t('familiasPub.help'))}</p>
      </div>`);
      let filas = [];
      try { filas = (await window.SheetsService.getFamiliasPublicas()).data || []; }
      catch (err) { const l = $('#fam-pub-lista'); if (l) l.innerHTML = `<p class="form-message error visible">${e(t('familiasPub.error'))}</p>`; return; }
      famPubPintar(filas);
      window.reconstruirFamiliasAfectadas = () => { document.title = t('familiasPub.pageTitle'); if ($('#fam-pub-lista')) famPubPintar(filas); };
    }

    function famPubPintar(filas) {
      const cont = $('#fam-pub-lista');
      if (!cont) return;
      if (!filas.length) { cont.innerHTML = `<p class="empty-state">${e(t('familiasPub.empty'))}</p>`; return; }
      const tarjetas = filas.map((f) => {
        const personas = Number(f.num_personas) || 0;
        const menores = Number(f.num_menores) || 0;
        const chips = [];
        if (f.perdio_casa) chips.push(`<span class="fam-chip">🏠 ${e(t('familiasPub.lostHouse'))}</span>`);
        if (f.perdio_vehiculo) chips.push(`<span class="fam-chip">🚗 ${e(t('familiasPub.lostVehicle'))}</span>`);
        if (f.necesidad_medica) chips.push(`<span class="fam-chip fam-chip-med">⚕️ ${e(t('familiasPub.medical'))}</span>`);
        if (f.perdio_familiar) chips.push(`<span class="fam-chip">🕊️ ${e(t('familiasPub.bereaved'))}</span>`);
        const lugar = [f.municipio, f.estado_geo].filter(Boolean).join(', ');
        const gente = personas === 1 ? t('familiasPub.person1') : t('familiasPub.people', { n: personas });
        const menoresTxt = menores ? ` · ${e(menores === 1 ? t('familiasPub.minor1') : t('familiasPub.minors', { n: menores }))}` : '';
        return `<article class="fam-pub-card">
          <div class="fam-pub-top">
            <span class="badge">${e(tValue('familyStatePublic', f.estado) || t('familiasPub.waiting'))}</span>
            <span class="fam-pub-code">${e(f.codigo || '')}</span>
          </div>
          <p class="fam-pub-people"><strong>${e(gente)}</strong>${menoresTxt}</p>
          ${lugar ? `<p class="meta">📍 ${e(lugar)}</p>` : ''}
          ${chips.length ? `<div class="fam-pub-chips">${chips.join('')}</div>` : ''}
        </article>`;
      }).join('');
      cont.innerHTML = `<p class="meta fam-pub-count">${e(t('familiasPub.count', { n: filas.length }))}</p><div class="fam-pub-grid">${tarjetas}</div>`;
    }

    window.abrirRegistroFamilia = abrirRegistroFamilia;
    window.abrirFamiliasAfectadas = abrirFamiliasAfectadas;
