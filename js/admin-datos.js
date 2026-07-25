// Consola de datos del admin — fontanería compartida de las pantallas a medida.
// Aquí vive TODO lo que se repite: lista con buscador y paginación, ficha, guardado,
// confirmación de borrado, aviso de duplicados y bitácora. Lo que cambia de una
// entidad a otra vive en admin-personas.js y admin-centros.js.
// Scope global compartido (sin módulos ni IIFE), igual que el resto de js/.
'use strict';

    // Cada pantalla se registra aquí: { icono, titulo() , abrir() }.
    // Lo rellenan admin-personas.js y admin-centros.js; lo lee irAMenu() de admin.js.
    const DV_DATOS_PANELES = {};

    const DV_POR_PAGINA = 25;
    let dvLista = { entidad: '', pagina: 1, busca: '', total: 0, filas: [] };
    let dvCentrosCache = null;

    function dvTexto(clave, params) { return t('datos.' + clave, params); }
    function dvError(err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }

    // Los centros se piden una vez y se reutilizan: los selectores de «a qué centro
    // pertenece esto» aparecen en varias pantallas.
    async function dvCentros() {
      if (dvCentrosCache) return dvCentrosCache;
      const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'lugares', porPagina: 100 });
      dvCentrosCache = (r.filas || []).map((l) => ({ id: l.id, nombre: l.nombre }));
      return dvCentrosCache;
    }

    // Un campo declarado como 'ref' se convierte en un desplegable de centros.
    async function dvCamposResueltos(cfg) {
      const campos = cfg.campos.map((c) => Object.assign({}, c));
      for (const c of campos) {
        if (c.tipo !== 'ref') continue;
        c.tipo = 'opcion';
        c.numerico = true;
        c.opcionesValor = await dvCentros();
      }
      return campos;
    }

    function dvCampoHtml(campo, valor) {
      const id = 'dvc-' + campo.id;
      const v = valor == null ? '' : String(valor);
      if (campo.tipo === 'opcion') {
        const pares = campo.opcionesValor
          ? campo.opcionesValor.map((o) => [String(o.id), String(o.nombre)])
          : (campo.opciones || []).map((o) => [o, o]);
        const ops = pares.map(([val, lab]) =>
          `<option value="${e(val)}"${val === v ? ' selected' : ''}>${e(lab)}</option>`).join('');
        return `<div class="field"><label for="${id}">${e(campo.etiqueta)}</label><select id="${id}">${ops}</select></div>`;
      }
      if (campo.tipo === 'booleano') {
        return `<div class="field"><label class="check-inline"><input id="${id}" type="checkbox"${v === 'true' ? ' checked' : ''} /> ${e(campo.etiqueta)}</label></div>`;
      }
      if (campo.tipo === 'texto-largo') {
        return `<div class="field full"><label for="${id}">${e(campo.etiqueta)}</label><textarea id="${id}" rows="3">${e(v)}</textarea></div>`;
      }
      const tipoHtml = campo.tipo === 'numero' || campo.tipo === 'coord' ? 'number'
        : campo.tipo === 'email' ? 'email' : campo.tipo === 'telefono' ? 'tel' : 'text';
      const paso = campo.tipo === 'coord' ? ' step="any"' : '';
      return `<div class="field"><label for="${id}">${e(campo.etiqueta)}</label><input id="${id}" type="${tipoHtml}"${paso} value="${e(v)}" /></div>`;
    }

    function dvLeerCampos(campos) {
      const datos = {};
      for (const c of campos) {
        const el = $('#dvc-' + c.id);
        if (!el) continue;
        if (c.tipo === 'booleano') datos[c.id] = el.checked;
        else if (c.numerico) datos[c.id] = Number(el.value);
        else if (c.tipo === 'numero' || c.tipo === 'coord') datos[c.id] = el.value === '' ? '' : Number(el.value);
        else datos[c.id] = el.value.trim();
      }
      return datos;
    }

    // ---- Lista ----
    async function dvDatosLista(cfg) {
      dvLista = { entidad: cfg.entidad, pagina: 1, busca: '', total: 0, filas: [] };
      $('#admin-console').innerHTML = marcoGestion(cfg.titulo, `
        <div class="datos-barra">
          <div class="field">
            <label for="datos-busca">${e(dvTexto('search'))}</label>
            <input id="datos-busca" type="search" placeholder="${e(dvTexto('searchPh'))}" />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" id="datos-nuevo">${e(dvTexto('new'))}</button>
            <button class="btn btn-soft btn-small" type="button" id="datos-dups">${e(dvTexto('dupPanel'))}</button>
          </div>
        </div>
        <div id="datos-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>
        <div class="datos-pag">
          <button class="btn btn-soft btn-small" type="button" id="datos-prev">${e(dvTexto('prev'))}</button>
          <span class="meta" id="datos-cuenta"></span>
          <button class="btn btn-soft btn-small" type="button" id="datos-next">${e(dvTexto('next'))}</button>
        </div>`);
      bindGestMenu();
      $('#datos-nuevo').addEventListener('click', () => dvDatosNuevo(cfg));
      $('#datos-dups').addEventListener('click', () => dvPanelDuplicados(cfg));
      $('#datos-prev').addEventListener('click', () => {
        if (dvLista.pagina > 1) { dvLista.pagina--; dvPintarFilas(cfg); }
      });
      $('#datos-next').addEventListener('click', () => {
        if (dvLista.pagina * DV_POR_PAGINA < dvLista.total) { dvLista.pagina++; dvPintarFilas(cfg); }
      });
      // El buscador consulta al SERVIDOR: la lista puede ser mucho más larga que la
      // página que se está viendo, así que filtrar en el navegador mentiría.
      let temporizador = null;
      $('#datos-busca').addEventListener('input', (ev) => {
        const valor = ev.target.value;
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
          dvLista.busca = valor; dvLista.pagina = 1; dvPintarFilas(cfg);
        }, 300);
      });
      await dvPintarFilas(cfg);
    }

    async function dvPintarFilas(cfg) {
      const cont = $('#datos-filas');
      if (!cont) return;
      cont.innerHTML = `<p class="empty-state">${e(dvTexto('loading'))}</p>`;
      try {
        const r = await postAdmin({ accion: 'admin_datos_listar', entidad: cfg.entidad,
          busca: dvLista.busca, pagina: dvLista.pagina, porPagina: DV_POR_PAGINA });
        dvLista.filas = r.filas || [];
        dvLista.total = r.total || 0;
      } catch (err) { dvError(err); return; }
      const pk = cfg.pk || 'id';
      cont.innerHTML = dvLista.filas.map((item) =>
        `<button class="admin-record" type="button" data-datos-id="${e(String(item[pk]))}">${cfg.fila(item)}</button>`
      ).join('') || `<p class="empty-state">${e(dvTexto('empty'))}</p>`;
      $$('#datos-filas [data-datos-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.datosId)));
      const desde = dvLista.total ? (dvLista.pagina - 1) * DV_POR_PAGINA + 1 : 0;
      const hasta = Math.min(dvLista.pagina * DV_POR_PAGINA, dvLista.total);
      $('#datos-cuenta').textContent = dvTexto('showing', { desde, hasta, total: dvLista.total });
    }

    // ---- Ficha ----
    async function dvDatosFicha(cfg, id) {
      try {
        const res = await postAdmin({ accion: 'admin_datos_ficha', entidad: cfg.entidad, id });
        await dvPintarFicha(cfg, res.fila || {}, res.fotos || [], res.dependientes || [], id);
      } catch (err) { dvError(err); }
    }

    async function dvDatosNuevo(cfg) { await dvPintarFicha(cfg, {}, [], [], null); }

    async function dvPintarFicha(cfg, fila, fotos, dependientes, id) {
      const campos = await dvCamposResueltos(cfg);
      const etiqueta = cfg.etiqueta || 'nombre';
      const fotosHtml = fotos.length ? `
        <div class="datos-fotos">
          <h4>${e(dvTexto('photos'))}</h4>
          ${fotos.map((f) => `<a class="btn btn-soft btn-small" target="_blank" rel="noopener" href="${e(f.url)}">${e(dvTexto('photoOpen'))} · ${e(f.campo)}</a>`).join('')}
        </div>` : '';
      const titulo = id ? `${cfg.titulo} · ${String(fila[etiqueta] || '')}` : `${cfg.titulo} · ${dvTexto('new')}`;
      $('#admin-console').innerHTML = marcoGestion(titulo, `
        <div class="admin-form-card">
          ${cfg.extras ? cfg.extras(fila, dependientes) : ''}
          <div class="form-grid">${campos.map((c) => dvCampoHtml(c, fila[c.id])).join('')}</div>
          ${fotosHtml}
          <div id="datos-dup" class="form-message"></div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" id="datos-guardar">${e(dvTexto('save'))}</button>
            <button class="btn btn-ghost" type="button" id="datos-volver">${e(dvTexto('cancel'))}</button>
            ${id ? `<button class="btn btn-danger" type="button" id="datos-borrar">${e(dvTexto('delete'))}</button>` : ''}
          </div>
        </div>`);
      bindGestMenu();
      $('#datos-volver').addEventListener('click', () => dvDatosLista(cfg));
      $('#datos-guardar').addEventListener('click', () => dvGuardar(cfg, campos, id, false));
      if (id) $('#datos-borrar').addEventListener('click', () => dvBorrar(cfg, fila, dependientes, id));
      if (cfg.alPintar) cfg.alPintar(fila, id);
    }

    async function dvGuardar(cfg, campos, id, forzar) {
      const datos = dvLeerCampos(campos);
      const boton = $('#datos-guardar');
      boton.disabled = true;
      mensajeAdmin('#gest-msg', 'info', dvTexto('loading'));
      try {
        const res = await postAdmin(id
          ? { accion: 'admin_datos_editar', entidad: cfg.entidad, id, campos: datos, forzar }
          : { accion: 'admin_datos_crear', entidad: cfg.entidad, campos: datos, forzar });
        if (res.duplicados && res.duplicados.length) {
          boton.disabled = false;
          dvAvisoDuplicados(cfg, res.duplicados, () => dvGuardar(cfg, campos, id, true));
          return;
        }
        toast(id ? dvTexto('saved') : dvTexto('created'));
        dvCentrosCache = null; // por si se tocó un centro
        await dvDatosLista(cfg);
        if (id && res.cambiados) {
          mensajeAdmin('#gest-msg', 'info', dvTexto('changedFields', { campos: res.cambiados.join(', ') }));
        }
      } catch (err) { boton.disabled = false; dvError(err); }
    }

    function dvAvisoDuplicados(cfg, dups, alForzar) {
      const caja = $('#datos-dup');
      caja.className = 'form-message visible error';
      caja.innerHTML = `
        <strong>${e(dvTexto('dupTitle'))}</strong>
        <ul>${dups.map((d) => `<li>${e(d.etiqueta)} — ${e(dvTexto('dupBecause', { campos: d.porque }))}
          <button class="link-btn" type="button" data-dup-abrir="${e(String(d.id))}">${e(dvTexto('dupOpen'))}</button></li>`).join('')}</ul>
        <button class="btn btn-soft btn-small" type="button" id="dup-forzar">${e(dvTexto('dupForce'))}</button>`;
      $$('#datos-dup [data-dup-abrir]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.dupAbrir)));
      $('#dup-forzar').addEventListener('click', alForzar);
    }

    // ---- Borrado ----
    // Hay que ESCRIBIR el nombre. Un «¿seguro?» se acepta sin leerlo; teclear el
    // nombre obliga a mirar qué se está borrando. El servidor lo vuelve a exigir.
    function dvBorrar(cfg, fila, dependientes, id) {
      const nombre = String(fila[cfg.etiqueta || 'nombre'] || '');
      const aviso = (dependientes || []).map((d) => d.modo === 'cascade'
        ? dvTexto('confirmCascade', { cuantos: d.cuantos, cosa: d.etiqueta })
        : dvTexto('confirmOrphan', { cuantos: d.cuantos, cosa: d.etiqueta })).join(' ');
      abrirModal(dvTexto('confirmTitle', { nombre }), `
        ${aviso ? `<p class="section-copy">${e(aviso)}</p>` : ''}
        <div class="field">
          <label for="dv-confirmar">${e(dvTexto('confirmType', { nombre }))}</label>
          <input id="dv-confirmar" autocomplete="off" />
        </div>
        <div id="dv-borrar-msg" class="form-message"></div>
        <div class="form-actions">
          <button class="btn btn-danger" type="button" id="dv-borrar-ok">${e(dvTexto('delete'))}</button>
        </div>`);
      $('#dv-borrar-ok').addEventListener('click', async () => {
        try {
          await postAdmin({ accion: 'admin_datos_borrar', entidad: cfg.entidad, id,
            confirmar: $('#dv-confirmar').value });
          const dialog = $('#modal-root dialog');
          if (dialog) dialog.close();
          toast(dvTexto('deleted'));
          dvCentrosCache = null;
          await dvDatosLista(cfg);
        } catch (err) {
          mensajeAdmin('#dv-borrar-msg', 'error', String((err && err.message) || ''));
        }
      });
    }

    // ---- Duplicados ----
    async function dvPanelDuplicados(cfg) {
      $('#admin-console').innerHTML = marcoGestion(`${cfg.titulo} · ${dvTexto('dupPanel')}`, `
        <div id="dup-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>`);
      bindGestMenu();
      let res;
      try { res = await postAdmin({ accion: 'admin_datos_duplicados', entidad: cfg.entidad }); }
      catch (err) { dvError(err); return; }
      $('#dup-filas').innerHTML = (res.grupos || []).map((g) => `
        <article class="admin-private-card">
          <p class="meta">${e(dvTexto('dupBecause', { campos: g.porque }))}</p>
          ${g.filas.map((f) => `<button class="admin-record" type="button" data-dup-id="${e(String(f.id))}">
            <span class="admin-record-main"><strong>${e(f.etiqueta)}</strong></span></button>`).join('')}
        </article>`).join('') || `<p class="empty-state">${e(dvTexto('dupNone'))}</p>`;
      $$('#dup-filas [data-dup-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(cfg, b.dataset.dupId)));
    }

    // ---- Bitácora ----
    async function dvPanelBitacora(entidad) {
      $('#admin-console').innerHTML = marcoGestion(dvTexto('logTitle'), `
        <p class="meta">${e(dvTexto('logIntro'))}</p>
        <div id="log-filas" class="admin-records"><p class="empty-state">${e(dvTexto('loading'))}</p></div>`);
      bindGestMenu();
      let res;
      try { res = await postAdmin({ accion: 'admin_bitacora', entidad: entidad || '' }); }
      catch (err) { dvError(err); return; }
      $('#log-filas').innerHTML = (res.cambios || []).map((c) => {
        const clave = 'action' + String(c.accion).charAt(0).toUpperCase() + String(c.accion).slice(1);
        const despues = c.despues || {};
        const antes = c.antes || {};
        const nombre = despues.nombre || antes.nombre || (antes.fila && antes.fila.nombre) || c.fila_id;
        return `<article class="admin-private-card">
          <div class="supply-line">
            <strong>${e(dvTexto(clave))} ${e(String(nombre))}</strong>
            <span class="badge gray">${e(String(c.entidad))}</span>
          </div>
          <p class="meta">${e(fechaRelativa(c.fecha))} · ${e(String(c.ip))}</p>
          ${c.accion === 'editar' ? `<div class="card-actions">
            <button class="btn btn-soft btn-small" type="button" data-log-undo="${e(String(c.id))}">${e(dvTexto('logUndo'))}</button>
          </div>` : ''}
        </article>`;
      }).join('') || `<p class="empty-state">${e(dvTexto('logEmpty'))}</p>`;
      $$('#log-filas [data-log-undo]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await postAdmin({ accion: 'admin_datos_deshacer', auditoriaId: Number(b.dataset.logUndo) });
          toast(dvTexto('logUndone'));
          dvPanelBitacora(entidad);
        } catch (err) { b.disabled = false; dvError(err); }
      }));
    }
