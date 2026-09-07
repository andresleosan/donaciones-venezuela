// Denuncias con video (plan 01). Grabador MediaRecorder (≥720p, ~1.5 Mbps),
// guardado cada 5 s en IndexedDB (a prueba de que rompan el teléfono) y en la red
// (denuncia_parcial); al detener ensambla → denuncia_crear. Funciona offline: los
// fragmentos quedan en IndexedDB y se suben al volver la conexión.
// Vista-página #denunciar (grabar) + #denuncias (lista pública anónima).
'use strict';

    const DEN_TOPE_S = 90;                 // corte automático (a ~1.5 Mbps ≈ 17 MB)
    const DEN_DB = 'dv-denuncias', DEN_CHUNKS = 'chunks', DEN_META = 'meta';
    const DEN_MIMES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

    // ── IndexedDB (persistencia local, aparte de la cola de services/api.js) ──
    function denAbrirDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DEN_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DEN_CHUNKS)) db.createObjectStore(DEN_CHUNKS, { keyPath: 'seq' });
          if (!db.objectStoreNames.contains(DEN_META)) db.createObjectStore(DEN_META, { keyPath: 'clave' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async function denPut(store, valor) {
      const db = await denAbrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(valor);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    async function denTodos(store) {
      const db = await denAbrirDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }
    async function denLimpiar() {
      const db = await denAbrirDB();
      return new Promise((resolve) => {
        const tx = db.transaction([DEN_CHUNKS, DEN_META], 'readwrite');
        tx.objectStore(DEN_CHUNKS).clear();
        tx.objectStore(DEN_META).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    async function denMeta() {
      const filas = await denTodos(DEN_META);
      return filas.find((m) => m.clave === 'actual') || null;
    }

    function blobADataURL(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }

    // ── Estado del grabador (una denuncia a la vez) ──
    const den = {
      stream: null, rec: null, chunks: [], mime: '', gps: null,
      tipo: 'Otro', facturaToken: '', id: null, enVuelo: false,
      t0: 0, timer: null, blobFinal: null
    };

    function denMmss(seg) {
      const m = Math.floor(seg / 60), s = Math.floor(seg % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    function denPintarTiempo() {
      const el = $('#den-timer');
      if (!el) return;
      const seg = (Date.now() - den.t0) / 1000;
      el.textContent = `${denMmss(seg)} / ${denMmss(DEN_TOPE_S)}`;
      if (seg >= DEN_TOPE_S) denDetener();
    }

    // Preselecciona «Retención de insumos» + adjunta el token si el transportista
    // va en tránsito (plan 07 expondrá viajeActivo()); hoy degrada sin fallar.
    function denContextoTransportista() {
      try {
        if (typeof window.viajeActivo === 'function') {
          const v = window.viajeActivo();
          if (v && v.token) return { tipo: 'Retención de insumos', facturaToken: v.token };
        }
      } catch (err) { /* sin viaje activo */ }
      return null;
    }

    function abrirDenunciar() {
      const s = (typeof sesionActual === 'function' && sesionActual()) || null;
      if (!s) { // guardia de sesión (por si se llama sin pasar por el router)
        try { sessionStorage.setItem('dv-retorno', '#denunciar'); } catch (err) { /* privado */ }
        toast(t('report.needSession'));
        window.location.hash = '#acceso';
        return;
      }
      const shell = $('#denunciar-shell');
      if (!shell) return;
      cambiarVista('denunciar');
      if (!/^#denunciar$/i.test(window.location.hash)) window.location.hash = '#denunciar';

      const ctx = denContextoTransportista();
      if (ctx) { den.tipo = ctx.tipo; den.facturaToken = ctx.facturaToken; }

      shell.innerHTML = `
        <p class="section-copy den-notice">⚠ ${e(t('report.locationNotice'))}</p>
        <div class="field full">
          <label id="den-tipo-label">${e(t('report.typeLabel'))}</label>
          <div class="segmented" role="group" aria-labelledby="den-tipo-label">
            <button class="btn btn-soft btn-small" type="button" data-den-tipo="Retención de insumos">${e(tValue('reportType', 'Retención de insumos'))}</button>
            <button class="btn btn-soft btn-small" type="button" data-den-tipo="Otro">${e(tValue('reportType', 'Otro'))}</button>
          </div>
        </div>
        <div class="den-stage">
          <video id="den-video" class="den-video" playsinline muted></video>
          <p id="den-timer" class="den-timer" role="timer" aria-live="off">0:00 / ${denMmss(DEN_TOPE_S)}</p>
        </div>
        <div class="den-controls">
          <button id="den-rec" class="den-trigger" type="button" aria-label="${e(t('report.startRec'))}"></button>
          <button id="den-stop" class="btn btn-ghost" type="button" hidden>${e(t('report.stopRec'))}</button>
        </div>
        <div id="den-post" hidden>
          <div class="field full">
            <label for="den-texto">${e(t('report.whatHappened'))}</label>
            <textarea id="den-texto" rows="3"></textarea>
          </div>
          <div class="form-actions"><button id="den-enviar" class="btn btn-primary" type="button">${e(t('report.send'))}</button></div>
        </div>
        <div id="den-message" class="form-message" role="status" aria-live="polite"></div>`;

      // Marca el chip activo según el tipo actual.
      const chips = $$('#denunciar-shell [data-den-tipo]');
      const marcar = () => chips.forEach((c) => c.classList.toggle('is-active', c.dataset.denTipo === den.tipo));
      chips.forEach((chip) => chip.addEventListener('click', () => { den.tipo = chip.dataset.denTipo; marcar(); }));
      marcar();

      den.gps = null;
      // GPS automático al entrar; si falla se puede grabar igual y se reintenta al enviar.
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { den.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }; },
          () => { /* la denuncia no se pierde por el GPS */ },
          { enableHighAccuracy: true, timeout: 10000 });
      }

      denPrepararCamara();
      $('#den-rec').addEventListener('click', () => (den.rec && den.rec.state === 'recording') ? denDetener() : denGrabar());
      $('#den-stop').addEventListener('click', denDetener);
      $('#den-enviar').addEventListener('click', denEnviarFinal);

      window.reconstruirDenunciar = () => {
        // Solo repinta si ESTA es la vista activa (si no, cambiar de idioma en otra
        // pantalla secuestraría la vista de vuelta a #denunciar).
        if (!/^#denunciar$/i.test(window.location.hash)) return;
        // Grabando NO se reconstruye (mataría el stream): el selector de idioma se
        // deshabilita mientras `recording` (ver core.js). En reposo, repinta.
        if (den.rec && den.rec.state === 'recording') return;
        if ($('#denunciar-shell') && $('#denunciar-shell').children.length) abrirDenunciar();
      };
    }

    async function denPrepararCamara() {
      try {
        den.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
          audio: true
        });
      } catch (err) {
        mostrarMensaje('#den-message', 'error', t('report.cameraError'));
        const rec = $('#den-rec'); if (rec) rec.disabled = true;
        return;
      }
      const video = $('#den-video');
      if (video) { video.srcObject = den.stream; video.play().catch(() => {}); }
      den.mime = DEN_MIMES.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    }

    async function denGrabar() {
      if (!den.stream || !window.MediaRecorder) { mostrarMensaje('#den-message', 'error', t('report.cameraError')); return; }
      // Borra los fragmentos de una toma anterior sin enviar: el keyPath `seq` los
      // sobrescribiría parcialmente y se subiría un video mezclado (RQ-PLAT-6).
      await denLimpiar();
      den.chunks = []; den.id = null; den.enVuelo = false; den.blobFinal = null;
      try {
        den.rec = den.mime ? new MediaRecorder(den.stream, { mimeType: den.mime, videoBitsPerSecond: 1_500_000 })
                           : new MediaRecorder(den.stream, { videoBitsPerSecond: 1_500_000 });
      } catch (err) { mostrarMensaje('#den-message', 'error', t('report.cameraError')); return; }
      if (!den.mime) den.mime = den.rec.mimeType || 'video/webm';
      den.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) denChunk(ev.data); };
      den.rec.onstop = denAlDetener;
      den.rec.start(5000); // ← dataavailable cada 5 s
      den.t0 = Date.now();
      denPintarTiempo();
      den.timer = window.setInterval(denPintarTiempo, 250);
      $('#den-rec').classList.add('is-recording');
      $('#den-rec').setAttribute('aria-label', t('report.stopRec'));
      $('#den-stop').hidden = false;
      $('#den-post').hidden = true;
      // Cambiar de idioma reconstruye vistas y mataría el stream: se bloquea el
      // selector mientras se graba (reconstruirDenunciar además retorna vacío).
      const sel = $('#language-select');
      if (sel) { sel.disabled = true; sel.title = t('report.langLocked'); }
      mostrarMensaje('#den-message', 'info', t('report.recording'));
    }

    // Cada 5 s: 1) IndexedDB primero (a prueba de accidente); 2) red si hay y si el
    // envío anterior no sigue en vuelo (en red lenta no se acumulan).
    async function denChunk(blob) {
      den.chunks.push(blob);
      const seq = den.chunks.length - 1;
      try { await denPut(DEN_CHUNKS, { seq, blob, ts: Date.now() }); } catch (err) { /* cuota */ }
      try {
        await denPut(DEN_META, { clave: 'actual', tipo: den.tipo, gps: den.gps,
          facturaToken: den.facturaToken, mime: den.mime, seqMax: seq, ts: Date.now() });
      } catch (err) { /* cuota */ }
      if (navigator.onLine === false || den.enVuelo) return;
      den.enVuelo = true;
      try {
        // Solo se anota que la grabación sigue viva: el vídeo se sube una vez,
        // al enviar. El legado resubía el vídeo entero cada ~5 s (hasta 30 MB
        // por parcial) para acabar sustituyéndolo otra vez al final.
        const resp = await window.SheetsService.post({
          accion: 'denuncia_parcial', accessToken: (sesionActual() || {}).access_token,
          denunciaId: den.id, duracionS: Math.round((Date.now() - den.t0) / 1000),
          tipo: den.tipo, gps: den.gps, facturaToken: den.facturaToken });
        if (resp && resp.id) den.id = resp.id;
      } catch (err) { /* se reintenta en el próximo chunk o al enviar */ }
      den.enVuelo = false;
    }

    function denDetener() {
      if (den.rec && den.rec.state === 'recording') den.rec.stop();
    }

    function denAlDetener() {
      window.clearInterval(den.timer);
      $('#den-rec').classList.remove('is-recording');
      $('#den-rec').setAttribute('aria-label', t('report.startRec'));
      $('#den-stop').hidden = true;
      const sel = $('#language-select');
      if (sel) { sel.disabled = false; sel.removeAttribute('title'); }
      den.blobFinal = new Blob(den.chunks, { type: den.mime });
      const video = $('#den-video');
      if (video) { video.srcObject = null; video.src = URL.createObjectURL(den.blobFinal); video.muted = false; video.controls = true; }
      $('#den-post').hidden = false;
      mostrarMensaje('#den-message', 'info', t('report.reviewSend'));
    }

    async function denEnviarFinal() {
      if (!den.blobFinal && !den.chunks.length) { mostrarMensaje('#den-message', 'error', t('report.noVideo')); return; }
      const s = sesionActual();
      if (!s) { mostrarMensaje('#den-message', 'error', t('report.needSession')); return; }
      const boton = $('#den-enviar'); boton.disabled = true;
      mostrarMensaje('#den-message', 'info', t('report.sending'));
      try {
        const blob = den.blobFinal || new Blob(den.chunks, { type: den.mime });
        const dataUrl = await blobADataURL(blob);
        await window.SheetsService.post({
          accion: 'denuncia_crear', accessToken: s.access_token, denunciaId: den.id,
          tipo: den.tipo, gps: den.gps, texto: ($('#den-texto') && $('#den-texto').value.trim()) || '',
          facturaToken: den.facturaToken, videoBase64: dataUrl,
          duracionS: Math.round((den.chunks.length * 5)) });
        await denLimpiar();
        denApagarCamara();
        mostrarMensaje('#den-message', 'success', t('report.done'));
        $('#den-post').hidden = true;
        const controles = $('#denunciar-shell .den-controls'); if (controles) controles.hidden = true;
        window.setTimeout(() => { window.location.hash = '#denuncias'; }, 1200);
      } catch (err) {
        boton.disabled = false;
        mostrarMensaje('#den-message', 'error', String((err && err.message) || t('report.sendError')));
      }
    }

    function denApagarCamara() {
      if (den.stream) den.stream.getTracks().forEach((tk) => tk.stop());
      den.stream = null;
    }

    // ── Reanudar una denuncia pendiente (offline): banner + botón enviar ──
    async function denRevisarPendiente() {
      let meta = null;
      try { meta = await denMeta(); } catch (err) { return; }
      const banner = $('#den-pendiente');
      if (!banner) return;
      if (!meta) { banner.hidden = true; return; }
      banner.hidden = false;
      banner.innerHTML = `<span>${e(t('report.pendingUpload'))}</span>
        <button class="btn btn-small btn-primary" type="button" id="den-pendiente-enviar">${e(t('report.send'))}</button>`;
      $('#den-pendiente-enviar').addEventListener('click', () => denSubirPendiente(meta));
    }
    async function denSubirPendiente(meta) {
      const s = sesionActual();
      if (!s) { window.location.hash = '#acceso'; return; }
      const btn = $('#den-pendiente-enviar'); if (btn) btn.disabled = true;
      try {
        const chunks = (await denTodos(DEN_CHUNKS)).sort((a, b) => a.seq - b.seq).map((c) => c.blob);
        if (!chunks.length) { await denLimpiar(); await denRevisarPendiente(); return; }
        const dataUrl = await blobADataURL(new Blob(chunks, { type: meta.mime || 'video/webm' }));
        await window.SheetsService.post({
          accion: 'denuncia_crear', accessToken: s.access_token,
          tipo: meta.tipo || 'Otro', gps: meta.gps, facturaToken: meta.facturaToken || '',
          videoBase64: dataUrl, duracionS: (meta.seqMax + 1) * 5 });
        await denLimpiar();
        toast(t('report.done'));
        await denRevisarPendiente();
      } catch (err) {
        if (btn) btn.disabled = false;
        toast(String((err && err.message) || t('report.sendError')));
      }
    }

    // ── Vista pública #denuncias (anónima: nada de identidad en el DOM) ──
    async function abrirDenuncias() {
      const shell = $('#denuncias-shell');
      if (!shell) return;
      cambiarVista('denuncias');
      if (!/^#denuncias$/i.test(window.location.hash)) window.location.hash = '#denuncias';
      // La lista pide sesión: cada fila lleva la zona desde donde alguien
      // denunció, y eso no se sirve a cualquiera que abra la página.
      if (!sesionActual()) {
        shell.innerHTML = `<p class="empty-state">${e(t('report.needSessionToList'))}</p>
          <p><a class="btn btn-primary" href="#acceso">${e(t('report.goToLogin'))}</a></p>`;
        return;
      }
      shell.innerHTML = `<p class="meta">${e(t('report.loading'))}</p>`;
      let filas = [];
      try { filas = (await window.SheetsService.post({ accion: 'denuncias_listar' })).denuncias || []; }
      catch (err) { shell.innerHTML = `<p class="form-message error visible">${e(t('report.loadError'))}</p>`; return; }
      denPintarLista(shell, filas);
      window.reconstruirDenuncias = () => {
        if (!/^#denuncias$/i.test(window.location.hash)) return;
        if ($('#denuncias-shell') && $('#denuncias-shell').children.length) denPintarLista(shell, filas);
      };
    }
    function denPintarLista(shell, filas) {
      if (!filas.length) { shell.innerHTML = `<p class="meta">${e(t('report.empty'))}</p>`; return; }
      shell.innerHTML = filas.map((d, i) => {
        const fecha = new Date(d.created_at);
        const coords = (d.gps_lat != null && d.gps_lng != null) ? `${Number(d.gps_lat).toFixed(5)}, ${Number(d.gps_lng).toFixed(5)}` : t('report.noCoords');
        const mapa = (d.gps_lat != null && d.gps_lng != null) ? `<div class="den-mini-map" id="den-map-${i}" data-lat="${e(String(d.gps_lat))}" data-lng="${e(String(d.gps_lng))}"></div>` : '';
        return `<article class="card den-card">
          <div class="badge-row"><span class="badge gray">${e(tValue('reportType', d.tipo))}</span><span class="badge">${e(tValue('reportState', d.estado))}</span></div>
          ${d.tieneVideo ? `<button class="btn btn-soft btn-small" type="button" data-den-video="${e(d.id)}">${e(t('report.playVideo'))}</button><video class="den-video" controls preload="none" hidden></video>` : `<p class="meta">${e(t('report.videoUnavailable'))}</p>`}
          <p class="meta">${e(fecha.toLocaleDateString())} · ${e(fecha.toLocaleTimeString())}</p>
          <p class="meta">📍 ${e(coords)}</p>
          ${mapa}
        </article>`;
      }).join('');
      // El vídeo no viene con la lista: se pide una URL firmada de 120 s al
      // pulsar play, y solo del que se va a mirar. El legado firmaba una de una
      // hora por cada vídeo en cada apertura de la página.
      $$('#denuncias-shell [data-den-video]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const { url } = await window.SheetsService.post({ accion: 'denuncia_video', id: b.dataset.denVideo });
          const video = b.parentElement.querySelector('.den-video');
          video.src = url; video.hidden = false; b.hidden = true;
          video.play().catch(() => { /* el navegador puede exigir un gesto más */ });
        } catch (err) { b.disabled = false; toast(String((err && err.message) || t('report.loadError'))); }
      }));
      // Mini-mapas Leaflet (si está cargado): un punto por denuncia. El zoom es
      // corto a propósito: la coordenada va redondeada a ~1 km y un zoom de
      // calle daría a entender una precisión que el dato ya no tiene.
      if (window.L) filas.forEach((d, i) => {
        const cont = $(`#den-map-${i}`);
        if (!cont || d.gps_lat == null) return;
        const m = L.map(cont, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false })
          .setView([Number(d.gps_lat), Number(d.gps_lng)], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
        L.marker([Number(d.gps_lat), Number(d.gps_lng)]).addTo(m);
        setTimeout(() => m.invalidateSize(), 60);
      });
    }

    window.abrirDenunciar = abrirDenunciar;
    window.abrirDenuncias = abrirDenuncias;
    window.denRevisarPendiente = denRevisarPendiente;
    window.denApagarCamara = denApagarCamara;
    // Cerrar pestaña / salir del SPA / segundo plano no pasan por cambiarVista.
    window.addEventListener('pagehide', () => { denApagarCamara(); });
    // Al volver la conexión, reintenta subir lo pendiente (mismo espíritu que la cola).
    window.addEventListener('online', () => { denRevisarPendiente(); });
