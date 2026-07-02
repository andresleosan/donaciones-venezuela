// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';
    function renderLugares() {
      const f = estado.filtros;
      const q = normalizar(f.lugarQ);
      const filtered = estado.lugares.filter((l) => {
        const items = (l.necesita || []).concat(l.tiene_disponible || [], l.cubiertos || []);
        const text = normalizar([l.nombre, l.ubicacion, l.tipo, items.map((i) => i.nombre).join(' ')].join(' '));
        if (q && !text.includes(q)) return false;
        if (f.lugarTipo !== 'todos' && normalizar(l.tipo).indexOf(normalizar(f.lugarTipo)) !== 0) return false;
        if (f.lugarCategoria && !items.some((i) => normalizar(i.categoria) === normalizar(f.lugarCategoria))) return false;
        return true;
      });
      let orden = filtered;
      if (ubicacionUsuario) {
        orden = filtered.slice().map((l) => ({ l, d: distanciaKm(l) }))
          .sort((a, b) => (a.d == null ? Infinity : a.d) - (b.d == null ? Infinity : b.d))
          .map((x) => x.l);
      }
      $('#conteo-lugares').textContent = t('centers.count', { shown: filtered.length, total: estado.lugares.length });
      $('#grid-lugares').innerHTML = orden.length ? orden.map(renderLugarCard).join('') : `<div class="empty-state">${e(t('centers.empty'))}</div>`;
      $$('[data-historial]').forEach((btn) => btn.addEventListener('click', () => abrirHistorial(btn.dataset.historial)));
      renderMapa(filtered);
    }

    // ── Geo: mapa Leaflet + cerca de mí ──
    let ubicacionUsuario = null;
    let mapaLeaflet = null;

    function distanciaKm(lugar) {
      if (!ubicacionUsuario || lugar.lat == null || lugar.lng == null) return null;
      const R = 6371, toRad = (x) => x * Math.PI / 180;
      const dLat = toRad(lugar.lat - ubicacionUsuario.lat);
      const dLng = toRad(lugar.lng - ubicacionUsuario.lng);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(ubicacionUsuario.lat)) * Math.cos(toRad(lugar.lat)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function renderMapa(lugares) {
      const cont = $('#mapa-centros');
      if (!cont || typeof window.L === 'undefined') return;
      const conGeo = lugares.filter((l) => l.lat != null && l.lng != null);
      if (!conGeo.length && !ubicacionUsuario) { cont.hidden = true; return; }
      cont.hidden = false;
      if (!mapaLeaflet) {
        mapaLeaflet = window.L.map(cont);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18, attribution: '© OpenStreetMap'
        }).addTo(mapaLeaflet);
      }
      if (mapaLeaflet._capaMarcadores) mapaLeaflet.removeLayer(mapaLeaflet._capaMarcadores);
      const grupo = window.L.layerGroup();
      const puntos = [];
      conGeo.forEach((l) => {
        window.L.marker([l.lat, l.lng]).bindPopup(`<strong>${e(l.nombre)}</strong><br>${e(l.ubicacion || '')}`).addTo(grupo);
        puntos.push([l.lat, l.lng]);
      });
      if (ubicacionUsuario) {
        window.L.circleMarker([ubicacionUsuario.lat, ubicacionUsuario.lng], { radius: 8, color: '#635BFF' })
          .bindPopup(t('centers.youAreHere')).addTo(grupo);
        puntos.push([ubicacionUsuario.lat, ubicacionUsuario.lng]);
      }
      grupo.addTo(mapaLeaflet);
      mapaLeaflet._capaMarcadores = grupo;
      if (puntos.length === 1) mapaLeaflet.setView(puntos[0], 13);
      else if (puntos.length) mapaLeaflet.fitBounds(puntos, { padding: [30, 30] });
      window.setTimeout(() => mapaLeaflet.invalidateSize(), 100);
    }

    function activarCercaDeMi() {
      if (!navigator.geolocation) { toast(t('panel.geoUnavailable')); return; }
      const btn = $('#btn-cerca');
      if (btn) btn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          ubicacionUsuario = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (btn) btn.disabled = false;
          renderLugares();
          toast(t('centers.nearbyOn'));
        },
        () => { if (btn) btn.disabled = false; toast(t('panel.geoDenied')); },
        { timeout: 8000 }
      );
    }

    function personaCard(persona, tipo) {
      const esVoluntario = tipo === 'voluntario';
      const nombre = esVoluntario ? `${persona.nombre || ''} ${persona.apellido || ''}`.trim() : (persona.nombre || t('rescuers.defaultName'));
      const especialidad = esVoluntario ? mostrarProfesion(persona.profesion) : mostrarEspecialidad(persona.especialidad);
      const transporte = persona.medioTransporte || persona.medio_transporte || persona.transporte || '';
      const equipo = persona.equipoDisponible || persona.equipo_disponible || persona.equipo || '';
      const capacidad = persona.capacidadOperativa || persona.capacidad_operativa || persona.capacidad || '';
      const ubicacion = [persona.ciudad, persona.estado].filter(Boolean).join(', ') || t('centers.locationPending');
      const meta = esVoluntario
        ? [[ubicacion, t('common.location')], [persona.disponibilidad ? mostrarEstadoOperativo(persona.disponibilidad) : t('common.pending'), t('common.availability')], [transporte ? mostrarTransporte(transporte) : t('common.pending'), t('volunteers.transport')]]
        : [[ubicacion, t('common.location')], [persona.organizacion || t('rescuers.organizationPending'), t('common.organization')], [capacidad ? mostrarCapacidad(capacidad) : t('rescuers.capacityPending'), t('rescuers.capacity')]];
      const extra = !esVoluntario && equipo ? `<p class="meta"><strong>${e(t('rescuers.equipmentAvailable'))}</strong> ${e(mostrarNota(equipo))}</p>` : '';
      const defaultName = esVoluntario ? t('volunteers.defaultName') : t('rescuers.defaultName');
      return `<article class="card card-bordered person-card ${esVoluntario ? 'volunteer' : 'rescue'}"><div class="card-top"><div><span class="badge ${esVoluntario ? 'green' : 'rescue'}">${e(especialidad || defaultName)}</span><h3>${e(nombre || defaultName)}</h3></div><div class="icon-box ${esVoluntario ? 'green' : 'rescue'}" aria-hidden="true">${esVoluntario ? '✓' : '⚑'}</div></div><div class="meta-grid">${meta.map(([value, label]) => `<span><strong>${e(label)}:</strong> ${e(value)}</span>`).join('')}</div>${extra}${persona.observaciones ? `<p class="meta">${e(mostrarNota(persona.observaciones))}</p>` : ''}<div class="card-actions">${accionesContacto(persona.telefono, nombre)}</div><p class="meta">${e(t('common.registration'))}: ${e(fechaRelativa(persona.fecha_registro))}</p></article>`;
    }

    function filtrarLista(lista, q, estadoFiltro, tipoFiltro, campoTipo) {
      const qn = normalizar(q);
      return lista.filter((item) => {
        const text = normalizar(Object.values(item).join(' '));
        if (qn && !text.includes(qn)) return false;
        if (estadoFiltro && normalizar(item.estado) !== normalizar(estadoFiltro)) return false;
        if (tipoFiltro && normalizar(item[campoTipo]) !== normalizar(tipoFiltro)) return false;
        return true;
      });
    }

    function renderVoluntarios() {
      const f = estado.filtros;
      const lista = filtrarLista(estado.voluntarios, f.volQ, f.volEstado, f.volProfesion, 'profesion');
      $('#conteo-voluntarios').textContent = t('volunteers.count', { shown: lista.length, total: estado.voluntarios.length });
      $('#grid-voluntarios').innerHTML = lista.length ? lista.map((v) => personaCard(v, 'voluntario')).join('') : `<div class="empty-state">${e(t('volunteers.empty'))}</div>`;
    }

    function renderRescatistas() {
      const f = estado.filtros;
      const lista = filtrarLista(estado.rescatistas, f.resQ, f.resEstado, f.resEspecialidad, 'especialidad');
      $('#conteo-rescatistas').textContent = t('rescuers.count', { shown: lista.length, total: estado.rescatistas.length });
      $('#grid-rescatistas').innerHTML = lista.length ? lista.map((r) => personaCard(r, 'rescatista')).join('') : `<div class="empty-state">${e(t('rescuers.empty'))}</div>`;
    }

    function renderMotorizados() {
      const f = estado.filtros;
      const q = normalizar(f.motQ);
      const lista = estado.motorizados.filter((m) => {
        const text = normalizar([m.nombre, m.zonaOperacion, m.operaEn, m.tipoVehiculo, m.placa].join(' '));
        if (q && !text.includes(q)) return false;
        if (f.motTipo && normalizar(m.tipoVehiculo).indexOf(normalizar(f.motTipo)) !== 0) return false;
        return true;
      });
      $('#conteo-motorizados').textContent = t('drivers.count', { shown: lista.length, total: estado.motorizados.length });
      $('#grid-motorizados').innerHTML = lista.length ? lista.map((m) => `<article class="card card-bordered"><div class="card-top"><div><span class="badge">${e(mostrarTransporte(m.tipoVehiculo) || t('drivers.vehicleFallback'))}</span><h3>${e(m.nombre)}</h3></div><div class="icon-box" aria-hidden="true">↗</div></div><p class="meta">${e(m.zonaOperacion || m.operaEn || t('drivers.zonePending'))}${m.placa ? ' · ' + e(t('drivers.plate')) + ' ' + e(m.placa) : ''}</p><div class="badge-row"><span class="badge green">${e(t('drivers.routes', { count: m.totalTrayectos || 0 }))}</span><span class="badge">${e(t('drivers.kilometers', { count: m.totalKm || 0 }))}</span><span class="badge yellow">${e(t('drivers.contribution', { amount: m.aporteDonado || 0 }))}</span></div><div class="card-actions"><button class="btn btn-soft btn-small" data-trayectos="${e(m.id)}" type="button">${e(t('drivers.routesButton'))}</button><button class="btn btn-ghost btn-small" data-donar-mot="${e(m.id)}" type="button">${e(t('drivers.supportButton'))}</button>${m.telefono ? `<a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${waHref(m.telefono)}">${e(t('common.whatsapp'))}</a>` : ''}</div></article>`).join('') : `<div class="empty-state">${e(t('drivers.empty'))}</div>`;
      $$('[data-trayectos]').forEach((btn) => btn.addEventListener('click', () => abrirTrayectos(btn.dataset.trayectos)));
      $$('[data-donar-mot]').forEach((btn) => btn.addEventListener('click', () => abrirDonarMotorizado(btn.dataset.donarMot)));
    }

    function mostrarMensaje(id, tipo, textoMsg) {
      const box = $(id);
      box.className = `form-message visible ${tipo}`;
      box.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
      box.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');
      box.textContent = textoMsg;
    }

    function limpiarErrores(form) {
      form.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
        control.removeAttribute('aria-invalid');
        const errorId = `${control.id}-error`;
        const describedBy = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
        if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
        else control.removeAttribute('aria-describedby');
      });
      form.querySelectorAll('.field-error').forEach((node) => node.remove());
    }

    function nombreCampo(control) {
      const label = control.id ? document.querySelector(`label[for="${control.id}"]`) : null;
      return label ? label.textContent.trim() : t('validation.fieldFallback');
    }

    function marcarError(control, mensaje) {
      const errorId = `${control.id}-error`;
      control.setAttribute('aria-invalid', 'true');
      const describedBy = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      describedBy.add(errorId);
      control.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
      const error = document.createElement('p');
      error.id = errorId;
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      error.textContent = mensaje;
      control.insertAdjacentElement('afterend', error);
    }

    function validarFormulario(form, messageId) {
      limpiarErrores(form);
      const errores = [];
      form.querySelectorAll('input, select, textarea').forEach((control) => {
        const valor = String(control.value || '').trim();
        if (control.hasAttribute('required') && !valor) {
          errores.push([control, t('validation.required', { field: nombreCampo(control) })]);
          return;
        }
        if (control.type === 'tel' && valor && soloDigitos(valor).length < 7) {
          errores.push([control, t('validation.phone')]);
        }
      });
      if (!errores.length) return true;
      errores.forEach(([control, mensaje]) => marcarError(control, mensaje));
      mostrarMensaje(messageId, 'error', t('validation.reviewFields', { count: errores.length, plural: errores.length > 1 ? 's' : '' }));
      errores[0][0].focus();
      return false;
    }

    function toast(msg) {
      $('#toast-root').innerHTML = `<div class="toast" role="status">${e(msg)}</div>`;
      setTimeout(() => { $('#toast-root').innerHTML = ''; }, 3400);
    }

    function abrirModal(titulo, contenido) {
      $('#modal-root').innerHTML = `<dialog><div class="modal-head"><h3>${e(titulo)}</h3><button class="modal-close" type="button" aria-label="${e(t('a11y.close'))}">×</button></div><div class="modal-body">${contenido}</div></dialog>`;
      const dialog = $('#modal-root dialog');
      dialog.querySelector('.modal-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { $('#modal-root').innerHTML = ''; });
      dialog.showModal();
    }

