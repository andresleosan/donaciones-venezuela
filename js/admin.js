// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';

    // ===== Consola de administración (página /admin) =====
    // Rediseño (2026-07): en vez de formularios apilados en un modal, una consola
    // de pantalla completa. Las tareas de creación son ASISTENTES POR PASOS con
    // barra de progreso superior (un grupo de datos a la vez, confirmación y
    // estado de éxito); la gestión son paneles de revisión. Ninguna acción admin
    // se pierde. Toda interpolación pasa por e(); cada acción lleva adminKey.

    let facturaActiva = null;
    let adminData = { facturas: [], personas: [], vacantes: [], rescatistas: [] };
    let wiz = null;

    function claveAdmin() { return window.sessionStorage.getItem('adminKey') || ''; }
    async function postAdmin(payload) {
      return window.SheetsService.post(Object.assign({ adminKey: claveAdmin() }, payload));
    }
    function mensajeAdmin(sel, tipo, texto) {
      const el = $(sel);
      if (!el) return;
      el.className = `form-message visible ${tipo}`;
      el.textContent = texto;
    }

    function abrirAdmin() {
      facturaActiva = null;
      abrirModal(t('admin.title'), `
        <div class="admin-shell">
          <section class="admin-auth" id="admin-auth">
            <div class="admin-auth-card">
              <span class="admin-auth-badge" aria-hidden="true">🔐</span>
              <h2>${e(t('admin.title'))}</h2>
              <p class="section-copy">${e(t('admin.intro'))}</p>
              <form id="admin-auth-form" novalidate>
                <div class="field"><label for="admin-key">${e(t('admin.keyLabel'))}</label><input id="admin-key" type="password" autocomplete="off" value="${e(claveAdmin())}" /></div>
                <div class="form-actions"><button class="btn btn-primary btn-block" type="submit">${e(t('admin.enter'))}</button></div>
                <div id="admin-msg" class="form-message" role="status" aria-live="polite"></div>
              </form>
            </div>
          </section>
          <div id="admin-console" hidden></div>
        </div>`);
      $('#admin-auth-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        window.sessionStorage.setItem('adminKey', ($('#admin-key').value || '').trim());
        mensajeAdmin('#admin-msg', 'info', t('admin.checking'));
        try {
          await cargarAdminData();
          $('#admin-auth').hidden = true;
          $('#admin-console').hidden = false;
          irAMenu();
        } catch (err) {
          window.sessionStorage.removeItem('adminKey');
          mensajeAdmin('#admin-msg', 'error', String((err && err.message) || t('admin.authError')));
        }
      });
    }

    async function cargarAdminData() {
      // La lista de facturas valida la clave: si es incorrecta, propaga y no entra.
      adminData.facturas = (await postAdmin({ accion: 'admin_listar_facturas' })).facturas || [];
      const opcional = async (accion, campo) => {
        try { return (await postAdmin({ accion }))[campo] || []; } catch (err) { return []; }
      };
      adminData.personas = await opcional('admin_listar_personas', 'personas');
      adminData.vacantes = await opcional('admin_listar_vacantes', 'vacantes');
      adminData.rescatistas = await opcional('admin_listar_rescatistas', 'rescatistas');
    }

    async function refrescarAdminData() {
      try { await cargarAdminData(); } catch (err) { /* conserva lo previo si algo falla */ }
    }

    function cerrarSesionAdmin() {
      window.sessionStorage.removeItem('adminKey');
      facturaActiva = null; wiz = null;
      const dialog = $('#modal-root dialog');
      if (dialog) dialog.close();
    }

    // ---- Menú (lanzador de tareas) ----
    function irAMenu() {
      wiz = null; facturaActiva = null;
      const crear = [
        { id: 'donacion', icon: '💛', titulo: t('admin.taskDonation'), desc: t('admin.taskDonationDesc') },
        { id: 'presupuesto', icon: '🧾', titulo: t('admin.taskBudget'), desc: t('admin.taskBudgetDesc') },
        { id: 'vacante', icon: '🙋', titulo: t('admin.taskVacancy'), desc: t('admin.taskVacancyDesc') }
      ];
      const gestion = [
        { id: 'facturas', icon: '📁', titulo: t('admin.manageInvoices'), count: adminData.facturas.length },
        { id: 'vacantes', icon: '📋', titulo: t('admin.manageVacancies'), count: adminData.vacantes.length },
        { id: 'personas', icon: '🔎', titulo: t('admin.managePeople'), count: adminData.personas.length },
        { id: 'rescatistas', icon: '🚑', titulo: t('admin.manageRescuers'), count: adminData.rescatistas.length },
        { id: 'regenerar', icon: '🔑', titulo: t('admin.manageRegen'), count: null }
      ];
      const crearCards = crear.map((tk) => `
        <button class="admin-launch-card" type="button" data-admin-tarea="${e(tk.id)}">
          <span class="admin-launch-icon" aria-hidden="true">${tk.icon}</span>
          <span class="admin-launch-text"><strong>${e(tk.titulo)}</strong><span class="meta">${e(tk.desc)}</span></span>
          <span class="admin-launch-go" aria-hidden="true">→</span>
        </button>`).join('');
      const gestionRows = gestion.map((g) => `
        <button class="admin-manage-row" type="button" data-admin-gestion="${e(g.id)}">
          <span class="admin-manage-icon" aria-hidden="true">${g.icon}</span>
          <span class="admin-manage-title">${e(g.titulo)}</span>
          ${g.count != null ? `<span class="badge gray">${e(String(g.count))}</span>` : ''}
          <span class="admin-launch-go" aria-hidden="true">→</span>
        </button>`).join('');
      $('#admin-console').innerHTML = `
        <div class="admin-console-head">
          <div><h2>${e(t('admin.consoleTitle'))}</h2><p class="meta">${e(t('admin.consoleSubtitle'))}</p></div>
          <button class="btn btn-ghost btn-small" type="button" id="admin-salir">${e(t('admin.signOut'))}</button>
        </div>
        <section class="admin-group">
          <h3 class="admin-group-title">${e(t('admin.groupCreate'))}</h3>
          <div class="admin-launcher">${crearCards}</div>
        </section>
        <section class="admin-group">
          <h3 class="admin-group-title">${e(t('admin.groupManage'))}</h3>
          <div class="admin-manage-list">${gestionRows}</div>
        </section>`;
      $$('#admin-console [data-admin-tarea]').forEach((b) => b.addEventListener('click', () => abrirAsistente(b.dataset.adminTarea)));
      $$('#admin-console [data-admin-gestion]').forEach((b) => b.addEventListener('click', () => abrirGestion(b.dataset.adminGestion)));
      $('#admin-salir').addEventListener('click', cerrarSesionAdmin);
    }

    // ---- Definición declarativa de los asistentes ----
    function defAsistente(id) {
      const A = {
        donacion: {
          titulo: t('admin.taskDonation'),
          pasos: [
            { titulo: t('admin.stepObjective'), campos: [
              { id: 'objetivo', label: t('admin.objective'), requerido: true, placeholder: t('admin.objectivePh'), full: true },
              { id: 'descripcion', label: t('admin.description'), full: true },
              { id: 'meta', label: t('admin.requiredAmount'), tipo: 'number', requerido: true }
            ] },
            { titulo: t('admin.stepDonation'), campos: [
              { id: 'donante', label: t('admin.donor'), placeholder: t('needs.donorPlaceholder') },
              { id: 'monto', label: t('admin.amount'), tipo: 'number', requerido: true },
              { id: 'referencia', label: t('admin.reference') },
              { id: 'estado', label: t('admin.status'), tipo: 'select', opciones: [
                { value: 'Registrada', label: t('admin.stateRegistered') },
                { value: 'Confirmada', label: t('admin.stateConfirmed') }
              ] }
            ] }
          ],
          enviar: async (d) => {
            const f = await postAdmin({ accion: 'admin_crear_factura', objetivo: d.objetivo, descripcion: d.descripcion || '', montoRequerido: d.meta });
            await postAdmin({ accion: 'admin_registrar_donacion', token: f.token, nombreDonante: d.donante || 'Anónimo', monto: d.monto, referencia: d.referencia || '', estado: d.estado || 'Registrada' });
            return { numeroFactura: f.numeroFactura, token: f.token };
          },
          exitoTitulo: () => t('admin.donationDone'),
          exitoCuerpo: (r) => reciboTokens([[t('admin.invoiceLabel'), r.numeroFactura], [t('needs.tokenLabel'), r.token]], r.token),
          onExito: (r) => { facturaActiva = r.token; }
        },
        presupuesto: {
          titulo: t('admin.taskBudget'),
          pasos: [
            { titulo: t('admin.stepCenterSupply'), campos: [
              { id: 'centro', label: t('admin.centerName'), requerido: true },
              { id: 'insumo', label: t('admin.budgetSupply'), requerido: true, placeholder: t('admin.budgetSupplyPh') }
            ] },
            { titulo: t('admin.stepStore'), campos: [
              { id: 'tienda', label: t('admin.budgetStore'), requerido: true, placeholder: t('admin.budgetStorePh') },
              { id: 'direccion', label: t('admin.budgetAddress'), full: true }
            ] },
            { titulo: t('admin.stepQtyPrice'), campos: [
              { id: 'cantidad', label: t('admin.budgetQty'), tipo: 'number', requerido: true },
              { id: 'presentacion', label: t('admin.budgetPresentation'), placeholder: t('admin.budgetPresentationPh') },
              { id: 'precio', label: t('admin.budgetPrice'), tipo: 'number', requerido: true }
            ] }
          ],
          enviar: async (d) => postAdmin({ accion: 'admin_crear_presupuesto', centro: d.centro, insumo: d.insumo, tienda: d.tienda, direccion: d.direccion || '', cantidad: d.cantidad, presentacion: d.presentacion || '', precio: d.precio }),
          exitoTitulo: () => t('admin.budgetCreated'),
          exitoCuerpo: (r) => reciboTokens([[t('admin.invoiceLabel'), r.numeroFactura], [t('needs.tokenLabel'), r.token]], r.token)
        },
        vacante: {
          titulo: t('admin.taskVacancy'),
          pasos: [
            { titulo: t('admin.stepPlace'), campos: [
              { id: 'lugarTipo', label: t('vacancies.placeTypeLabel'), tipo: 'select', opciones: ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'].map((v) => ({ value: v, label: tValue('types', v) })) },
              { id: 'lugarNombre', label: t('admin.vacancyPlace'), requerido: true, placeholder: t('admin.vacancyPlacePh'), full: true },
              { id: 'ubicacion', label: t('panel.locationLabel'), full: true }
            ] },
            { titulo: t('admin.stepProfile'), campos: [
              { id: 'rol', label: t('admin.vacancyRole'), requerido: true, placeholder: t('admin.vacancyRolePh') },
              { id: 'cantidad', label: t('admin.vacancyQty'), tipo: 'number', requerido: true },
              { id: 'urgencia', label: t('panel.urgency'), tipo: 'select', opciones: ['Alta', 'Normal', 'Baja'].map((v) => ({ value: v, label: tValue('urgency', v) })) }
            ] },
            { titulo: t('admin.stepDetails'), campos: [
              { id: 'turno', label: t('admin.vacancyShift'), placeholder: t('admin.vacancyShiftPh') },
              { id: 'telefono', label: t('common.phone'), tipo: 'tel' },
              { id: 'descripcion', label: t('admin.description'), full: true, placeholder: t('admin.vacancyDescPh') }
            ] }
          ],
          enviar: async (d) => postAdmin({ accion: 'admin_crear_vacante', lugarTipo: d.lugarTipo, lugarNombre: d.lugarNombre, ubicacion: d.ubicacion || '', rol: d.rol, cantidad: d.cantidad, urgencia: d.urgencia, turno: d.turno || '', telefono: d.telefono || '', descripcion: d.descripcion || '' }),
          exitoTitulo: () => t('admin.vacancyCreated'),
          exitoCuerpo: () => `<p class="section-copy">${e(t('admin.vacancyLive'))}</p>`
        }
      };
      return A[id];
    }

    // ---- Motor de asistentes (stepper + un paso a la vez + confirmar + éxito) ----
    function abrirAsistente(id) {
      const def = defAsistente(id);
      if (!def) return;
      wiz = { id, def, paso: 0, datos: {} };
      renderAsistente();
    }

    function campoWizHtml(c, datos) {
      const val = datos[c.id] != null ? datos[c.id] : (c.default || '');
      const cls = 'field' + (c.full ? ' full' : '');
      const req = c.requerido ? ` <span class="req" aria-hidden="true">*</span>` : '';
      const lab = `<label for="wz-${c.id}">${e(c.label)}${req}</label>`;
      if (c.tipo === 'select') {
        const ops = c.opciones.map((o) => `<option value="${e(o.value)}"${String(val) === String(o.value) ? ' selected' : ''}>${e(o.label)}</option>`).join('');
        return `<div class="${cls}">${lab}<select id="wz-${c.id}">${ops}</select></div>`;
      }
      const type = c.tipo === 'number' ? 'number' : (c.tipo === 'tel' ? 'tel' : 'text');
      const extra = c.tipo === 'number' ? ' min="1" step="1"' : (c.tipo === 'tel' ? ' inputmode="tel"' : '');
      return `<div class="${cls}">${lab}<input id="wz-${c.id}" type="${type}"${extra} value="${e(val)}" placeholder="${e(c.placeholder || '')}" /></div>`;
    }

    function renderAsistente() {
      const { def, paso } = wiz;
      const total = def.pasos.length;
      const esConfirm = paso === total;
      const nodos = def.pasos.map((p) => p.titulo).concat([t('wizard.confirm')]);
      const fill = nodos.length > 1 ? Math.round((paso / (nodos.length - 1)) * 100) : 100;
      const stepper = nodos.map((label, i) => {
        const est = i < paso ? 'is-done' : (i === paso ? 'is-current' : '');
        const marca = i < paso ? '✓' : String(i + 1);
        return `<li class="wizard-step-node ${est}"${i === paso ? ' aria-current="step"' : ''}><span class="wizard-step-dot">${marca}</span><span class="wizard-step-label">${e(label)}</span></li>`;
      }).join('');
      let cuerpo;
      if (esConfirm) {
        cuerpo = resumenHtml(def, wiz.datos);
      } else {
        const p = def.pasos[paso];
        cuerpo = `<h3 class="wizard-step-title">${e(p.titulo)}</h3><p class="wizard-step-count">${e(t('wizard.stepOf', { current: paso + 1, total: nodos.length }))}</p><div class="form-grid">${p.campos.map((c) => campoWizHtml(c, wiz.datos)).join('')}</div>`;
      }
      $('#admin-console').innerHTML = `
        <div class="wizard">
          <div class="admin-console-head">
            <button class="link-btn" type="button" id="wiz-menu">← ${e(t('wizard.menu'))}</button>
            <h2>${e(def.titulo)}</h2>
          </div>
          <div class="wizard-progress" role="presentation"><div class="wizard-progress-fill" style="width:${fill}%"></div></div>
          <ol class="wizard-steps">${stepper}</ol>
          <div class="wizard-panel" id="wiz-panel">${cuerpo}</div>
          <div id="wiz-msg" class="form-message" role="status" aria-live="polite"></div>
          <div class="wizard-foot">
            <button class="btn btn-ghost" type="button" id="wiz-back"${paso === 0 ? ' disabled' : ''}>${e(t('wizard.back'))}</button>
            <button class="btn btn-primary" type="button" id="wiz-next">${esConfirm ? e(t('wizard.submit')) : e(t('wizard.next'))}</button>
          </div>
        </div>`;
      $('#wiz-menu').addEventListener('click', irAMenu);
      $('#wiz-back').addEventListener('click', wizAtras);
      $('#wiz-next').addEventListener('click', wizSiguiente);
      const primero = $('#wiz-panel input, #wiz-panel select');
      if (primero) primero.focus();
    }

    function leerPasoActual() {
      const p = wiz.def.pasos[wiz.paso];
      if (!p) return;
      p.campos.forEach((c) => { const el = $('#wz-' + c.id); if (el) wiz.datos[c.id] = el.value.trim(); });
    }

    function validarPasoActual() {
      const p = wiz.def.pasos[wiz.paso];
      for (const c of p.campos) {
        const v = wiz.datos[c.id];
        if (c.requerido && !v) return t('wizard.requiredField', { field: c.label });
        if (c.tipo === 'number' && c.requerido && !(numero(v) > 0)) return t('wizard.positiveField', { field: c.label });
      }
      return null;
    }

    function wizAtras() {
      leerPasoActual();
      if (wiz.paso > 0) { wiz.paso -= 1; renderAsistente(); }
    }

    async function wizSiguiente() {
      const esConfirm = wiz.paso === wiz.def.pasos.length;
      if (!esConfirm) {
        leerPasoActual();
        const err = validarPasoActual();
        if (err) { mensajeAdmin('#wiz-msg', 'error', err); return; }
        wiz.paso += 1; renderAsistente(); return;
      }
      const btn = $('#wiz-next');
      btn.disabled = true;
      mensajeAdmin('#wiz-msg', 'info', t('wizard.sending'));
      try {
        const res = (await wiz.def.enviar(wiz.datos)) || {};
        if (wiz.def.onExito) wiz.def.onExito(res);
        await refrescarAdminData();
        exitoAsistente(wiz.def, res);
      } catch (err) {
        btn.disabled = false;
        mensajeAdmin('#wiz-msg', 'error', String((err && err.message) || t('needs.error')));
      }
    }

    function resumenHtml(def, datos) {
      const disp = (c) => {
        const v = datos[c.id];
        if (!v) return null;
        if (c.tipo === 'select' && c.opciones) { const o = c.opciones.find((op) => String(op.value) === String(v)); return o ? o.label : v; }
        return v;
      };
      const filas = def.pasos.flatMap((p) => p.campos).map((c) => ({ c, v: disp(c) })).filter((x) => x.v)
        .map(({ c, v }) => `<div class="wizard-sum-row"><dt>${e(c.label)}</dt><dd>${e(v)}</dd></div>`).join('');
      return `<h3 class="wizard-step-title">${e(t('wizard.confirm'))}</h3><p class="section-copy">${e(t('wizard.reviewCopy'))}</p><dl class="wizard-summary">${filas}</dl>`;
    }

    function reciboTokens(pares, copyValue) {
      const filas = pares.map(([lab, val]) => `<div class="recibo-row"><span class="meta">${e(lab)}</span><span class="token-value"><strong>${e(val)}</strong></span></div>`).join('');
      const copyBtn = copyValue ? `<button class="btn btn-soft btn-small" type="button" id="wiz-copiar" data-copy="${e(copyValue)}">${e(t('needs.copyCta'))}</button>` : '';
      return `<div class="recibo">${filas}<p class="meta">${e(t('admin.tokenHint'))}</p>${copyBtn}</div>`;
    }

    function exitoAsistente(def, res) {
      $('#admin-console').innerHTML = `
        <div class="wizard-success">
          <span class="wizard-success-icon" aria-hidden="true">✓</span>
          <h2>${e(def.exitoTitulo(res))}</h2>
          ${def.exitoCuerpo(res)}
          <div class="wizard-success-actions">
            <button class="btn btn-primary" type="button" id="wiz-otra">${e(t('wizard.another'))}</button>
            <button class="btn btn-ghost" type="button" id="wiz-menu2">${e(t('wizard.toMenu'))}</button>
          </div>
        </div>`;
      const copiar = $('#wiz-copiar');
      if (copiar) copiar.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(copiar.dataset.copy || ''); toast(t('needs.copied')); }
        catch (err) { toast(copiar.dataset.copy || ''); }
      });
      const idActual = wiz && wiz.id;
      $('#wiz-otra').addEventListener('click', () => abrirAsistente(idActual));
      $('#wiz-menu2').addEventListener('click', irAMenu);
    }

    // ---- Paneles de gestión ----
    function abrirGestion(cual) {
      const panels = { facturas: panelFacturas, vacantes: panelVacantes, personas: panelPersonas, rescatistas: panelRescatistas, regenerar: panelRegenerar };
      const fn = panels[cual];
      if (fn) fn();
    }

    function marcoGestion(titulo, cuerpo) {
      return `
        <div class="admin-console-head">
          <button class="link-btn" type="button" id="gest-menu">← ${e(t('wizard.menu'))}</button>
          <h2>${e(titulo)}</h2>
        </div>
        <div id="gest-msg" class="form-message" role="status" aria-live="polite"></div>
        <div class="admin-manage-body">${cuerpo}</div>`;
    }

    function bindGestMenu() { $('#gest-menu').addEventListener('click', irAMenu); }

    function panelFacturas() {
      const filas = adminData.facturas.map((f) => `
        <button class="admin-record" type="button" data-fac="${e(f.token_publico)}">
          <span class="admin-record-main"><strong>${e(f.numero_factura)}</strong><span class="meta">${e(f.objetivo)}</span></span>
          <span class="admin-record-side"><span class="badge ${f.estado === 'Cerrada' ? 'gray' : 'green'}">${e(f.estado)}</span><span class="meta">${e(String(f.monto_recaudado))} / ${e(String(f.monto_requerido))}</span></span>
        </button>`).join('') || `<p class="empty-state">${e(t('admin.noInvoices'))}</p>`;
      $('#admin-console').innerHTML = marcoGestion(t('admin.manageInvoices'), `
        <div class="admin-records">${filas}</div>
        <div id="fac-ops" hidden></div>`);
      bindGestMenu();
      $$('#admin-console [data-fac]').forEach((b) => b.addEventListener('click', () => operarFactura(b.dataset.fac)));
      if (facturaActiva) operarFactura(facturaActiva);
    }

    function operarFactura(token) {
      facturaActiva = token;
      const f = adminData.facturas.find((x) => x.token_publico === token);
      const cont = $('#fac-ops');
      if (!cont) return;
      cont.hidden = false;
      cont.innerHTML = `
        <div class="admin-ops">
          <h3>${e(t('admin.opsOn'))} <span class="tracking-code">${e(f ? f.numero_factura : token)}</span></h3>
          <div class="admin-ops-grid">
            <div class="admin-ops-card">
              <h4>${e(t('admin.donation'))}</h4>
              <div class="field"><label for="op-don-nombre">${e(t('admin.donor'))}</label><input id="op-don-nombre" /></div>
              <div class="field"><label for="op-don-monto">${e(t('admin.amount'))}</label><input id="op-don-monto" type="number" min="1" /></div>
              <div class="field"><label for="op-don-ref">${e(t('admin.reference'))}</label><input id="op-don-ref" /></div>
              <div class="field"><label for="op-don-estado">${e(t('admin.status'))}</label><select id="op-don-estado"><option value="Registrada">${e(t('admin.stateRegistered'))}</option><option value="Confirmada">${e(t('admin.stateConfirmed'))}</option></select></div>
              <button class="btn btn-soft btn-small" type="button" id="op-don-guardar">${e(t('admin.saveDonation'))}</button>
            </div>
            <div class="admin-ops-card">
              <h4>${e(t('admin.movement'))}</h4>
              <div class="field"><label for="op-mov-tipo">${e(t('admin.type'))}</label><select id="op-mov-tipo"><option>Ingreso</option><option>Egreso</option><option>Compra</option><option>Entrega</option></select></div>
              <div class="field"><label for="op-mov-desc">${e(t('admin.description'))}</label><input id="op-mov-desc" /></div>
              <div class="field"><label for="op-mov-monto">${e(t('admin.amount'))}</label><input id="op-mov-monto" type="number" min="0" /></div>
              <button class="btn btn-soft btn-small" type="button" id="op-mov-guardar">${e(t('admin.saveMovement'))}</button>
            </div>
            <div class="admin-ops-card">
              <h4>${e(t('admin.evidence'))}</h4>
              <div class="field"><label for="op-evi-url">URL (https)</label><input id="op-evi-url" placeholder="https://…" /></div>
              <div class="field"><label for="op-evi-desc">${e(t('admin.description'))}</label><input id="op-evi-desc" /></div>
              <div class="inline-actions"><button class="btn btn-soft btn-small" type="button" id="op-evi-guardar">${e(t('admin.saveEvidence'))}</button><button class="btn btn-ghost btn-small" type="button" id="op-cerrar">${e(t('admin.closeInvoice'))}</button></div>
            </div>
          </div>
        </div>`;
      cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const conFactura = (fn) => async () => {
        try { await fn(); mensajeAdmin('#gest-msg', 'success', t('panel.saved')); await refrescarAdminData(); }
        catch (err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }
      };
      $('#op-don-guardar').addEventListener('click', conFactura(() => postAdmin({ accion: 'admin_registrar_donacion', token: facturaActiva, nombreDonante: $('#op-don-nombre').value.trim(), monto: $('#op-don-monto').value, referencia: $('#op-don-ref').value.trim(), estado: $('#op-don-estado').value })));
      $('#op-mov-guardar').addEventListener('click', conFactura(() => postAdmin({ accion: 'admin_registrar_movimiento', token: facturaActiva, tipo: $('#op-mov-tipo').value, descripcion: $('#op-mov-desc').value.trim(), monto: $('#op-mov-monto').value })));
      $('#op-evi-guardar').addEventListener('click', conFactura(() => postAdmin({ accion: 'admin_registrar_evidencia', token: facturaActiva, archivo: $('#op-evi-url').value.trim(), descripcion: $('#op-evi-desc').value.trim() })));
      $('#op-cerrar').addEventListener('click', conFactura(() => postAdmin({ accion: 'admin_cerrar_factura', token: facturaActiva })));
    }

    function panelVacantes() {
      const filas = adminData.vacantes.map((v) => `
        <div class="admin-record-static">
          <div class="admin-record-main"><strong>${e(v.rol)} · ${e(v.lugar_nombre)}</strong><span class="meta">${e(tValue('types', v.lugar_tipo) || v.lugar_tipo)} · ${e(mostrarUrgencia(v.urgencia))} · ${e(String(v.cantidad_cubierta))}/${e(String(v.cantidad_necesaria))}${v.turno ? ' · ' + e(v.turno) : ''}</span></div>
          <div class="admin-record-actions">
            <span class="badge ${v.estado === 'Abierta' ? 'green' : 'gray'}">${e(v.estado)}</span>
            <label class="field-mini"><span>${e(t('admin.vacancyCovered'))}</span><input type="number" min="0" value="${e(String(v.cantidad_cubierta))}" data-vac-cubiertos="${e(String(v.id))}" /></label>
            <button class="btn btn-soft btn-small" type="button" data-vac-guardar="${e(String(v.id))}">${e(t('admin.vacancySave'))}</button>
            ${v.estado === 'Abierta' ? `<button class="btn btn-ghost btn-small" type="button" data-vac-cerrar="${e(String(v.id))}">${e(t('admin.vacancyClose'))}</button>` : ''}
          </div>
        </div>`).join('') || `<p class="empty-state">${e(t('admin.vacancyNone'))}</p>`;
      $('#admin-console').innerHTML = marcoGestion(t('admin.manageVacancies'), `<div class="admin-records">${filas}</div>`);
      bindGestMenu();
      const recargar = async () => { await refrescarAdminData(); panelVacantes(); };
      $$('#admin-console [data-vac-guardar]').forEach((b) => b.addEventListener('click', async () => {
        try { await postAdmin({ accion: 'admin_actualizar_vacante', id: b.dataset.vacGuardar, cantidadCubierta: $(`[data-vac-cubiertos="${b.dataset.vacGuardar}"]`).value }); await recargar(); }
        catch (err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }
      }));
      $$('#admin-console [data-vac-cerrar]').forEach((b) => b.addEventListener('click', async () => {
        try { await postAdmin({ accion: 'admin_actualizar_vacante', id: b.dataset.vacCerrar, estado: 'Cerrada' }); await recargar(); }
        catch (err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }
      }));
    }

    function panelPersonas() {
      const filas = adminData.personas.map((p) => `
        <div class="admin-record-static">
          <div class="admin-record-main"><strong>${e(p.nombre)}</strong><span class="meta">${e([p.cedula, p.estado, p.ubicacion, p.fuente].filter(Boolean).join(' · '))}</span></div>
          <div class="admin-record-actions"><span class="badge yellow">${e(t('family.unverifiedBadge'))}</span><button class="btn btn-soft btn-small" type="button" data-verificar="${e(String(p.id))}">${e(t('admin.verify'))}</button></div>
        </div>`).join('') || `<p class="empty-state">${e(t('admin.noPendingPeople'))}</p>`;
      $('#admin-console').innerHTML = marcoGestion(t('admin.managePeople'), `<div class="admin-records">${filas}</div>`);
      bindGestMenu();
      $$('#admin-console [data-verificar]').forEach((b) => b.addEventListener('click', async () => {
        try { await postAdmin({ accion: 'admin_verificar_persona', id: b.dataset.verificar }); await refrescarAdminData(); panelPersonas(); }
        catch (err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }
      }));
    }

    function panelRescatistas() {
      const filas = adminData.rescatistas.map((r) => `
        <article class="admin-private-card">
          <div class="supply-line"><strong>${e(r.nombre || t('rescuers.defaultName'))}</strong><span class="badge rescue">${e(r.especialidad || t('common.pending'))}</span></div>
          <p class="meta">${e(r.organizacion || t('common.pending'))} · ${e(r.ciudad || '')}${r.estado ? `, ${e(r.estado)}` : ''}</p>
          <div class="badge-row"><span class="badge gray">${e(r.capacidad_operativa || t('common.pending'))}</span><span class="badge green">${e(r.disponibilidad || t('common.pending'))}</span></div>
          <details class="admin-private-details"><summary>${e(t('admin.viewSensitiveDetails'))}</summary><div class="meta-grid"><span><strong>${e(t('common.phone'))}</strong> ${e(r.telefono || t('common.pending'))}</span><span><strong>${e(t('rescuers.equipmentLabel'))}</strong> ${e(r.equipo_disponible || t('common.pending'))}</span><span><strong>${e(t('rescuers.notesLabel'))}</strong> ${e(r.observaciones || t('common.pending'))}</span><span><strong>${e(t('common.updated'))}</strong> ${e(fechaRelativa(r.fecha_registro))}</span></div></details>
        </article>`).join('') || `<p class="empty-state">${e(t('admin.rescuersNone'))}</p>`;
      $('#admin-console').innerHTML = marcoGestion(t('admin.manageRescuers'), `<p class="meta">${e(t('admin.rescuersIntro'))}</p><div class="admin-private-list">${filas}</div>`);
      bindGestMenu();
    }

    function panelRegenerar() {
      $('#admin-console').innerHTML = marcoGestion(t('admin.manageRegen'), `
        <div class="admin-form-card">
          <p class="section-copy">${e(t('admin.regenIntro'))}</p>
          <div class="field"><label for="regen-nombre">${e(t('admin.centerName'))}</label><input id="regen-nombre" /></div>
          <div class="form-actions"><button class="btn btn-primary" type="button" id="regen-btn">${e(t('admin.regenerate'))}</button></div>
          <div id="regen-out"></div>
        </div>`);
      bindGestMenu();
      $('#regen-btn').addEventListener('click', async () => {
        try {
          const r = await postAdmin({ accion: 'admin_regenerar_panel', nombre: $('#regen-nombre').value.trim() });
          $('#regen-out').innerHTML = `<div class="recibo"><div class="recibo-row"><span class="meta">${e(t('access.centerTitle'))}</span><span class="token-value"><strong>${e(r.token)}</strong></span></div><div class="recibo-row"><span class="meta">PIN</span><span class="token-value"><strong>${e(r.pin)}</strong></span></div><p class="meta">${e(t('admin.tokenHint'))}</p></div>`;
        } catch (err) { mensajeAdmin('#gest-msg', 'error', String((err && err.message) || '')); }
      });
    }


    async function abrirHistorial(nombre) {
      abrirModal(t('modal.historyTitle'), `<div id="modal-list" class="empty-state">${e(t('modal.loadingHistory'))}</div>`);
      const res = await window.SheetsService.getHistorial(nombre);
      const items = res.data || [];
      $('#modal-list').outerHTML = items.length ? `<div class="supply-list">${items.map((h) => `<div class="supply-item"><strong>${e(h.tipoMovimiento || h.tipo)} · ${e(mostrarInsumo(h.insumo))}</strong><p class="meta">${e(h.cantidad)} ${e(mostrarUnidad(h.unidad || ''))} · ${e(fechaRelativa(h.timestamp))}</p></div>`).join('')}</div>` : `<div class="empty-state">${e(t('modal.noHistory'))}</div>`;
    }

    async function abrirTrayectos(id) {
      const mot = estado.motorizados.find((m) => String(m.id) === String(id));
      abrirModal(t('modal.routesTitle'), `<div id="modal-list" class="empty-state">${e(t('modal.loadingRoutes'))}</div>`);
      const res = await window.SheetsService.getTrayectos(id);
      const items = res.data || [];
      $('#modal-list').outerHTML = `${items.length ? `<div class="supply-list">${items.map((tItem) => `<div class="supply-item"><strong>${e(tItem.origen)} → ${e(tItem.destino)}</strong><p class="meta">${e(t('drivers.kilometers', { count: tItem.kmRecorridos || tItem.km || 0 }))} · ${e(tItem.insumo ? mostrarInsumo(tItem.insumo) : mostrarInsumoTransportado(tItem.insumoTransportado))} · ${e(fechaRelativa(tItem.timestamp))}</p></div>`).join('')}</div>` : `<div class="empty-state">${e(t('modal.noRoutes'))}</div>`}<div class="form-actions"><button class="btn btn-primary" type="button" id="modal-reg-trayecto">${e(t('modal.registerRoute'))}</button></div>`;
      $('#modal-reg-trayecto').addEventListener('click', () => abrirRegistrarTrayecto(mot));
    }

    function abrirRegistrarTrayecto(mot) {
      if (!mot) return;
      abrirModal(t('modal.routeTitle'), `<form id="trayecto-form"><div class="form-grid"><div class="field"><label for="tray-origen">${e(t('modal.origin'))}</label><input id="tray-origen" required /></div><div class="field"><label for="tray-destino">${e(t('modal.destination'))}</label><input id="tray-destino" required /></div><div class="field"><label for="tray-km">${e(t('modal.km'))}</label><input id="tray-km" type="number" min="0.1" step="0.1" required /></div><div class="field"><label for="tray-insumo">${e(t('modal.supply'))}</label><input id="tray-insumo" /></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('modal.saveRoute'))}</button></div></form>`);
      $('#trayecto-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const km = numero($('#tray-km').value);
        await window.SheetsService.post({ accion: 'registrar_trayecto', idMotorizado: mot.id, nombreMotorizado: mot.nombre, origen: $('#tray-origen').value.trim(), destino: $('#tray-destino').value.trim(), km, insumo: $('#tray-insumo').value.trim() || 'Varios' });
        await cargarTodo();
        $('#modal-root dialog').close();
        toast(t('messages.routeSaved'));
      });
    }

    function abrirDonarMotorizado(id) {
      const mot = estado.motorizados.find((m) => String(m.id) === String(id));
      if (!mot) return;
      abrirModal(t('modal.supportTitle'), `<form id="donar-mot-form"><div class="form-grid"><div class="field"><label for="don-monto">${e(t('modal.amount'))}</label><input id="don-monto" type="number" min="1" required /></div><div class="field"><label for="don-tipo">${e(t('modal.supportType'))}</label><select id="don-tipo"><option value="Pago móvil">${e(tValue('supportTypes', 'Pago móvil'))}</option><option value="Efectivo">${e(tValue('supportTypes', 'Efectivo'))}</option><option value="Combustible">${e(tValue('supportTypes', 'Combustible'))}</option><option value="Repuesto">${e(tValue('supportTypes', 'Repuesto'))}</option><option value="Otro">${e(tValue('supportTypes', 'Otro'))}</option></select></div><div class="field"><label for="don-nombre">${e(t('modal.donor'))}</label><input id="don-nombre" /></div><div class="field"><label for="don-ciudad">${e(t('common.city'))}</label><input id="don-ciudad" /></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('modal.saveSupport'))}</button></div></form>`);
      wizPublico('donar-mot-form');
      $('#donar-mot-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const monto = numero($('#don-monto').value);
        await window.SheetsService.post({ accion: 'donar_motorizado', idMotorizado: mot.id, nombreMotorizado: mot.nombre, monto, tipo: $('#don-tipo').value, donanteName: $('#don-nombre').value.trim() || 'Anónimo', ciudad: $('#don-ciudad').value.trim() });
        await cargarTodo();
        $('#modal-root dialog').close();
        toast(t('messages.supportSaved'));
      });
    }

    // Cámara reutilizable del flujo de oferta: abre la cámara del navegador
    // (pide permiso) y captura hasta `max` fotos, que se listan como miniaturas
    // con opción de quitar. Solo cámara en vivo: no hay subida desde la galería,
    // la foto debe tomarse en el sitio. `fotos` es el array que consume el submit.
    function montarCamaraOferta(prefijo, fotos, max, alCambiar) {
      const raiz = document.getElementById(prefijo + '-cam');
      const video = raiz.querySelector('video');
      const canvas = raiz.querySelector('canvas');
      const marco = raiz.querySelector('.offer-camera');
      const thumbs = raiz.querySelector('.of-thumbs');
      const msg = raiz.querySelector('.of-cam-message');
      const btnAbrir = raiz.querySelector('[data-cam-abrir]');
      const btnCapturar = raiz.querySelector('[data-cam-capturar]');
      const btnCerrar = raiz.querySelector('[data-cam-cerrar]');
      const contador = raiz.querySelector('.of-contador');
      let stream = null;
      const aviso = (tipo, texto) => { msg.className = `form-message of-cam-message visible ${tipo}`; msg.textContent = texto; };
      const parar = () => {
        if (stream) stream.getTracks().forEach((tr) => tr.stop());
        stream = null;
        video.hidden = true;
        marco.classList.remove('is-live');
        btnCapturar.hidden = true;
        btnCerrar.hidden = true;
        btnAbrir.hidden = fotos.length >= max;
      };
      function pintar() {
        contador.textContent = t('offer.photoCount', { n: fotos.length, max });
        contador.hidden = max === 1;
        thumbs.innerHTML = fotos.map((f, i) => `<figure class="of-thumb"><img src="${e(f)}" alt="" /><button type="button" class="of-thumb-x" data-quitar="${i}" aria-label="${e(t('offer.removePhoto'))}">✕</button></figure>`).join('');
        thumbs.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
          fotos.splice(Number(b.dataset.quitar), 1);
          pintar();
          if (!stream) btnAbrir.hidden = false;
        }));
        btnCapturar.disabled = fotos.length >= max;
        if (alCambiar) alCambiar();
      }
      async function abrir() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { aviso('error', t('offer.cameraUnsupported')); return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          video.srcObject = stream;
          video.hidden = false;
          marco.classList.add('is-live');
          btnAbrir.hidden = true;
          btnCapturar.hidden = false;
          btnCerrar.hidden = false;
          aviso('info', t('offer.cameraReady'));
        } catch (err) { aviso('error', t('offer.cameraUnavailable')); }
      }
      function capturar() {
        if (fotos.length >= max) return;
        if (!video.videoWidth) { aviso('info', t('offer.cameraReady')); return; }
        const ratio = Math.min(1, 1024 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        fotos.push(canvas.toDataURL('image/jpeg', 0.72));
        pintar();
        aviso('success', max === 1 ? t('offer.photoTaken') : t('offer.photoCount', { n: fotos.length, max }));
        if (fotos.length >= max) parar();
      }
      btnAbrir.addEventListener('click', abrir);
      btnCapturar.addEventListener('click', capturar);
      btnCerrar.addEventListener('click', parar);
      pintar();
      return { parar };
    }

    // Cámara: visor arriba, y JUSTO debajo el botón grande de acción (abrir /
    // tomar foto, nunca los dos a la vez). Nada compite con ese botón.
    function camaraHtml(prefijo) {
      return `<div class="of-cam" id="${prefijo}-cam">
        <div class="offer-camera">
          <video autoplay playsinline muted hidden></video>
          <canvas hidden></canvas>
          <p class="of-cam-hint">${e(t('offer.cameraIdle'))}</p>
        </div>
        <button class="btn btn-primary of-cam-shoot" type="button" data-cam-abrir>${e(t('offer.openCamera'))}</button>
        <button class="btn btn-primary of-cam-shoot" type="button" data-cam-capturar hidden>${e(t('offer.takePhoto'))}</button>
        <button class="btn btn-ghost of-cam-close" type="button" data-cam-cerrar hidden>${e(t('offer.closeCamera'))}</button>
        <p class="of-contador meta" aria-live="polite"></p>
        <div class="of-thumbs" aria-live="polite"></div>
        <div class="form-message of-cam-message" role="status" aria-live="polite"></div>
      </div>`;
    }

    function pasoCamaraHtml(prefijo, titulo, copia) {
      return `<div data-wiz-step id="${prefijo}-field" class="of-cam-step">
        <label>${e(titulo)}</label>
        <p class="section-copy">${e(copia)}</p>
        ${camaraHtml(prefijo)}
      </div>`;
    }

    // «Tengo el insumo»: ahora es una PÁGINA propia (#ofrecer) con asistente
    // paso a paso: datos, hasta 20 fotos del insumo con la cámara, foto de la
    // cédula, y ubicación con GPS o eligiendo el punto en el mapa.
    function abrirOfrecerInsumo(datos) {
      const shell = $('#ofrecer-shell');
      if (!shell) return;
      const pre = datos || {};
      if (typeof cambiarVista === 'function') cambiarVista('ofrecer');
      if (!/^#ofrecer$/i.test(window.location.hash)) window.location.hash = '#ofrecer';
      shell.innerHTML = `<form id="ofrecer-form" class="offer-wizard" data-wiz="ofrecer" novalidate>
        <p class="section-copy">${e(pre.centro ? t('offer.modalCopyCentro', { insumo: mostrarInsumo(pre.insumo), centro: pre.centro }) : t('offer.modalCopy'))}</p>
        <div class="form-grid">
          <div class="field full"><label for="of-insumo">${e(t('offer.supplyLabel'))}</label><input id="of-insumo" required value="${e(pre.insumo || '')}" placeholder="${e(t('offer.supplyPh'))}" /></div>
          <div class="field"><label for="of-cantidad">${e(t('offer.qtyLabel'))}</label><input id="of-cantidad" type="number" min="1" step="1" required /></div>
          <div class="field"><label for="of-unidad">${e(t('offer.unitLabel'))}</label><input id="of-unidad" value="${e(pre.unidad || '')}" placeholder="${e(t('offer.unitPh'))}" /></div>
        </div>
        ${pasoCamaraHtml('of-fotos', t('offer.photosTitle'), t('offer.photosCopy'))}
        <div class="form-grid">
          <div class="field full"><label for="of-nombre">${e(t('offer.contactNameLabel'))}</label><input id="of-nombre" required autocomplete="name" placeholder="${e(t('offer.contactNamePh'))}" /></div>
          <div class="field"><label for="of-telefono">${e(t('common.phone'))}</label><input id="of-telefono" type="tel" inputmode="tel" required autocomplete="tel" placeholder="+58 412 000 0000" /></div>
        </div>
        ${pasoCamaraHtml('of-cedula', t('offer.idTitle'), t('offer.idCopy'))}
        <div data-wiz-step id="of-lugar-field" class="of-lugar-step">
          <label>${e(t('offer.placeTitle'))}</label>
          <p class="section-copy">${e(t('offer.placeCopy'))}</p>

          <div class="of-bloque">
            <h4 class="of-sub">${e(t('offer.placeMapTitle'))}</h4>
            <div class="of-geo-actions">
              <button class="btn btn-primary" type="button" id="of-gps">${e(t('offer.useGps'))}</button>
              <button class="btn btn-soft" type="button" id="of-mapa-btn">${e(t('offer.pickOnMap'))}</button>
            </div>
            <div id="of-mapa" class="of-mapa" hidden></div>
            <p class="meta of-coords" id="of-coords" aria-live="polite">${e(t('offer.noCoords'))}</p>
            <div class="form-message" id="of-geo-message" role="status" aria-live="polite"></div>
          </div>

          <div class="of-bloque">
            <h4 class="of-sub"><label for="of-referencia">${e(t('offer.refLabel'))}</label></h4>
            <input id="of-referencia" class="of-ref-input" required maxlength="120" placeholder="${e(t('offer.refPh'))}" />
            <p class="meta">${e(t('offer.refHelp'))}</p>
          </div>

          <div class="of-bloque">
            <h4 class="of-sub">${e(t('offer.placePhotoTitle'))}</h4>
            <p class="meta">${e(t('offer.placePhotoCopy'))}</p>
            ${camaraHtml('of-lugar')}
          </div>
        </div>
        <p class="meta">${e(t('offer.privacyNote'))}</p>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('offer.submit'))}</button></div>
        <div id="of-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`;
      const form = $('#ofrecer-form');
      const fotos = [];
      const cedula = [];
      const fotoLugar = [];
      const coords = { lat: null, lng: null };
      let mapa = null, marcador = null;
      const camFotos = montarCamaraOferta('of-fotos', fotos, 20);
      const camCedula = montarCamaraOferta('of-cedula', cedula, 1);
      const camLugar = montarCamaraOferta('of-lugar', fotoLugar, 1);
      const pasoFotos = $('#of-fotos-field');
      const pasoCedula = $('#of-cedula-field');
      const pasoLugar = $('#of-lugar-field');
      const pintarCoords = () => {
        $('#of-coords').textContent = coords.lat == null ? t('offer.noCoords') : t('offer.coordsSet', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) });
      };
      const fijarCoords = (lat, lng) => { coords.lat = lat; coords.lng = lng; pintarCoords(); };
      $('#of-gps').addEventListener('click', () => {
        if (!navigator.geolocation) { mostrarMensaje('#of-geo-message', 'error', t('offer.gpsUnsupported')); return; }
        mostrarMensaje('#of-geo-message', 'info', t('offer.gpsAsking'));
        navigator.geolocation.getCurrentPosition(
          (pos) => { fijarCoords(pos.coords.latitude, pos.coords.longitude); mostrarMensaje('#of-geo-message', 'success', t('offer.gpsOk')); if (mapa) { mapa.setView([coords.lat, coords.lng], 16); marcador.setLatLng([coords.lat, coords.lng]); } },
          () => mostrarMensaje('#of-geo-message', 'error', t('offer.gpsError')),
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
      $('#of-mapa-btn').addEventListener('click', () => {
        const div = $('#of-mapa');
        div.hidden = false;
        if (!mapa && window.L) {
          const inicio = coords.lat != null ? [coords.lat, coords.lng] : [10.48, -66.9];
          mapa = L.map('of-mapa').setView(inicio, coords.lat != null ? 16 : 6);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
          marcador = L.marker(inicio, { draggable: true }).addTo(mapa);
          marcador.on('dragend', () => { const ll = marcador.getLatLng(); fijarCoords(ll.lat, ll.lng); });
          mapa.on('click', (ev) => { marcador.setLatLng(ev.latlng); fijarCoords(ev.latlng.lat, ev.latlng.lng); });
          if (coords.lat != null) fijarCoords(coords.lat, coords.lng);
        }
        if (mapa) setTimeout(() => mapa.invalidateSize(), 60);
        mostrarMensaje('#of-geo-message', 'info', t('offer.mapHint'));
      });
      wizPublico(form, {
        alEntrar: (paso) => {
          if (paso !== pasoFotos) camFotos.parar();
          if (paso !== pasoCedula) camCedula.parar();
          if (paso !== pasoLugar) camLugar.parar();
          if (paso === pasoLugar && mapa) setTimeout(() => mapa.invalidateSize(), 60);
        },
        validar: (paso) => {
          if (paso === pasoFotos) {
            if (!fotos.length) return t('offer.photosRequired');
            pasoFotos.dataset.wizDone = t('offer.photoCount', { n: fotos.length, max: 20 });
            camFotos.parar();
            return true;
          }
          if (paso === pasoCedula) {
            if (!cedula.length) return t('offer.idRequired');
            pasoCedula.dataset.wizDone = t('offer.photoTaken');
            camCedula.parar();
            return true;
          }
          if (paso === pasoLugar) {
            // Un solo paso: punto exacto + nombre de referencia + foto del sitio.
            if (coords.lat == null) return t('offer.geoRequired');
            if (!$('#of-referencia').value.trim()) return t('offer.refRequired');
            if (!fotoLugar.length) return t('offer.placePhotoRequired');
            pasoLugar.dataset.wizDone = `${$('#of-referencia').value.trim()} · ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
            camLugar.parar();
            return true;
          }
          return undefined;
        }
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!fotos.length) { mostrarMensaje('#of-message', 'error', t('offer.photosRequired')); return; }
        if (!cedula.length) { mostrarMensaje('#of-message', 'error', t('offer.idRequired')); return; }
        if (coords.lat == null) { mostrarMensaje('#of-message', 'error', t('offer.geoRequired')); return; }
        if (!fotoLugar.length) { mostrarMensaje('#of-message', 'error', t('offer.placePhotoRequired')); return; }
        const referencia = $('#of-referencia').value.trim();
        if (!referencia) { mostrarMensaje('#of-message', 'error', t('offer.refRequired')); return; }
        const cantidad = numero($('#of-cantidad').value);
        if (cantidad <= 0) { mostrarMensaje('#of-message', 'error', t('needs.invalidAmount')); return; }
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#of-message', 'info', t('offer.saving'));
        try {
          const res = await window.SheetsService.post({
            accion: 'ofrecer_insumo', insumo: $('#of-insumo').value.trim(), cantidad,
            unidad: $('#of-unidad').value.trim(), ubicacion: referencia,
            telefono: $('#of-telefono').value.trim(), nombreDonante: $('#of-nombre').value.trim(),
            fotoInsumo: fotos[0], fotosInsumo: fotos, fotoCedula: cedula[0] || '',
            fotoLugar: fotoLugar[0] || '',
            lat: coords.lat, lng: coords.lng, centro: pre.centro || ''
          });
          camFotos.parar(); camCedula.parar(); camLugar.parar();
          mostrarTokenOferta(res.token);
          cargarOfertas();
        } catch (err) { boton.disabled = false; mostrarMensaje('#of-message', 'error', String(err && err.message || t('needs.error'))); }
      });
    }

    // Reemplaza el formulario por el token: el donante debe poder copiarlo, así
    // que no vale un toast pasajero.
    function mostrarTokenOferta(token) {
      const cuerpo = $('#ofrecer-shell') || $('#modal-root .modal-body');
      cuerpo.innerHTML = `<div class="token-result">
        <h3>${e(t('offer.thanksTitle'))}</h3>
        <p class="section-copy">${e(t('offer.thanksCopy'))}</p>
        <p class="meta">${e(t('needs.tokenLabel'))}</p>
        <p class="token-value"><strong>${e(token)}</strong></p>
        <div class="card-actions">
          <button class="btn btn-soft btn-small" type="button" id="of-copiar">${e(t('needs.copyCta'))}</button>
          <button class="btn btn-primary btn-small" type="button" id="of-seguir">${e(t('needs.track'))}</button>
        </div>
      </div>`;
      $('#of-copiar').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(token);
          toast(t('needs.copied'));
        } catch (err) {
          toast(token); // sin permiso de portapapeles: al menos queda a la vista
        }
      });
      $('#of-seguir').addEventListener('click', () => {
        $('#modal-root dialog').close();
        buscarSeguimiento(token);
      });
    }

    // El transportista reclama una oferta: su nombre + centro de destino.
    function abrirRecogerOferta(of) {
      abrirModal(t('offer.pickupTitle'), `<form id="recoger-oferta-form" data-wiz="recoger" novalidate>
        <p class="section-copy">${e(t('offer.pickupCopy', { cantidad: numero(of.cantidad), unidad: mostrarUnidad(of.unidad), insumo: mostrarInsumo(of.insumo), ubicacion: of.ubicacion }))}</p>
        <div class="form-grid">
          <div class="field"><label for="rof-nombre">${e(t('cycle.driverName'))}</label><input id="rof-nombre" required autocomplete="name" /></div>
          <div class="field"><label for="rof-centro">${e(t('offer.destLabel'))}</label><input id="rof-centro" required value="${e(of.centro || '')}" placeholder="${e(t('offer.destPh'))}" /></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('offer.pickupSave'))}</button></div>
        <div id="rof-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);
      wizPublico('recoger-oferta-form');
      $('#recoger-oferta-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#rof-message')) return;
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#rof-message', 'info', t('money.saving'));
        try {
          await window.SheetsService.post({
            accion: 'recoger_oferta', token: of.token,
            nombreTransportista: $('#rof-nombre').value.trim(),
            centroDestino: $('#rof-centro').value.trim()
          });
          $('#modal-root dialog').close();
          toast(t('offer.pickupSaved'));
          cargarOfertas();
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#rof-message', 'error', String(err && err.message || t('needs.error')));
        }
      });
    }

    // ── Donación en DINERO a un presupuesto (simulada hasta conectar la cuenta) ──
    // El sistema genera la referencia de transacción; con la cuenta real, la
    // referencia vendrá del pago y entrará por este mismo flujo.
    function abrirDonarDinero(pr) {
      const faltan = Math.max(1, numero(pr.precio) - numero(pr.recaudado));
      abrirModal(t('money.modalTitle'), `<form id="donar-dinero-form" data-wiz="donarDinero" novalidate>
        <p class="section-copy">${e(t('money.modalCopy', { insumo: mostrarInsumo(pr.insumo), tienda: pr.tienda, centro: pr.centro }))}</p>
        <p class="meta">${e(t('needs.missing', { faltan: formatearMonto(faltan) }))}</p>
        <div class="form-grid">
          <div class="field"><label for="din-monto">${e(t('money.amountLabel'))}</label><input id="din-monto" type="number" min="1" step="1" value="${e(faltan)}" required /></div>
          <div class="field"><label for="din-nombre">${e(t('needs.donorLabel'))}</label><input id="din-nombre" autocomplete="name" placeholder="${e(t('needs.donorPlaceholder'))}" /></div>
        </div>
        <p class="meta">${e(t('money.simNote'))}</p>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('money.submit'))}</button></div>
        <div id="din-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);
      wizPublico('donar-dinero-form');
      $('#donar-dinero-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#din-message')) return;
        const monto = numero($('#din-monto').value);
        if (monto <= 0) { mostrarMensaje('#din-message', 'error', t('needs.invalidAmount')); return; }
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#din-message', 'info', t('money.saving'));
        try {
          const res = await window.SheetsService.post({
            accion: 'donar_dinero', token: pr.token, monto,
            nombreDonante: $('#din-nombre').value.trim()
          });
          mostrarReciboDinero(res, pr);
          cargarPresupuestos();
          cargarComprados();
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#din-message', 'error', String(err && err.message || t('needs.error')));
        }
      });
    }

    // Recibo tras donar dinero: referencia de la transacción + token de
    // seguimiento. Debe poder copiarse, no vale un toast pasajero.
    function mostrarReciboDinero(res, pr) {
      const cuerpo = $('#modal-root .modal-body');
      const comprado = res.estado === 'Comprada';
      cuerpo.innerHTML = `<div class="token-result">
        <h3>${e(t('money.thanksTitle'))}</h3>
        <p class="section-copy">${e(comprado ? t('money.thanksBought', { insumo: mostrarInsumo(pr.insumo) }) : t('money.thanksPartial', { insumo: mostrarInsumo(pr.insumo), recaudado: formatearMonto(res.recaudado), precio: formatearMonto(res.precio) }))}</p>
        <p class="meta">${e(t('money.refLabel'))}</p>
        <p class="token-value"><strong>${e(res.referencia)}</strong></p>
        <p class="meta">${e(t('needs.tokenLabel'))}</p>
        <p class="token-value"><strong>${e(res.token)}</strong></p>
        <div class="card-actions">
          <button class="btn btn-soft btn-small" type="button" id="din-copiar">${e(t('needs.copyCta'))}</button>
          <button class="btn btn-primary btn-small" type="button" id="din-seguir">${e(t('needs.track'))}</button>
        </div>
      </div>`;
      $('#din-copiar').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(t('money.copyText', { referencia: res.referencia, token: res.token }));
          toast(t('needs.copied'));
        } catch (err) { toast(res.token); }
      });
      $('#din-seguir').addEventListener('click', () => {
        $('#modal-root dialog').close();
        buscarSeguimiento(res.token);
      });
    }

    // ── Ciclo del transportista sobre un insumo comprado ──
    function bindPreviewsFoto(ids) {
      ids.forEach((id) => {
        $('#' + id).addEventListener('change', (ev) => {
          const file = ev.target.files && ev.target.files[0];
          const prev = $('#' + id + '-prev');
          if (!file) { prev.hidden = true; return; }
          prev.src = URL.createObjectURL(file);
          prev.hidden = false;
        });
      });
    }

    function abrirRegistrarRecogida(pr) {
      abrirModal(t('cycle.pickupTitle'), `<form id="recogida-form" novalidate>
        <p class="section-copy">${e(t('cycle.pickupCopy', { insumo: mostrarInsumo(pr.insumo), tienda: pr.tienda, direccion: pr.direccion || '' }))}</p>
        <div class="form-grid">
          <div class="field"><label for="rec-nombre">${e(t('cycle.driverName'))}</label><input id="rec-nombre" required autocomplete="name" /></div>
          <div class="field full"><label for="rec-notas">${e(t('cycle.notes'))}</label><input id="rec-notas" /></div>
          ${campoFoto('rec-foto-sitio', 'cycle.photoSite')}
          ${campoFoto('rec-foto-insumo', 'cycle.photoSupply')}
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('cycle.pickupSave'))}</button></div>
        <div id="rec-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);
      bindPreviewsFoto(['rec-foto-sitio', 'rec-foto-insumo']);
      $('#recogida-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#rec-message')) return;
        const archivos = ['rec-foto-sitio', 'rec-foto-insumo'].map((id) => $('#' + id).files && $('#' + id).files[0]);
        if (archivos.some((f) => !f)) { mostrarMensaje('#rec-message', 'error', t('cycle.photosMissing')); return; }
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#rec-message', 'info', t('messages.driverUploading'));
        try {
          const [fotoSitio, fotoInsumo] = await Promise.all(archivos.map(comprimirFoto));
          await window.SheetsService.post({
            accion: 'registrar_recogida', token: pr.token,
            nombreTransportista: $('#rec-nombre').value.trim(),
            notas: $('#rec-notas').value.trim(), fotoSitio, fotoInsumo
          });
          $('#modal-root dialog').close();
          toast(t('cycle.pickupSaved'));
          cargarComprados();
          cargarPresupuestos();
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#rec-message', 'error', String(err && err.message || t('needs.error')));
        }
      });
    }

    function abrirRegistrarEntrega(pr) {
      abrirModal(t('cycle.deliverTitle'), `<form id="entrega-form" novalidate>
        <p class="section-copy">${e(t('cycle.deliverCopy', { insumo: mostrarInsumo(pr.insumo), centro: pr.centro }))}</p>
        <div class="form-grid">
          <div class="field"><label for="ent-receptor">${e(t('cycle.receiverName'))}</label><input id="ent-receptor" required autocomplete="name" /></div>
          <div class="field"><label for="ent-cargo">${e(t('cycle.receiverRole'))}</label><input id="ent-cargo" /></div>
          ${campoFoto('ent-foto', 'cycle.photoDelivered')}
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('cycle.deliverSave'))}</button></div>
        <div id="ent-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);
      bindPreviewsFoto(['ent-foto']);
      $('#entrega-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#ent-message')) return;
        const archivo = $('#ent-foto').files && $('#ent-foto').files[0];
        if (!archivo) { mostrarMensaje('#ent-message', 'error', t('cycle.photosMissing')); return; }
        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#ent-message', 'info', t('messages.driverUploading'));
        try {
          const fotoEntrega = await comprimirFoto(archivo);
          await window.SheetsService.post({
            accion: 'registrar_entrega_final', token: pr.token,
            nombreReceptor: $('#ent-receptor').value.trim(),
            cargoReceptor: $('#ent-cargo').value.trim(), fotoEntrega
          });
          $('#modal-root dialog').close();
          toast(t('cycle.deliverSaved'));
          cargarComprados();
          cargarPresupuestos();
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#ent-message', 'error', String(err && err.message || t('needs.error')));
        }
      });
    }

    // Comprime una foto del input a JPEG ≤1280px (el backend limita ~1.8MB) y
    // devuelve un data URL listo para enviar a la edge function.
    function comprimirFoto(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const escala = Math.min(1, 1280 / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * escala);
          canvas.height = Math.round(img.height * escala);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('foto ilegible')); };
        img.src = url;
      });
    }

    function campoFoto(id, labelKey) {
      return `<div class="field full foto-field"><label for="${id}">${e(t(labelKey))}</label>
        <input id="${id}" type="file" accept="image/*" capture="environment" required />
        <img id="${id}-prev" class="foto-prev" alt="" hidden /></div>`;
    }

    // Captura de cámara para el registro del transportista. No usamos un
    // input de archivos: las tres evidencias deben tomarse en el momento y el
    // navegador controla el permiso de cámara con getUserMedia().
    function camaraTransportistaHtml(prefijo, tituloKey, ayudaKey) {
      return `<div data-wiz-step id="${prefijo}-step" class="driver-photo-step">
        <label class="driver-photo-title" for="${prefijo}-abrir">${e(t(tituloKey))}</label>
        <p class="field-help" id="${prefijo}-help">${e(t(ayudaKey))}</p>
        <div class="driver-camera" id="${prefijo}-cam">
          <div class="offer-camera">
            <video autoplay playsinline muted hidden></video>
            <canvas hidden></canvas>
            <img class="driver-photo-preview" alt="" hidden />
            <p class="of-cam-hint">${e(t('modal.cameraIdle'))}</p>
          </div>
          <button class="btn btn-primary of-cam-shoot" type="button" data-driver-cam-abrir id="${prefijo}-abrir" aria-describedby="${prefijo}-help">${e(t('modal.openCamera'))}</button>
          <button class="btn btn-primary of-cam-shoot" type="button" data-driver-cam-capturar hidden>${e(t('modal.takePhoto'))}</button>
          <button class="btn btn-ghost of-cam-close" type="button" data-driver-cam-repetir hidden>${e(t('modal.retakePhoto'))}</button>
          <button class="btn btn-ghost of-cam-close" type="button" data-driver-cam-cerrar hidden>${e(t('modal.closeCamera'))}</button>
          <div class="form-message of-cam-message" role="status" aria-live="polite"></div>
        </div>
      </div>`;
    }

    function montarCamaraTransportista(prefijo, foto) {
      const raiz = document.getElementById(prefijo + '-cam');
      const video = raiz.querySelector('video');
      const canvas = raiz.querySelector('canvas');
      const preview = raiz.querySelector('.driver-photo-preview');
      const marco = raiz.querySelector('.offer-camera');
      const msg = raiz.querySelector('.of-cam-message');
      const btnAbrir = raiz.querySelector('[data-driver-cam-abrir]');
      const btnCapturar = raiz.querySelector('[data-driver-cam-capturar]');
      const btnRepetir = raiz.querySelector('[data-driver-cam-repetir]');
      const btnCerrar = raiz.querySelector('[data-driver-cam-cerrar]');
      let stream = null;
      const aviso = (tipo, texto) => { msg.className = `form-message of-cam-message visible ${tipo}`; msg.textContent = texto; };
      const parar = () => {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        stream = null;
        video.hidden = true;
        marco.classList.remove('is-live');
        btnCapturar.hidden = true;
        btnCerrar.hidden = true;
        btnAbrir.hidden = Boolean(foto.value);
        btnRepetir.hidden = !foto.value;
      };
      const pintar = () => {
        preview.hidden = !foto.value;
        if (foto.value) preview.src = foto.value;
        btnAbrir.hidden = Boolean(foto.value) || Boolean(stream);
        btnRepetir.hidden = !foto.value || Boolean(stream);
      };
      async function abrir() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { aviso('error', t('modal.cameraUnsupported')); return; }
        try {
          parar();
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          video.srcObject = stream;
          video.hidden = false;
          marco.classList.add('is-live');
          btnAbrir.hidden = true;
          btnRepetir.hidden = true;
          btnCapturar.hidden = false;
          btnCerrar.hidden = false;
          aviso('info', t('modal.cameraReady'));
        } catch (err) {
          parar();
          aviso('error', err && err.name === 'NotAllowedError' ? t('modal.cameraPermission') : t('modal.cameraUnavailable'));
        }
      }
      function capturar() {
        if (!video.videoWidth || !video.videoHeight) { aviso('error', t('modal.cameraNotReady')); return; }
        const ratio = Math.min(1, 1280 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        foto.value = canvas.toDataURL('image/jpeg', 0.82);
        parar();
        pintar();
        aviso('success', t('modal.photoTaken'));
      }
      function repetir() { foto.value = ''; preview.hidden = true; pintar(); abrir(); }
      btnAbrir.addEventListener('click', abrir);
      btnCapturar.addEventListener('click', capturar);
      btnRepetir.addEventListener('click', repetir);
      btnCerrar.addEventListener('click', parar);
      pintar();
      return { parar, tieneFoto: () => Boolean(foto.value) };
    }

    function abrirRegistrarMotorizado() {
      abrirModal(t('modal.driverTitle'), `<form id="mot-form" data-wiz="motorizado" novalidate>
        <p class="section-copy">${e(t('modal.driverIntro'))}</p>
        <div class="form-grid">
          <div class="field"><label for="mot-nombre">${e(t('common.name'))}</label><p class="field-help" id="mot-nombre-help">${e(t('modal.nameHelp'))}</p><input id="mot-nombre" aria-describedby="mot-nombre-help" required /></div>
          <div class="field"><label for="mot-tipo">${e(t('common.vehicle'))}</label><p class="field-help" id="mot-tipo-help">${e(t('modal.vehicleHelp'))}</p><select id="mot-tipo" aria-describedby="mot-tipo-help"><option value="Moto">${e(mostrarTransporte('Moto'))}</option><option value="Carro">${e(mostrarTransporte('Carro'))}</option><option value="Bicicleta">${e(mostrarTransporte('Bicicleta'))}</option><option value="Camión">${e(mostrarTransporte('Camión'))}</option><option value="Motocarro">${e(mostrarTransporte('Motocarro'))}</option></select></div>
          <div class="field"><label for="mot-telefono">${e(t('common.phone'))}</label><p class="field-help" id="mot-telefono-help">${e(t('modal.phoneHelp'))}</p><input id="mot-telefono" aria-describedby="mot-telefono-help" type="tel" required /></div>
          <div class="field"><label for="mot-email">${e(t('common.email'))}</label><p class="field-help" id="mot-email-help">${e(t('modal.emailHelp'))}</p><input id="mot-email" aria-describedby="mot-email-help" type="email" required autocomplete="email" /></div>
          <div class="field"><label for="mot-zona">${e(t('modal.zone'))}</label><p class="field-help" id="mot-zona-help">${e(t('modal.zoneHelp'))}</p><input id="mot-zona" aria-describedby="mot-zona-help" required /></div>
          <div class="field"><label for="mot-placa">${e(t('modal.plate'))}</label><p class="field-help" id="mot-placa-help">${e(t('modal.plateHelp'))}</p><input id="mot-placa" aria-describedby="mot-placa-help" /></div>
        </div>
        ${camaraTransportistaHtml('mot-placa-foto', 'modal.photoPlate', 'modal.photoPlateHelp')}
        ${camaraTransportistaHtml('mot-vehiculo-foto', 'modal.photoVehicle', 'modal.photoVehicleHelp')}
        ${camaraTransportistaHtml('mot-cedula-foto', 'modal.photoId', 'modal.photoIdHelp')}
        <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('modal.saveDriver'))}</button></div>
        <div id="mot-message" class="form-message" role="status" aria-live="polite"></div>
      </form>`);
      const fotoPlaca = { value: '' }, fotoVehiculo = { value: '' }, fotoCedula = { value: '' };
      const camPlaca = montarCamaraTransportista('mot-placa-foto', fotoPlaca);
      const camVehiculo = montarCamaraTransportista('mot-vehiculo-foto', fotoVehiculo);
      const camCedula = montarCamaraTransportista('mot-cedula-foto', fotoCedula);
      const fotoPorPaso = new Map([
        [$('#mot-placa-foto-step'), camPlaca],
        [$('#mot-vehiculo-foto-step'), camVehiculo],
        [$('#mot-cedula-foto-step'), camCedula]
      ]);
      const pararCamaras = (actual) => fotoPorPaso.forEach((cam, paso) => { if (paso !== actual) cam.parar(); });
      wizPublico('mot-form', {
        alEntrar: (paso) => pararCamaras(paso),
        validar: (paso) => {
          const cam = fotoPorPaso.get(paso);
          if (!cam) return undefined;
          if (!cam.tieneFoto()) return t('modal.photoRequired');
          paso.dataset.wizDone = t('modal.photoTaken');
          return true;
        }
      });
      const dialog = $('#modal-root dialog');
      dialog.addEventListener('close', () => { camPlaca.parar(); camVehiculo.parar(); camCedula.parar(); }, { once: true });
      $('#mot-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (![fotoPlaca, fotoVehiculo, fotoCedula].every((foto) => foto.value)) {
          mostrarMensaje('#mot-message', 'error', t('messages.driverPhotosMissing'));
          return;
        }
        const boton = ev.currentTarget.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#mot-message', 'info', t('messages.driverUploading'));
        try {
          const nuevo = { nombre: $('#mot-nombre').value.trim(), tipoVehiculo: $('#mot-tipo').value, telefono: $('#mot-telefono').value.trim(), email: $('#mot-email').value.trim(), zonaOperacion: $('#mot-zona').value.trim(), operaEn: $('#mot-zona').value.trim(), placa: $('#mot-placa').value.trim(), fotoPlaca: fotoPlaca.value, fotoVehiculo: fotoVehiculo.value, fotoCedula: fotoCedula.value };
          await window.SheetsService.post(Object.assign({ accion: 'registrar_motorizado' }, nuevo));
          await cargarTodo();
          $('#modal-root dialog').close();
          toast(t('messages.driverSaved'));
        } catch (err) {
          boton.disabled = false;
          mostrarMensaje('#mot-message', 'error', String(err && err.message || t('messages.driverPhotoError')));
        }
      });
    }

    // ── Acceso por correo: código de 6 dígitos (Supabase Auth OTP) ──
    // La sesión vive en sessionStorage (solo esta pestaña): { email, roles }.
    const ACCESO_SS = 'dv-acceso';

    function sesionAcceso() {
      try { return JSON.parse(window.sessionStorage.getItem(ACCESO_SS) || 'null'); } catch (err) { return null; }
    }

    function pintarPerfilAcceso() {
      const cont = $('#acceso-perfil');
      if (!cont) return;
      const ses = sesionAcceso();
      const formEmail = $('#acceso-email-form');
      const formCodigo = $('#acceso-codigo-form');
      if (!ses) { cont.hidden = true; cont.innerHTML = ''; formCodigo.hidden = true; formEmail.hidden = false; return; }
      formEmail.hidden = true;
      formCodigo.hidden = true;
      const filas = (ses.roles || []).map((r) => {
        if (r.tipo === 'transportista') {
          return `<li><strong>${e(t('access.driverTitle'))}</strong> · ${e(r.nombre)} — <a href="#transporte">${e(t('access.goDriver'))}</a></li>`;
        }
        if (r.tipo === 'voluntario') {
          return `<li><strong>${e(t('access.volunteerTitle'))}</strong> · ${e(r.nombre)} — <a href="#voluntarios">${e(t('access.goVolunteer'))}</a></li>`;
        }
        return `<li><strong>${e(t('access.centerTitle'))}</strong> · ${e(r.nombre)} — <a href="/panel-centro?token=${e(encodeURIComponent(r.token || ''))}">${e(t('access.goCenter'))}</a></li>`;
      }).join('');
      cont.innerHTML = `
        <p class="meta">${e(t('access.signedInAs', { email: ses.email }))}</p>
        <ul class="acceso-roles">${filas}</ul>
        <div class="form-actions"><button class="btn btn-ghost" type="button" id="acceso-salir">${e(t('access.signOut'))}</button></div>`;
      cont.hidden = false;
      $('#acceso-salir').addEventListener('click', () => {
        try { window.sessionStorage.removeItem(ACCESO_SS); } catch (err) { /* modo privado */ }
        mostrarMensaje('#acceso-msg', 'info', t('access.signedOut'));
        pintarPerfilAcceso();
      });
    }

    function bindAcceso() {
      const formEmail = $('#acceso-email-form');
      if (!formEmail) return; // la página-ventana no tiene la vista acceso
      const formCodigo = $('#acceso-codigo-form');
      let correo = '';
      formEmail.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!validarFormulario(formEmail, '#acceso-msg')) return;
        correo = $('#acceso-email').value.trim().toLowerCase();
        const boton = $('#acceso-enviar-btn');
        boton.disabled = true;
        mostrarMensaje('#acceso-msg', 'info', t('access.sending'));
        try {
          await window.SheetsService.solicitarCodigo(correo);
          formEmail.hidden = true;
          formCodigo.hidden = false;
          $('#acceso-codigo').focus();
          mostrarMensaje('#acceso-msg', 'success', t('access.codeSent', { email: correo }));
        } catch (err) {
          mostrarMensaje('#acceso-msg', 'error', String(err && err.message || t('access.sendError')));
        } finally { boton.disabled = false; }
      });
      $('#acceso-otro-correo').addEventListener('click', () => {
        formCodigo.hidden = true;
        formEmail.hidden = false;
        $('#acceso-email').focus();
      });
      formCodigo.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const codigo = $('#acceso-codigo').value.trim();
        if (!/^[0-9]{6}$/.test(codigo)) {
          mostrarMensaje('#acceso-msg', 'error', t('access.codeFormat'));
          return;
        }
        const boton = $('#acceso-entrar-btn');
        boton.disabled = true;
        mostrarMensaje('#acceso-msg', 'info', t('access.verifying'));
        try {
          const sesion = await window.SheetsService.verificarCodigo(correo, codigo);
          const data = await window.SheetsService.post({ accion: 'acceso_perfil', accessToken: sesion.access_token });
          if (!data.roles || !data.roles.length) {
            mostrarMensaje('#acceso-msg', 'error', t('access.noRoles'));
            return;
          }
          try { window.sessionStorage.setItem(ACCESO_SS, JSON.stringify({ email: data.email, roles: data.roles })); } catch (err) { /* modo privado */ }
          $('#acceso-codigo').value = '';
          mostrarMensaje('#acceso-msg', 'success', t('access.welcome'));
          pintarPerfilAcceso();
        } catch (err) {
          const crudo = String(err && err.message || '');
          // GoTrue responde en inglés; el caso típico (código malo o vencido) se traduce.
          const amigable = /expired|invalid|not found/i.test(crudo) || !crudo ? t('access.verifyError') : crudo;
          mostrarMensaje('#acceso-msg', 'error', amigable);
        } finally { boton.disabled = false; }
      });
      $$('.js-acceso-entrar').forEach((btn) => btn.addEventListener('click', () => {
        document.getElementById('acceso-login-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('#acceso-email').focus();
      }));
      pintarPerfilAcceso();
    }

    function bindForms() {
      // Formularios estáticos como asistente "una casilla a la vez" (wiz.js).
      // Solo presentación: los ids y handlers de submit no cambian.
      wizPublico('lugar-form');
      wizPublico('voluntario-form');
      wizPublico('rescatista-form');
      wizPublico('persona-form');
      wizPublico('familiar-form');
      wizPublico('seguimiento-form');
      $('#lugar-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#lugar-message')) return;
        const coords = parsearCoords($('#lugar-coords') ? $('#lugar-coords').value : '') || {};
        const payload = Object.assign({ accion: 'registrar_lugar', tipo: $('#lugar-tipo').value, nombre: $('#lugar-nombre').value.trim(), ubicacion: $('#lugar-ubicacion').value.trim(), telefono: $('#lugar-telefono').value.trim(), insumo: $('#lugar-insumo').value.trim(), categoria: $('#lugar-categoria').value, estado: $('#lugar-estado').value }, coords);
        mostrarMensaje('#lugar-message', 'info', t('messages.savingReport'));
        try {
          await window.SheetsService.post(payload);
          await cargarTodo();
          mostrarMensaje('#lugar-message', 'success', t('messages.reportSaved'));
          limpiarErrores(form);
          form.reset();
        } catch (err) {
          mostrarMensaje('#lugar-message', 'error', t('messages.reportError'));
        }
      });

      const volCedula = $('#vol-cedula');
      if (volCedula) volCedula.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        const prev = $('#vol-cedula-prev');
        if (!file) { prev.hidden = true; return; }
        prev.src = URL.createObjectURL(file);
        prev.hidden = false;
      });

      $('#voluntario-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#vol-message')) return;
        const archivoCedula = $('#vol-cedula').files && $('#vol-cedula').files[0];
        if (!archivoCedula) {
          mostrarMensaje('#vol-message', 'error', t('messages.volunteerPhotoMissing'));
          return;
        }
        const nuevo = {
          id: 'VOL' + String(Date.now()).slice(-4),
          nombre: $('#vol-nombre').value.trim(),
          apellido: $('#vol-apellido').value.trim(),
          telefono: $('#vol-telefono').value.trim(),
          email: $('#vol-email').value.trim(),
          estado: $('#vol-estado').value.trim(),
          ciudad: $('#vol-ciudad').value.trim(),
          profesion: $('#vol-profesion').value,
          disponibilidad: $('#vol-disponibilidad').value.trim(),
          medioTransporte: $('#vol-transporte').value,
          medio_transporte: $('#vol-transporte').value,
          observaciones: $('#vol-observaciones').value.trim(),
          fecha_registro: new Date().toISOString()
        };
        mostrarMensaje('#vol-message', 'info', t('messages.savingVolunteer'));
        try {
          nuevo.fotoCedula = await comprimirFoto(archivoCedula);
          await window.SheetsService.post(Object.assign({ accion: 'registrar_voluntario' }, nuevo));
          await cargarTodo();
          mostrarMensaje('#vol-message', 'success', t('messages.volunteerSaved'));
          limpiarErrores(form);
          form.reset();
        } catch (err) {
          mostrarMensaje('#vol-message', 'error', t('messages.volunteerError'));
        }
      });

      $('#rescatista-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#res-message')) return;
        const nuevo = {
          id: 'RES' + String(Date.now()).slice(-4),
          nombre: $('#res-nombre').value.trim(),
          organizacion: $('#res-organizacion').value.trim(),
          telefono: $('#res-telefono').value.trim(),
          especialidad: $('#res-especialidad').value,
          estado: $('#res-estado').value.trim(),
          ciudad: $('#res-ciudad').value.trim(),
          disponibilidad: $('#res-disponibilidad').value.trim(),
          equipoDisponible: $('#res-equipo').value.trim(),
          equipo_disponible: $('#res-equipo').value.trim(),
          capacidadOperativa: $('#res-capacidad').value,
          capacidad_operativa: $('#res-capacidad').value,
          observaciones: $('#res-observaciones').value.trim(),
          fecha_registro: new Date().toISOString()
        };
        mostrarMensaje('#res-message', 'info', t('messages.savingRescuer'));
        try {
          await window.SheetsService.post(Object.assign({ accion: 'registrar_rescatista' }, nuevo));
          await cargarTodo();
          mostrarMensaje('#res-message', 'success', t('messages.rescuerSaved'));
          limpiarErrores(form);
          form.reset();
        } catch (err) {
          mostrarMensaje('#res-message', 'error', t('messages.rescuerError'));
        }
      });

      $('#familiar-form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!validarFormulario(ev.currentTarget, '#familiar-message')) return;
        buscarFamiliar($('#familiar-query').value);
      });

      $('#persona-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#persona-message')) return;
        mostrarMensaje('#persona-message', 'info', t('family.reportSaving'));
        try {
          await window.SheetsService.post({
            accion: 'reportar_persona',
            nombre: $('#per-nombre').value.trim(),
            cedula: $('#per-cedula').value.trim(),
            estado: $('#per-estado').value,
            ubicacion: $('#per-ubicacion').value.trim(),
            contacto: $('#per-contacto').value.trim(),
            fuente: $('#per-fuente').value.trim()
          });
          mostrarMensaje('#persona-message', 'success', t('family.reportSaved'));
          limpiarErrores(form);
          form.reset();
        } catch (err) {
          mostrarMensaje('#persona-message', 'error', String(err && err.message || t('family.reportError')));
        }
      });

      $('#seguimiento-form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!validarFormulario(ev.currentTarget, '#seguimiento-message')) return;
        buscarSeguimiento($('#seguimiento-token').value);
      });
    }

    async function buscarFamiliar(query) {
      query = (query || '').trim();
      if (!query) return;
      $('#familiar-resultados').innerHTML = `<div class="empty-state">${e(t('family.searching'))}</div>`;
      try {
        const res = await window.SheetsService.getFamiliares(query);
        if (res.source !== 'live') throw res.error || new Error('No se pudo consultar Google Sheets');
        renderFamiliares(res.data || [], (res.data || []).length > 0);
        $('#familiar-message').classList.remove('visible');
      } catch (err) {
        const msg = $('#familiar-message');
        msg.textContent = t('family.errorMessage');
        msg.classList.add('visible');
        renderFamiliares([], false);
      }
    }

    function renderFamiliares(resultados, encontrado) {
      ultimosFamiliares = { resultados, encontrado };
      if (!encontrado || !resultados.length) {
        $('#familiar-resultados').innerHTML = `<div class="empty-state">${e(t('family.notFound'))}</div>`;
        return;
      }
      $('#familiar-resultados').innerHTML = resultados.map((p) => {
        const delicado = normalizar(p.estado).includes('fallec');
        return `<article class="card card-bordered family-card"><div class="badge-row"><span class="badge ${delicado ? 'gray' : 'green'}">${e(mostrarEstadoFamiliar(p.estado))}</span>${p.verificada === false ? `<span class="badge yellow">${e(t('family.unverifiedBadge'))}</span>` : ''}</div><h3>${e(p.nombre)}</h3><div class="meta-grid"><span><strong>${e(t('family.idLabel'))}</strong> ${e(p.cedula)}</span>${p.ubicacion ? `<span><strong>${e(t('family.locationLabel'))}</strong> ${e(mostrarUbicacionFamiliar(p.ubicacion))}</span>` : ''}${p.fuente ? `<span><strong>${e(t('family.sourceLabel'))}</strong> ${e(mostrarFuente(p.fuente))}</span>` : ''}<span><strong>${e(t('family.updatedLabel'))}</strong> ${e(fechaRelativa(p.actualizado))}</span></div>${delicado ? `<p class="meta">${e(t('family.supportLine'))}</p>` : ''}</article>`;
      }).join('');
    }

    function tokenClienteValido(token) {
      return /^DV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizarTokenCliente(token));
    }

    function fechaPublica(iso) {
      if (!iso) return t('common.noDate');
      const fecha = new Date(iso);
      if (Number.isNaN(fecha.getTime())) return String(iso);
      return fecha.toLocaleDateString(localeActual(), { day: '2-digit', month: 'short', year: 'numeric' });
    }

    async function buscarSeguimiento(token, options) {
      const limpio = normalizarTokenCliente(token);
      cambiarVista('seguimiento');
      if ($('#seguimiento-token')) $('#seguimiento-token').value = limpio;
      if (!tokenClienteValido(limpio)) {
        mostrarMensaje('#seguimiento-message', 'error', t('tracking.invalidToken'));
        $('#seguimiento-resultados').innerHTML = '';
        ultimoSeguimiento = null;
        return;
      }

      mostrarMensaje('#seguimiento-message', 'info', t('tracking.searching'));
      $('#seguimiento-resultados').innerHTML = `<div class="empty-state">${e(t('tracking.searching'))}</div>`;
      try {
        const res = await window.SheetsService.getSeguimiento(limpio);
        if (res.source !== 'live' || !res.data || res.data.success === false) {
          throw res.error || new Error(res.data && res.data.error ? res.data.error : 'No se pudo consultar Google Sheets');
        }
        ultimoSeguimiento = res.data;
        renderSeguimiento(res.data);
        $('#seguimiento-message').classList.remove('visible');
        if (!options || options.syncUrl !== false) sincronizarUrlToken(limpio);
      } catch (err) {
        ultimoSeguimiento = null;
        const detalle = String(err && err.message ? err.message : err);
        const mensaje = /no encontrada|not found|404/i.test(detalle) ? t('tracking.notFound') : t('tracking.error');
        mostrarMensaje('#seguimiento-message', 'error', mensaje);
        $('#seguimiento-resultados').innerHTML = `<div class="empty-state">${e(mensaje)}</div>`;
      }
    }

    function renderSeguimiento(data) {
      if (!data || !data.factura) {
        $('#seguimiento-resultados').innerHTML = '';
        return;
      }

      ultimoSeguimiento = data;
      const factura = data.factura;
      // Si la factura es un presupuesto, su descripcion lleva el JSON de la
      // cotización: se pinta legible en vez del JSON crudo.
      let descripcionVisible = factura.descripcion || '';
      try {
        const meta = JSON.parse(descripcionVisible);
        if (meta && meta.k === 'pres') {
          descripcionVisible = t('needs.budgetLine', { cantidad: numero(meta.cantidad), presentacion: meta.presentacion || '', tienda: meta.tienda }) +
            (meta.direccion ? ' · ' + meta.direccion : '') + ' → ' + meta.centro;
        } else if (meta && meta.k === 'oferta') {
          // Vista pública del token: sin teléfono del donante
          descripcionVisible = `${numero(meta.cantidad)} ${mostrarUnidad(meta.unidad)} · ${meta.ubicacion}${meta.centro ? ' → ' + meta.centro : ''}`;
        }
      } catch (err) { /* descripcion normal, se muestra tal cual */ }
      const porcentaje = Math.max(0, Math.min(100, numero(factura.porcentaje_completado != null ? factura.porcentaje_completado : factura.porcentaje)));
      const historial = data.historial || data.movimientos || [];
      const evidencias = data.evidencias || [];
      const estadoClase = normalizar(factura.estado).indexOf('complet') === 0 || normalizar(factura.estado).indexOf('cerrad') === 0 ? 'green' : 'yellow';
      const historialHtml = historial.length ? `<ul class="timeline-list">${historial.map((mov) => `<li class="timeline-item"><div class="supply-line"><strong>${e(mov.tipo || t('tracking.movement'))}</strong><span class="tracking-code">${e(formatearMonto(mov.monto))}</span></div>${mov.descripcion ? `<p class="meta">${e(mov.descripcion)}</p>` : ''}<p class="meta">${e(fechaPublica(mov.fecha))}</p></li>`).join('')}</ul>` : `<div class="empty-state">${e(t('tracking.noHistory'))}</div>`;
      const evidenciasHtml = evidencias.length ? `<div class="evidence-list">${evidencias.map((ev) => {
        const archivo = String(ev.archivo || '').trim();
        const esUrl = /^https?:\/\//i.test(archivo);
        const archivoHtml = esUrl ? `<a href="${e(archivo)}" target="_blank" rel="noopener">${e(t('tracking.openEvidence'))}</a>` : `<strong>${e(archivo || t('tracking.evidenceFile'))}</strong>`;
        return `<div class="evidence-item">${archivoHtml}${ev.descripcion ? `<p class="meta">${e(ev.descripcion)}</p>` : ''}<p class="meta">${e(fechaPublica(ev.fecha))}</p></div>`;
      }).join('')}</div>` : `<div class="empty-state">${e(t('tracking.noEvidence'))}</div>`;

      $('#seguimiento-resultados').innerHTML = `
        <article class="tracking-summary">
          <div class="tracking-head">
            <div>
              <span class="badge ${estadoClase}">${e(factura.estado || t('common.pending'))}</span>
              <h3>${e(factura.objetivo || t('tracking.invoice'))}</h3>
              ${descripcionVisible ? `<p class="meta">${e(descripcionVisible)}</p>` : ''}
            </div>
            <span class="tracking-code">${e(factura.numero_factura || '')}</span>
          </div>
          <div class="tracking-kpis">
            <div class="tracking-kpi"><strong>${e(formatearMonto(factura.monto_requerido))}</strong><span>${e(t('tracking.requiredAmount'))}</span></div>
            <div class="tracking-kpi"><strong>${e(formatearMonto(factura.monto_recaudado))}</strong><span>${e(t('tracking.raisedAmount'))}</span></div>
          </div>
          <div class="tracking-progress">
            <div class="supply-line"><strong>${e(t('tracking.progress'))}</strong><span>${e(porcentaje)}%</span></div>
            <div class="progress" role="progressbar" aria-label="${e(t('tracking.progress'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(porcentaje)}"><span style="--value:${e(porcentaje)}%"></span></div>
          </div>
          <div class="meta-grid">
            <span><strong>${e(t('tracking.tokenLabel'))}</strong> ${e(factura.token_publico || '')}</span>
            <span><strong>${e(t('tracking.created'))}</strong> ${e(fechaPublica(factura.fecha_creacion))}</span>
            <span><strong>${e(t('tracking.closed'))}</strong> ${e(fechaPublica(factura.fecha_cierre))}</span>
            <span><strong>${e(t('tracking.currentStatus'))}</strong> ${e(factura.estado || t('common.pending'))}</span>
          </div>
        </article>
        <div class="tracking-layout">
          <section class="tracking-panel" aria-labelledby="tracking-history-title"><h3 id="tracking-history-title">${e(t('tracking.history'))}</h3>${historialHtml}</section>
          <section class="tracking-panel" aria-labelledby="tracking-evidence-title"><h3 id="tracking-evidence-title">${e(t('tracking.evidence'))}</h3>${evidenciasHtml}</section>
        </div>`;
    }

    async function cargarSeguimientoDesdeUrl() {
      const token = tokenDesdeUrl();
      if (!token) return;
      await buscarSeguimiento(token, { syncUrl: false });
    }

    function bindFiltros() {
      const inputFilters = [
        ['#filtro-lugar-q', 'lugarQ', renderLugares], ['#filtro-necesidad-q', 'necesidadQ', renderNecesidades],
        ['#filtro-vac-q', 'vacQ', renderVacantes], ['#filtro-res-q', 'resQ', renderRescatistas],
        ['#filtro-res-estado', 'resEstado', renderRescatistas], ['#filtro-mot-q', 'motQ', renderMotorizados],
        ['#filtro-donacion-ciudad', 'donacionCiudad', renderDonations]
      ];
      inputFilters.filter(([id]) => $(id)).forEach(([id, key, fn]) => $(id).addEventListener('input', (ev) => { estado.filtros[key] = ev.target.value; fn(); }));
      const selectFilters = [
        ['#filtro-lugar-tipo', 'lugarTipo', renderLugares], ['#filtro-lugar-categoria', 'lugarCategoria', renderLugares],
        ['#filtro-vac-tipo', 'vacTipo', renderVacantes], ['#filtro-vac-urgencia', 'vacUrgencia', renderVacantes],
        ['#filtro-res-especialidad', 'resEspecialidad', renderRescatistas], ['#filtro-mot-tipo', 'motTipo', renderMotorizados],
        ['#filtro-donacion-tipo', 'donacionTipo', renderDonations], ['#filtro-donacion-estado', 'donacionEstado', renderDonations],
        ['#filtro-donacion-urgencia', 'donacionUrgencia', renderDonations]
      ];
      selectFilters.filter(([id]) => $(id)).forEach(([id, key, fn]) => $(id).addEventListener('change', (ev) => { estado.filtros[key] = ev.target.value; fn(); }));
      [['#filtro-donacion-reciente', 'donacionReciente'], ['#filtro-donacion-verificado', 'donacionVerificado']]
        .filter(([id]) => $(id)).forEach(([id, key]) => $(id).addEventListener('change', (ev) => { estado.filtros[key] = ev.target.checked; renderDonations(); }));
      $$('[data-view-link]').forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); window.location.hash = el.dataset.viewLink; }));
      $$('[data-scroll-target]').forEach((el) => el.addEventListener('click', () => document.getElementById(el.dataset.scrollTarget).scrollIntoView({ behavior: 'smooth', block: 'start' })));
      const motorizado = $('#btn-motorizado');
      if (motorizado) motorizado.addEventListener('click', () => { window.location.href = '/registrar-transportista'; });
    }

    function renderAll() {
      renderRegistrySummaries(); poblarCategorias(); renderLugares(); renderNecesidades(); renderVacantes(); renderRescatistas(); renderMotorizados(); renderTraslados(); renderDonations();
      cargarPresupuestos(); cargarComprados(); cargarOfertas(); // asíncronos: pintan sus grillas al llegar
    }

    async function cargarTodo() {
      const result = await window.SheetsService.getAll();
      const data = result.data || {};
      estado.lugares = data.lugares || data.centros || [];
      estado.voluntarios = data.voluntarios || [];
      estado.rescatistas = data.rescatistas || [];
      estado.motorizados = data.motorizados || [];
      estado.traslados = data.traslados || [];
      estado.vacantes = data.vacantes || [];
      estado.donacionesHumanitarias = data.donacionesHumanitarias || data.donaciones_humanitarias || data.donations || [];
      estado.estadisticas = data.estadisticas || data.stats || {};
      setStatus(result.source);
      renderAll();
    }

    async function init() {
      await initI18n();
      bindFiltros();
      bindForms();
      bindAcceso();
      renderDonations();
      [['#btn-panel-centro', '/panel-centro'], ['#btn-acceso-panel', '/panel-centro'],
       ['#btn-crear-centro', '/crear-centro'], ['#btn-acceso-crear-centro', '/crear-centro'],
       ['#btn-acceso-transportista', '/registrar-transportista'], ['#btn-home-admin', '/admin']].forEach(([sel, ruta]) => {
        const btn = $(sel);
        if (btn) btn.addEventListener('click', () => { window.location.href = ruta; });
      });
      const btnTengoInsumo = $('#btn-tengo-insumo');
      if (btnTengoInsumo) btnTengoInsumo.addEventListener('click', () => abrirOfrecerInsumo());
      // Carga directa de /#ofrecer: pintar la página del asistente
      if (/^#ofrecer$/i.test(window.location.hash) && $('#ofrecer-shell')) abrirOfrecerInsumo();
      const btnRescatistaAdmin = $('#btn-rescatista-admin');
      if (btnRescatistaAdmin) btnRescatistaAdmin.addEventListener('click', () => { window.location.href = '/admin'; });
      const btnCerca = $('#btn-cerca');
      if (btnCerca) btnCerca.addEventListener('click', activarCercaDeMi);
      const btnMapaToggle = $('#btn-mapa-toggle');
      if (btnMapaToggle) btnMapaToggle.addEventListener('click', alternarMapa);
      const btnGeoLugar = $('#btn-geo-lugar');
      if (btnGeoLugar) btnGeoLugar.addEventListener('click', () => capturarUbicacion('#lugar-coords'));
      // Mensaje de éxito relevado desde una página-ventana tras volver al inicio.
      try {
        const relayo = window.sessionStorage.getItem('ventana-toast');
        if (relayo) { window.sessionStorage.removeItem('ventana-toast'); toast(relayo); }
      } catch (err) { /* modo privado */ }
      await cargarTodo();
      abrirPanelDesdeUrl();
      await cargarSeguimientoDesdeUrl();
      window.addEventListener('hashchange', () => { abrirPanelDesdeUrl(); cargarSeguimientoDesdeUrl(); });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          const dialog = $('#modal-root dialog');
          if (dialog) dialog.close();
        }
      });
    }

    // Sólo el index arranca la app completa; la página-ventana (sin vistas)
    // tiene su propio arranque en js/ventana.js.
    document.addEventListener('DOMContentLoaded', () => { if (document.querySelector('.view')) init(); });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* origen sin soporte (http plano) */ });
      });
    }
