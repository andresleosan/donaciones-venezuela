// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';
    // ===== Módulo admin de trazabilidad (#admin) =====
    let facturaActiva = null;

    function claveAdmin() { return window.sessionStorage.getItem('adminKey') || ''; }

    async function postAdmin(payload) {
      return window.SheetsService.post(Object.assign({ adminKey: claveAdmin() }, payload));
    }

    function abrirAdmin() {
      facturaActiva = null;
      abrirModal(t('admin.title'), `
        <form id="admin-auth-form">
          <p class="meta">${e(t('admin.intro'))}</p>
          <div class="form-grid">
            <div class="field full"><label for="admin-key">${e(t('admin.keyLabel'))}</label><input id="admin-key" type="password" autocomplete="off" value="${e(claveAdmin())}" /></div>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('admin.enter'))}</button></div>
          <div id="admin-msg" class="form-message"></div>
        </form>
        <div id="admin-body"></div>`);
      $('#admin-auth-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        window.sessionStorage.setItem('adminKey', $('#admin-key').value.trim());
        mensajeAdmin('#admin-msg', 'info', t('admin.checking'));
        try {
          const data = await postAdmin({ accion: 'admin_listar_facturas' });
          $('#admin-auth-form').hidden = true;
          renderAdmin(data.facturas || []);
        } catch (err) {
          window.sessionStorage.removeItem('adminKey');
          mensajeAdmin('#admin-msg', 'error', String(err && err.message || t('admin.authError')));
        }
      });
    }

    function mensajeAdmin(sel, tipo, texto) {
      const el = $(sel);
      if (!el) return;
      el.className = `form-message visible ${tipo}`;
      el.textContent = texto;
    }

    async function refrescarAdmin(avisoHTML) {
      try {
        const data = await postAdmin({ accion: 'admin_listar_facturas' });
        renderAdmin(data.facturas || [], avisoHTML);
      } catch (err) {
        mensajeAdmin('#admin-msg2', 'error', String(err && err.message || ''));
      }
    }

    async function renderAdmin(facturas, avisoHTML) {
      let personas = [];
      try {
        personas = (await postAdmin({ accion: 'admin_listar_personas' })).personas || [];
      } catch (err) { /* la lista de personas no bloquea el módulo */ }
      const filaFactura = (f) => `
        <div class="supply-item"><div class="supply-line">
          <strong>${e(f.numero_factura)}</strong>
          <span class="badge ${f.estado === 'Cerrada' ? 'gray' : 'green'}">${e(f.estado)}</span></div>
          <p class="meta">${e(f.objetivo)} · ${e(String(f.monto_recaudado))} / ${e(String(f.monto_requerido))}</p>
          <p class="meta tracking-code">${e(f.token_publico)}</p>
          <div class="inline-actions">
            <button class="btn btn-soft btn-small" type="button" data-admin-usar="${e(f.token_publico)}">${e(t('admin.useInvoice'))}</button>
          </div>
        </div>`;
      const filaPersona = (p) => `
        <div class="supply-item"><div class="supply-line"><strong>${e(p.nombre)}</strong><span class="badge yellow">${e(t('family.unverifiedBadge'))}</span></div>
          <p class="meta">${e(p.cedula || '')} · ${e(p.estado || '')} · ${e(p.ubicacion || '')} · ${e(p.fuente || '')}</p>
          <div class="inline-actions"><button class="btn btn-soft btn-small" type="button" data-admin-verificar="${e(String(p.id))}">${e(t('admin.verify'))}</button></div>
        </div>`;
      $('#admin-body').innerHTML = `
        <div id="admin-msg2" class="form-message"></div>
        ${avisoHTML || ''}
        <h3>${e(t('admin.createInvoice'))}</h3>
        <div class="panel-insumo">
          <div class="form-grid">
            <div class="field"><label>${e(t('admin.objective'))}</label><input id="adm-objetivo" /></div>
            <div class="field"><label>${e(t('admin.description'))}</label><input id="adm-descripcion" /></div>
            <div class="field"><label>${e(t('admin.requiredAmount'))}</label><input id="adm-monto" type="number" min="1" /></div>
          </div>
          <div class="inline-actions"><button class="btn btn-primary btn-small" type="button" id="adm-crear">${e(t('admin.create'))}</button></div>
        </div>
        <h3>${e(t('admin.invoices'))} (${facturas.length})</h3>
        ${facturas.map(filaFactura).join('') || `<p class="meta">${e(t('admin.noInvoices'))}</p>`}
        <div id="admin-factura-ops" hidden>
          <h3>${e(t('admin.opsOn'))} <span id="adm-factura-sel" class="tracking-code"></span></h3>
          <div class="panel-insumo">
            <p class="meta"><strong>${e(t('admin.donation'))}</strong></p>
            <div class="form-grid">
              <div class="field"><label>${e(t('admin.donor'))}</label><input id="adm-don-nombre" /></div>
              <div class="field"><label>${e(t('admin.amount'))}</label><input id="adm-don-monto" type="number" min="1" /></div>
              <div class="field"><label>${e(t('admin.reference'))}</label><input id="adm-don-ref" /></div>
              <div class="field"><label>${e(t('admin.status'))}</label><select id="adm-don-estado"><option value="Registrada">${e(t('admin.stateRegistered'))}</option><option value="Confirmada">${e(t('admin.stateConfirmed'))}</option></select></div>
            </div>
            <div class="inline-actions"><button class="btn btn-soft btn-small" type="button" id="adm-don-guardar">${e(t('admin.saveDonation'))}</button></div>
          </div>
          <div class="panel-insumo">
            <p class="meta"><strong>${e(t('admin.movement'))}</strong></p>
            <div class="form-grid">
              <div class="field"><label>${e(t('admin.type'))}</label><select id="adm-mov-tipo"><option>Ingreso</option><option>Egreso</option><option>Compra</option><option>Entrega</option></select></div>
              <div class="field"><label>${e(t('admin.description'))}</label><input id="adm-mov-desc" /></div>
              <div class="field"><label>${e(t('admin.amount'))}</label><input id="adm-mov-monto" type="number" min="0" /></div>
            </div>
            <div class="inline-actions"><button class="btn btn-soft btn-small" type="button" id="adm-mov-guardar">${e(t('admin.saveMovement'))}</button></div>
          </div>
          <div class="panel-insumo">
            <p class="meta"><strong>${e(t('admin.evidence'))}</strong></p>
            <div class="form-grid">
              <div class="field"><label>URL (https)</label><input id="adm-evi-url" placeholder="https://…" /></div>
              <div class="field"><label>${e(t('admin.description'))}</label><input id="adm-evi-desc" /></div>
            </div>
            <div class="inline-actions">
              <button class="btn btn-soft btn-small" type="button" id="adm-evi-guardar">${e(t('admin.saveEvidence'))}</button>
              <button class="btn btn-ghost btn-small" type="button" id="adm-cerrar-factura">${e(t('admin.closeInvoice'))}</button>
            </div>
          </div>
        </div>
        <h3>${e(t('admin.pendingPeople'))} (${personas.length})</h3>
        ${personas.map(filaPersona).join('') || `<p class="meta">${e(t('admin.noPendingPeople'))}</p>`}
        <h3>${e(t('admin.regeneratePanel'))}</h3>
        <div class="panel-insumo">
          <div class="form-grid">
            <div class="field"><label>${e(t('admin.centerName'))}</label><input id="adm-regen-nombre" /></div>
          </div>
          <div class="inline-actions"><button class="btn btn-soft btn-small" type="button" id="adm-regen">${e(t('admin.regenerate'))}</button></div>
          <div id="adm-regen-out"></div>
        </div>
        <div class="form-actions"><button class="btn btn-ghost btn-small" type="button" id="adm-salir">${e(t('admin.signOut'))}</button></div>`;

      $('#adm-crear').addEventListener('click', async () => {
        try {
          const r = await postAdmin({ accion: 'admin_crear_factura', objetivo: $('#adm-objetivo').value.trim(),
            descripcion: $('#adm-descripcion').value.trim(), montoRequerido: $('#adm-monto').value });
          const aviso = `<div class="notice success visible">${e(t('admin.invoiceCreated'))}</div><p class="tracking-code">${e(r.numeroFactura)} · ${e(r.token)}</p><p class="meta">${e(t('admin.tokenHint'))}</p>`;
          await refrescarAdmin(aviso);
          // Auto-seleccionar la factura recién creada para operarla ya (evita la
          // carrera read-after-write del listado tras el insert).
          facturaActiva = r.token;
          $('#admin-factura-ops').hidden = false;
          $('#adm-factura-sel').textContent = r.numeroFactura + ' · ' + r.token;
        } catch (err) { mensajeAdmin('#admin-msg2', 'error', String(err && err.message || '')); }
      });
      $$('#admin-body [data-admin-usar]').forEach((btn) => btn.addEventListener('click', () => {
        facturaActiva = btn.dataset.adminUsar;
        $('#admin-factura-ops').hidden = false;
        $('#adm-factura-sel').textContent = facturaActiva;
        $('#admin-factura-ops').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      $$('#admin-body [data-admin-verificar]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await postAdmin({ accion: 'admin_verificar_persona', id: btn.dataset.adminVerificar });
          await refrescarAdmin();
        } catch (err) { mensajeAdmin('#admin-msg2', 'error', String(err && err.message || '')); }
      }));
      const conFactura = (fn) => async () => {
        if (!facturaActiva) { mensajeAdmin('#admin-msg2', 'error', t('admin.pickInvoice')); return; }
        try { await fn(); mensajeAdmin('#admin-msg2', 'success', t('panel.saved')); await refrescarAdmin(); }
        catch (err) { mensajeAdmin('#admin-msg2', 'error', String(err && err.message || '')); }
      };
      $('#adm-don-guardar').addEventListener('click', conFactura(() => postAdmin({
        accion: 'admin_registrar_donacion', token: facturaActiva,
        nombreDonante: $('#adm-don-nombre').value.trim(), monto: $('#adm-don-monto').value,
        referencia: $('#adm-don-ref').value.trim(), estado: $('#adm-don-estado').value })));
      $('#adm-mov-guardar').addEventListener('click', conFactura(() => postAdmin({
        accion: 'admin_registrar_movimiento', token: facturaActiva,
        tipo: $('#adm-mov-tipo').value, descripcion: $('#adm-mov-desc').value.trim(), monto: $('#adm-mov-monto').value })));
      $('#adm-evi-guardar').addEventListener('click', conFactura(() => postAdmin({
        accion: 'admin_registrar_evidencia', token: facturaActiva,
        archivo: $('#adm-evi-url').value.trim(), descripcion: $('#adm-evi-desc').value.trim() })));
      $('#adm-cerrar-factura').addEventListener('click', conFactura(() => postAdmin({
        accion: 'admin_cerrar_factura', token: facturaActiva })));
      $('#adm-regen').addEventListener('click', async () => {
        try {
          const r = await postAdmin({ accion: 'admin_regenerar_panel', nombre: $('#adm-regen-nombre').value.trim() });
          $('#adm-regen-out').innerHTML = `<div class="notice success visible">${e(t('admin.panelRegenerated'))}</div><p class="tracking-code">${e(r.token)} · PIN ${e(r.pin)}</p><p class="meta">${e(t('admin.tokenHint'))}</p>`;
        } catch (err) { mensajeAdmin('#admin-msg2', 'error', String(err && err.message || '')); }
      });
      $('#adm-salir').addEventListener('click', () => {
        window.sessionStorage.removeItem('adminKey');
        facturaActiva = null;
        const dialog = $('#modal-root dialog');
        if (dialog) dialog.close();
      });
      // Preservar la factura en operación tras cada re-render
      if (facturaActiva && facturas.some((f) => f.token_publico === facturaActiva)) {
        const f = facturas.find((x) => x.token_publico === facturaActiva);
        $('#admin-factura-ops').hidden = false;
        $('#adm-factura-sel').textContent = f.numero_factura + ' · ' + f.token_publico;
      }
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
      $('#donar-mot-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const monto = numero($('#don-monto').value);
        await window.SheetsService.post({ accion: 'donar_motorizado', idMotorizado: mot.id, nombreMotorizado: mot.nombre, monto, tipo: $('#don-tipo').value, donanteName: $('#don-nombre').value.trim() || 'Anónimo', ciudad: $('#don-ciudad').value.trim() });
        await cargarTodo();
        $('#modal-root dialog').close();
        toast(t('messages.supportSaved'));
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

    function abrirRegistrarMotorizado() {
      abrirModal(t('modal.driverTitle'), `<form id="mot-form"><div class="form-grid"><div class="field"><label for="mot-nombre">${e(t('common.name'))}</label><input id="mot-nombre" required /></div><div class="field"><label for="mot-tipo">${e(t('common.vehicle'))}</label><select id="mot-tipo"><option value="Moto">${e(mostrarTransporte('Moto'))}</option><option value="Carro">${e(mostrarTransporte('Carro'))}</option><option value="Bicicleta">${e(mostrarTransporte('Bicicleta'))}</option><option value="Camión">${e(mostrarTransporte('Camión'))}</option><option value="Motocarro">${e(mostrarTransporte('Motocarro'))}</option></select></div><div class="field"><label for="mot-telefono">${e(t('common.phone'))}</label><input id="mot-telefono" type="tel" /></div><div class="field"><label for="mot-zona">${e(t('modal.zone'))}</label><input id="mot-zona" required /></div><div class="field"><label for="mot-placa">${e(t('modal.plate'))}</label><input id="mot-placa" /></div></div><p class="meta">${e(t('modal.photosIntro'))}</p><div class="form-grid">${campoFoto('mot-foto-placa', 'modal.photoPlate')}${campoFoto('mot-foto-vehiculo', 'modal.photoVehicle')}${campoFoto('mot-foto-cedula', 'modal.photoId')}</div><div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('modal.saveDriver'))}</button></div><div id="mot-message" class="form-message" role="status" aria-live="polite"></div></form>`);
      ['mot-foto-placa', 'mot-foto-vehiculo', 'mot-foto-cedula'].forEach((id) => {
        $('#' + id).addEventListener('change', (ev) => {
          const file = ev.target.files && ev.target.files[0];
          const prev = $('#' + id + '-prev');
          if (!file) { prev.hidden = true; return; }
          prev.src = URL.createObjectURL(file);
          prev.hidden = false;
        });
      });
      $('#mot-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const archivos = ['mot-foto-placa', 'mot-foto-vehiculo', 'mot-foto-cedula']
          .map((id) => $('#' + id).files && $('#' + id).files[0]);
        if (archivos.some((f) => !f)) {
          mostrarMensaje('#mot-message', 'error', t('messages.driverPhotosMissing'));
          return;
        }
        const boton = ev.currentTarget.querySelector('button[type="submit"]');
        boton.disabled = true;
        mostrarMensaje('#mot-message', 'info', t('messages.driverUploading'));
        try {
          const [fotoPlaca, fotoVehiculo, fotoCedula] = await Promise.all(archivos.map(comprimirFoto));
          const nuevo = { nombre: $('#mot-nombre').value.trim(), tipoVehiculo: $('#mot-tipo').value, telefono: $('#mot-telefono').value.trim(), zonaOperacion: $('#mot-zona').value.trim(), operaEn: $('#mot-zona').value.trim(), placa: $('#mot-placa').value.trim(), fotoPlaca, fotoVehiculo, fotoCedula };
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

    function bindForms() {
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

      $('#voluntario-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#vol-message')) return;
        const nuevo = {
          id: 'VOL' + String(Date.now()).slice(-4),
          nombre: $('#vol-nombre').value.trim(),
          apellido: $('#vol-apellido').value.trim(),
          telefono: $('#vol-telefono').value.trim(),
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
              ${factura.descripcion ? `<p class="meta">${e(factura.descripcion)}</p>` : ''}
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
      [['#filtro-lugar-q', 'lugarQ', renderLugares], ['#filtro-vol-q', 'volQ', renderVoluntarios], ['#filtro-vol-estado', 'volEstado', renderVoluntarios], ['#filtro-res-q', 'resQ', renderRescatistas], ['#filtro-res-estado', 'resEstado', renderRescatistas], ['#filtro-mot-q', 'motQ', renderMotorizados], ['#filtro-donacion-ciudad', 'donacionCiudad', renderDonations]].forEach(([id, key, fn]) => $(id).addEventListener('input', (ev) => { estado.filtros[key] = ev.target.value; fn(); }));
      [['#filtro-lugar-tipo', 'lugarTipo', renderLugares], ['#filtro-lugar-categoria', 'lugarCategoria', renderLugares], ['#filtro-vol-profesion', 'volProfesion', renderVoluntarios], ['#filtro-res-especialidad', 'resEspecialidad', renderRescatistas], ['#filtro-mot-tipo', 'motTipo', renderMotorizados], ['#filtro-donacion-tipo', 'donacionTipo', renderDonations], ['#filtro-donacion-estado', 'donacionEstado', renderDonations], ['#filtro-donacion-urgencia', 'donacionUrgencia', renderDonations]].forEach(([id, key, fn]) => $(id).addEventListener('change', (ev) => { estado.filtros[key] = ev.target.value; fn(); }));
      [['#filtro-donacion-reciente', 'donacionReciente'], ['#filtro-donacion-verificado', 'donacionVerificado']].forEach(([id, key]) => $(id).addEventListener('change', (ev) => { estado.filtros[key] = ev.target.checked; renderDonations(); }));
      $$('[data-view-link]').forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); window.location.hash = el.dataset.viewLink; }));
      $$('[data-scroll-target]').forEach((el) => el.addEventListener('click', () => document.getElementById(el.dataset.scrollTarget).scrollIntoView({ behavior: 'smooth', block: 'start' })));
      $('#btn-motorizado').addEventListener('click', () => { window.location.href = '/registrar-transportista'; });
    }

    function renderAll() {
      renderRegistrySummaries(); poblarCategorias(); renderLugares(); renderVoluntarios(); renderRescatistas(); renderMotorizados(); renderTraslados(); renderDonations();
    }

    async function cargarTodo() {
      const result = await window.SheetsService.getAll();
      const data = result.data || {};
      estado.lugares = data.lugares || data.centros || [];
      estado.voluntarios = data.voluntarios || [];
      estado.rescatistas = data.rescatistas || [];
      estado.motorizados = data.motorizados || [];
      estado.traslados = data.traslados || [];
      estado.donacionesHumanitarias = data.donacionesHumanitarias || data.donaciones_humanitarias || data.donations || [];
      estado.estadisticas = data.estadisticas || data.stats || {};
      setStatus(result.source);
      renderAll();
    }

    async function init() {
      await initI18n();
      bindFiltros();
      bindForms();
      renderDonations();
      const btnPanel = $('#btn-panel-centro');
      if (btnPanel) btnPanel.addEventListener('click', () => { window.location.href = '/panel-centro'; });
      const btnCrearCentro = $('#btn-crear-centro');
      if (btnCrearCentro) btnCrearCentro.addEventListener('click', () => { window.location.href = '/crear-centro'; });
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

