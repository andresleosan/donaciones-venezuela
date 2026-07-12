// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';
    function establecerModoCentros(modo) {
      window.centrosModoActual = modo === 'donar' ? 'donar' : 'ayuda';
      if (typeof aplicarTraduccionesEstaticas === 'function') aplicarTraduccionesEstaticas();
      if (typeof estado !== 'undefined' && estado.lugares) renderLugares();
    }
    window.establecerModoCentros = establecerModoCentros;

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
      let orden = filtered.slice().sort((a, b) => {
        const fechaA = new Date(a.actualizado || 0).getTime() || 0;
        const fechaB = new Date(b.actualizado || 0).getTime() || 0;
        return fechaB - fechaA;
      });
      if (ubicacionUsuario) {
        orden = filtered.slice().map((l) => ({ l, d: distanciaKm(l) }))
          .sort((a, b) => (a.d == null ? Infinity : a.d) - (b.d == null ? Infinity : b.d))
          .map((x) => x.l);
      }
      $('#conteo-lugares').textContent = t('centers.count', { shown: filtered.length, total: estado.lugares.length });
      const ordenLabel = $('#orden-lugares');
      if (ordenLabel) ordenLabel.textContent = t(ubicacionUsuario ? 'centers.sortedNearby' : 'centers.sortedRecent');
      $('#grid-lugares').innerHTML = orden.length ? orden.map(renderLugarCard).join('') : `<div class="empty-state">${e(t('centers.empty'))}</div>`;
      $$('[data-historial]').forEach((btn) => btn.addEventListener('click', () => irAVentana('historial', { nombre: btn.dataset.historial })));
      bindTarjetasColapsables('#grid-lugares', true);
      actualizarEstadoMapa(filtered);
      renderMapa(filtered);
    }

    // Progressive disclosure: las tarjetas nacen cerradas y se expanden al tocar
    function bindTarjetasColapsables(rootSel, exclusiva) {
      const aplicarEstado = (card, abierto) => {
        if (!card) return;
        card.classList.toggle('open', abierto);
        const toggle = card.querySelector('[data-centro-toggle]');
        if (toggle) {
          toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
          const texto = toggle.querySelector('[data-centro-toggle-text]');
          if (texto) texto.textContent = t(abierto ? 'centers.hideDetails' : 'centers.viewDetails');
        }
        const cuerpo = card.querySelector('.centro-more');
        if (cuerpo) cuerpo.hidden = !abierto;
      };

      $$(rootSel + ' [data-centro-toggle]').forEach((btn) => btn.addEventListener('click', () => {
        const card = btn.closest('[data-centro-card], [data-traslado]');
        if (!card) return;
        const abrir = !card.classList.contains('open');
        if (exclusiva && abrir) {
          $$(rootSel + ' [data-centro-card].open, ' + rootSel + ' [data-traslado].open')
            .forEach((otra) => { if (otra !== card) aplicarEstado(otra, false); });
        }
        aplicarEstado(card, abrir);
      }));
    }

    function alternarMapa() {
      const cont = $('#mapa-centros');
      if (!cont) return;
      const btn = $('#btn-mapa-toggle');
      if (btn && btn.disabled) return;
      cont.hidden = !cont.hidden;
      const vista = $('#view-donaciones');
      if (vista) vista.classList.toggle('map-open', !cont.hidden);
      if (btn) {
        btn.textContent = t(cont.hidden ? 'centers.mapToggle' : 'centers.mapToggleHide');
        btn.setAttribute('aria-expanded', cont.hidden ? 'false' : 'true');
      }
      if (!cont.hidden) renderMapa(lugaresMapaActuales);
    }

    // ── Geo: mapa Leaflet + cerca de mí ──
    let ubicacionUsuario = null;
    let lugaresMapaActuales = [];
    let mapaLeaflet = null;

    function actualizarEstadoMapa(lugares) {
      lugaresMapaActuales = lugares.slice();
      const conUbicacion = lugares.filter((l) => l.lat != null && l.lng != null).length;
      const cobertura = $('#mapa-cobertura');
      if (cobertura) cobertura.textContent = t('centers.mapCoverage', { count: conUbicacion, total: lugares.length });
      const btn = $('#btn-mapa-toggle');
      const cont = $('#mapa-centros');
      if (!btn || !cont) return;
      btn.disabled = conUbicacion === 0;
      if (!conUbicacion) cont.hidden = true;
      const vista = $('#view-donaciones');
      if (vista) vista.classList.toggle('map-open', !cont.hidden && conUbicacion > 0);
      btn.textContent = t(cont.hidden ? 'centers.mapToggle' : 'centers.mapToggleHide');
      btn.setAttribute('aria-expanded', cont.hidden ? 'false' : 'true');
    }

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
      if (cont.hidden) return; // el mapa solo se pinta cuando el usuario lo abre
      const conGeo = lugares.filter((l) => l.lat != null && l.lng != null);
      if (!conGeo.length && !ubicacionUsuario) return;
      if (!mapaLeaflet) {
        mapaLeaflet = window.L.map(cont);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18, attribution: '© OpenStreetMap'
        }).addTo(mapaLeaflet);
      }
      if (mapaLeaflet._capaMarcadores) mapaLeaflet.removeLayer(mapaLeaflet._capaMarcadores);
      if (!conGeo.length && !ubicacionUsuario) {
        mapaLeaflet._capaMarcadores = null;
        return;
      }
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
      const btn = $('#btn-cerca');
      const status = $('#centros-geo-status');
      const mostrarEstado = (key, error) => {
        if (!status) return;
        status.dataset.i18nKey = key;
        status.textContent = t(key);
        status.hidden = !key;
        status.classList.toggle('is-error', !!error);
      };
      if (!navigator.geolocation) {
        mostrarEstado('centers.geoUnavailable', true);
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
      }
      mostrarEstado('centers.locating', false);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          ubicacionUsuario = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (btn) {
            btn.disabled = false;
            btn.setAttribute('aria-busy', 'false');
            btn.focus({ preventScroll: true });
          }
          renderLugares();
          mostrarEstado('centers.nearbyOn', false);
        },
        () => {
          if (btn) {
            btn.disabled = false;
            btn.setAttribute('aria-busy', 'false');
            btn.focus({ preventScroll: true });
          }
          mostrarEstado('centers.geoDenied', true);
        },
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

    // ── Tablero de vacantes: qué voluntarios se necesitan y dónde ──
    // Ordena por urgencia y cupos faltantes: quien quiere ayudar ve primero
    // dónde hace más falta. Los datos llegan de la vista vacantes_public.
    function renderVacantes() {
      const cont = $('#grid-vacantes');
      if (!cont) return;
      const f = estado.filtros;
      const q = normalizar(f.vacQ);
      const peso = { Alta: 0, Normal: 1, Baja: 2 };
      const lista = (estado.vacantes || []).filter((v) => {
        if (q && !normalizar([v.rol, v.lugar_nombre, v.ubicacion, v.descripcion].join(' ')).includes(q)) return false;
        if (f.vacTipo && v.lugar_tipo !== f.vacTipo) return false;
        if (f.vacUrgencia && v.urgencia !== f.vacUrgencia) return false;
        return true;
      }).sort((a, b) => (peso[a.urgencia] ?? 1) - (peso[b.urgencia] ?? 1) || numero(b.cupos_faltantes) - numero(a.cupos_faltantes));

      // KPIs sobre TODAS las vacantes abiertas (no cambian al filtrar)
      const todas = estado.vacantes || [];
      const resumen = $('#vac-resumen');
      if (resumen) {
        resumen.hidden = !todas.length;
        $('#vac-kpi-cupos').textContent = todas.reduce((s2, v) => s2 + numero(v.cupos_faltantes), 0);
        $('#vac-kpi-urgentes').textContent = todas.filter((v) => v.urgencia === 'Alta').length;
        $('#vac-kpi-lugares').textContent = contarUnicos(todas, 'lugar_nombre');
      }

      $('#conteo-vacantes').textContent = todas.length
        ? t('vacancies.count', { shown: lista.length, total: todas.length }) : '';
      if (!lista.length) {
        cont.innerHTML = `<div class="empty-state">${e(t(todas.length ? 'vacancies.noMatch' : 'vacancies.empty'))}</div>`;
        return;
      }
      cont.innerHTML = lista.map((v) => {
        const faltan = numero(v.cupos_faltantes);
        const total = numero(v.cantidad_necesaria);
        const pct = total > 0 ? Math.max(0, Math.min(100, Math.round(100 * numero(v.cantidad_cubierta) / total))) : 0;
        const esDerrumbe = v.lugar_tipo === 'Zona de derrumbe';
        return `<article class="card vac-card${v.urgencia === 'Alta' ? ' vac-alta' : ''}">
          <div class="badge-row">
            <span class="badge ${v.urgencia === 'Alta' ? 'red' : v.urgencia === 'Baja' ? 'gray' : 'yellow'}">${e(mostrarUrgencia(v.urgencia))}</span>
            <span class="badge ${esDerrumbe ? 'rescue' : 'gray'}">${e(tValue('types', v.lugar_tipo) || v.lugar_tipo)}</span>
          </div>
          <h4 class="vac-rol">${e(mostrarProfesion(v.rol))}</h4>
          <p class="vac-lugar"><strong>${e(v.lugar_nombre)}</strong>${v.ubicacion ? ` · ${e(v.ubicacion)}` : ''}</p>
          <div class="vac-cupos">
            <div class="supply-line"><span class="vac-faltan">${e(t('vacancies.slotsMissing', { count: faltan }))}</span><span class="meta">${e(t('vacancies.slotsOf', { covered: numero(v.cantidad_cubierta), total }))}</span></div>
            <div class="progress" role="progressbar" aria-label="${e(t('vacancies.slotsOf', { covered: numero(v.cantidad_cubierta), total }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(pct)}"><span style="--value:${e(pct)}%"></span></div>
          </div>
          ${v.turno ? `<p class="meta"><strong>${e(t('vacancies.shiftLabel'))}</strong> ${e(v.turno)}</p>` : ''}
          ${v.descripcion ? `<p class="meta">${e(v.descripcion)}</p>` : ''}
          <div class="card-actions">
            ${soloDigitos(v.telefono) ? `<a class="btn btn-soft btn-small" target="_blank" rel="noopener" href="${waHref(v.telefono)}">${e(t('common.whatsapp'))}</a>` : ''}
            <button class="btn btn-primary btn-small" type="button" data-vac-postular="${e(v.rol)}">${e(t('vacancies.applyCta'))}</button>
          </div>
        </article>`;
      }).join('');
      // «Me registro»: abre el formulario plegado, pre-llena la profesión si
      // coincide con una opción y lleva el foco al primer campo.
      $$('[data-vac-postular]').forEach((btn) => btn.addEventListener('click', () => {
        const det = $('#vol-registro-details');
        if (!det) return;
        det.open = true;
        const sel = $('#vol-profesion');
        if (sel) {
          const rol = normalizar(btn.dataset.vacPostular);
          const opcion = Array.from(sel.options).find((o) => o.value !== 'Otro' && rol.indexOf(normalizar(o.value)) === 0);
          sel.value = opcion ? opcion.value : 'Otro';
        }
        det.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const nombre = $('#vol-nombre');
        if (nombre) nombre.focus({ preventScroll: true });
      }));
    }

    function renderRescatistas() {
      const count = $('#conteo-rescatistas');
      const grid = $('#grid-rescatistas');
      if (!count || !grid) return;
      const f = estado.filtros;
      const lista = filtrarLista(estado.rescatistas, f.resQ, f.resEstado, f.resEspecialidad, 'especialidad');
      count.textContent = t('rescuers.count', { shown: lista.length, total: estado.rescatistas.length });
      grid.innerHTML = lista.length ? lista.map((r) => personaCard(r, 'rescatista')).join('') : `<div class="empty-state">${e(t('rescuers.empty'))}</div>`;
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
      $$('[data-trayectos]').forEach((btn) => btn.addEventListener('click', () => {
        const m = estado.motorizados.find((x) => String(x.id) === String(btn.dataset.trayectos));
        irAVentana('trayectos', { id: btn.dataset.trayectos, nombre: m ? m.nombre : '' });
      }));
      $$('[data-donar-mot]').forEach((btn) => btn.addEventListener('click', () => {
        const m = estado.motorizados.find((x) => String(x.id) === String(btn.dataset.donarMot));
        irAVentana('apoyar-transportista', { id: btn.dataset.donarMot, nombre: m ? m.nombre : '' });
      }));
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

    // Navega a una página-ventana (antes un modal) con sus parámetros.
    function irAVentana(ruta, params) {
      const q = new URLSearchParams(params || {}).toString();
      window.location.href = '/' + ruta + (q ? '?' + q : '');
    }

    // ── Traslados sugeridos (puerta transportista) ──
    // La vista traslados_sugeridos no expone teléfonos; se resuelven aquí desde
    // estado.lugares (lugares_directorio, que ya es público).
    function telefonoDeLugar(nombre) {
      const lugar = estado.lugares.find((l) => normalizar(l.nombre) === normalizar(nombre));
      return lugar ? lugar.telefono : '';
    }

    function rutaHref(origen, destino) {
      const zona = (q) => encodeURIComponent(/venezuela/i.test(q) ? q : q + ', Venezuela');
      return `https://www.google.com/maps/dir/?api=1&origin=${zona(String(origen || ''))}&destination=${zona(String(destino || ''))}`;
    }

    function renderTraslados() {
      const cont = $('#grid-traslados');
      if (!cont) return;
      const lista = estado.traslados || [];
      if (!lista.length) {
        cont.innerHTML = `<div class="empty-state" data-traslados-vacio>${e(t('transfers.empty'))}</div>`;
        return;
      }
      cont.innerHTML = lista.map((tr) => {
        const telOrigen = telefonoDeLugar(tr.origen);
        const whatsapp = soloDigitos(telOrigen)
          ? `<a class="btn btn-soft btn-small" target="_blank" rel="noopener" href="${waHref(telOrigen)}">${e(t('transfers.coordinate'))}</a>`
          : `<span class="badge gray">${e(t('centers.phonePending'))}</span>`;
        const ruta = tr.origen_ubicacion && tr.destino_ubicacion
          ? `<a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${e(rutaHref(tr.origen_ubicacion, tr.destino_ubicacion))}">${e(t('transfers.route'))}</a>`
          : '';
        return `<article class="card centro-card" data-traslado>
          <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false">
            <span class="centro-resumen">
              <span class="badge-row"><span class="badge ${urgenciaClass(tr.urgencia)}">${e(mostrarUrgencia(tr.urgencia))}</span><span class="badge gray">${e(mostrarCategoria(tr.categoria))}</span></span>
              <span class="centro-nombre">${e(mostrarInsumo(tr.insumo))}</span>
              <span class="meta">${e(tr.origen)} → ${e(tr.destino)}</span>
            </span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="centro-more" hidden>
            <p class="meta">${e(t('transfers.pickup', { lugar: tr.origen, zona: tr.origen_ubicacion || t('centers.locationPending') }))}</p>
            <p class="meta">${e(t('transfers.deliver', { lugar: tr.destino, zona: tr.destino_ubicacion || t('centers.locationPending') }))}</p>
            <div class="card-actions">${whatsapp}${ruta}</div>
          </div>
        </article>`;
      }).join('');
      bindTarjetasColapsables('#grid-traslados');
    }

    // ── Necesidades abiertas (puerta «Donar a una necesidad») ──
    // Aplana los insumos «Necesita» aún no cubiertos de todos los centros y los
    // ordena por urgencia. La necesidad se identifica por centro + insumo, que
    // es lo que la edge function usa como hilo de trazabilidad.
    function necesidadesAbiertas() {
      const q = normalizar(estado.filtros.necesidadQ);
      const lista = [];
      estado.lugares.forEach((lugar) => (lugar.necesita || []).forEach((item) => {
        if (item.yaCubierto) return;
        const texto = normalizar([lugar.nombre, lugar.ubicacion, item.nombre, item.categoria].join(' '));
        if (q && !texto.includes(q)) return;
        lista.push({ lugar, item });
      }));
      return lista.sort((a, b) => (b.item.urgencia === 'Alta') - (a.item.urgencia === 'Alta'));
    }

    function renderNecesidades() {
      const cont = $('#grid-necesidades');
      if (!cont) return;
      const lista = necesidadesAbiertas();
      $('#conteo-necesidades').textContent = t('needs.count', { count: lista.length });
      cont.innerHTML = lista.length ? lista.map(({ lugar, item }) => {
        const unidad = item.unidad || 'unidades';
        const pendiente = Math.max(0, numero(item.cantidadNecesaria) - numero(item.cantidadRecibida));
        return `<article class="card centro-card" data-centro-card data-necesidad-card>
          <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false">
            <span class="centro-resumen">
              <span class="badge-row"><span class="badge ${urgenciaClass(item.urgencia)}">${e(mostrarUrgencia(item.urgencia))}</span><span class="badge gray">${e(mostrarCategoria(item.categoria))}</span></span>
              <span class="centro-nombre">${e(mostrarInsumo(item.nombre))}</span>
              <span class="meta">${e(lugar.nombre)} · ${e(lugar.ubicacion || t('centers.locationPending'))}</span>
            </span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="centro-more" hidden>
            <p class="meta">${e(t('needs.progress', { recibida: numero(item.cantidadRecibida), necesaria: numero(item.cantidadNecesaria), unidad: mostrarUnidad(unidad) }))}</p>
            <p class="meta">${e(t('needs.pending', { count: pendiente, unidad: mostrarUnidad(unidad) }))}</p>
            <div class="card-actions">
              <button class="btn btn-primary btn-small" type="button" data-donar-necesidad
                data-centro="${e(lugar.nombre)}" data-insumo="${e(item.nombre)}"
                data-unidad="${e(unidad)}" data-pendiente="${e(pendiente)}">${e(t('needs.donateCta'))}</button>
            </div>
          </div>
        </article>`;
      }).join('') : `<div class="empty-state">${e(t('needs.empty'))}</div>`;
      bindTarjetasColapsables('#grid-necesidades');
      // «Lo tengo»: la donación en especie ahora se ofrece con cantidad,
      // ubicación y teléfono para que un transportista pueda recogerla.
      $$('[data-donar-necesidad]').forEach((btn) => btn.addEventListener('click', () => abrirOfrecerInsumo(btn.dataset)));
      renderPresupuestos(); // el buscador de esta vista filtra también los presupuestos
    }

    // ── Presupuestos: donación en dinero con ciclo logístico ──
    // Cada presupuesto es una factura-cotización (insumo en una tienda concreta,
    // con precio y dirección). El recaudado llega en vivo desde Supabase; al
    // cubrirse pasa a Comprada y aparece en la lista de recogidas.
    let cargandoPresupuestos = false;
    async function cargarPresupuestos() {
      if (cargandoPresupuestos || !$('#grid-presupuestos')) return;
      cargandoPresupuestos = true;
      try {
        const r = await window.SheetsService.post({ accion: 'listar_presupuestos' });
        estado.presupuestos = r.presupuestos || [];
      } catch (err) { /* se reintenta en la próxima recarga */ }
      cargandoPresupuestos = false;
      renderPresupuestos();
    }

    function estadoPresupuesto(estadoP) {
      const clases = { Abierta: 'yellow', Comprada: 'green', EnTransito: 'rescue', Entregada: 'gray' };
      return { clase: clases[estadoP] || 'gray', texto: tValue('budgetState', estadoP) || estadoP };
    }

    function barraProgreso(recaudado, precio) {
      const pct = precio > 0 ? Math.max(0, Math.min(100, Math.round(100 * recaudado / precio))) : 0;
      return `<div class="tracking-progress"><div class="supply-line"><strong>${e(t('needs.raised', { recaudado: formatearMonto(recaudado), precio: formatearMonto(precio) }))}</strong><span>${e(pct)}%</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(pct)}"><span style="--value:${e(pct)}%"></span></div></div>`;
    }

    function renderPresupuestos() {
      const cont = $('#grid-presupuestos');
      if (!cont) return;
      const q = normalizar(estado.filtros.necesidadQ);
      const lista = (estado.presupuestos || []).filter((pr) => {
        if (!q) return true;
        return normalizar([pr.insumo, pr.centro, pr.tienda, pr.direccion].join(' ')).includes(q);
      });
      if (!lista.length) {
        cont.innerHTML = `<div class="empty-state">${e(t('needs.noBudgets'))}</div>`;
        return;
      }
      cont.innerHTML = lista.map((pr) => {
        const est = estadoPresupuesto(pr.estado);
        const faltan = Math.max(0, numero(pr.precio) - numero(pr.recaudado));
        const accion = pr.estado === 'Abierta'
          ? `<button class="btn btn-primary btn-small" type="button" data-donar-dinero="${e(pr.token)}">${e(t('needs.donateMoneyCta'))}</button>`
          : `<span class="badge ${est.clase}">${e(est.texto)}</span>`;
        return `<article class="card centro-card" data-centro-card data-presupuesto-card>
          <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false">
            <span class="centro-resumen">
              <span class="badge-row"><span class="badge ${est.clase}">${e(est.texto)}</span><span class="badge gray">${e(formatearMonto(pr.precio))}</span></span>
              <span class="centro-nombre">${e(mostrarInsumo(pr.insumo))}</span>
              <span class="meta">${e(t('needs.budgetLine', { cantidad: numero(pr.cantidad), presentacion: pr.presentacion || '', tienda: pr.tienda }))}</span>
            </span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="centro-more" hidden>
            ${barraProgreso(numero(pr.recaudado), numero(pr.precio))}
            <p class="meta">${e(t('needs.missing', { faltan: formatearMonto(faltan) }))}</p>
            <p class="meta"><strong>${e(t('needs.storeLabel'))}</strong> ${e(pr.tienda)}${pr.direccion ? ' · ' + e(pr.direccion) : ''}</p>
            <p class="meta"><strong>${e(t('needs.forCenter'))}</strong> ${e(pr.centro)}</p>
            <div class="card-actions">${accion}</div>
          </div>
        </article>`;
      }).join('');
      bindTarjetasColapsables('#grid-presupuestos');
      $$('[data-donar-dinero]').forEach((btn) => btn.addEventListener('click', () => {
        const pr = (estado.presupuestos || []).find((x) => x.token === btn.dataset.donarDinero);
        if (pr) abrirDonarDinero(pr);
      }));
    }

    // ── Ofertas: donantes que YA TIENEN el insumo, localizadas para recoger ──
    let cargandoOfertas = false;
    async function cargarOfertas() {
      if (cargandoOfertas || !$('#grid-ofertas')) return;
      cargandoOfertas = true;
      try {
        const r = await window.SheetsService.post({ accion: 'listar_ofertas' });
        estado.ofertas = r.ofertas || [];
      } catch (err) { /* se reintenta en la próxima recarga */ }
      cargandoOfertas = false;
      renderOfertas();
    }

    function renderOfertas() {
      const cont = $('#grid-ofertas');
      if (!cont) return;
      const lista = estado.ofertas || [];
      if (!lista.length) {
        cont.innerHTML = `<div class="empty-state">${e(t('offer.empty'))}</div>`;
        return;
      }
      cont.innerHTML = lista.map((of) => `<article class="card centro-card" data-centro-card data-oferta-card>
          <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false">
            <span class="centro-resumen">
              <span class="badge-row"><span class="badge green">${e(t('offer.badge'))}</span><span class="badge gray">${e(numero(of.cantidad))} ${e(mostrarUnidad(of.unidad))}</span></span>
              <span class="centro-nombre">${e(mostrarInsumo(of.insumo))}</span>
              <span class="meta">${e(of.ubicacion)}</span>
            </span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="centro-more" hidden>
            ${of.nombreDonante ? `<p class="meta"><strong>${e(t('offer.contactNameLabel'))}</strong> ${e(of.nombreDonante)}</p>` : ''}
            <p class="meta"><strong>${e(t('offer.whereLabel'))}</strong> ${e(of.ubicacion)}</p>
            ${of.centro ? `<p class="meta"><strong>${e(t('offer.suggestedCenter'))}</strong> ${e(of.centro)}</p>` : ''}
            <div class="card-actions">
              ${soloDigitos(of.telefono) ? `<a class="btn btn-soft btn-small" target="_blank" rel="noopener" href="${waHref(of.telefono)}">${e(t('common.whatsapp'))}</a>` : ''}
              <button class="btn btn-primary btn-small" type="button" data-recoger-oferta="${e(of.token)}">${e(t('offer.pickupCta'))}</button>
            </div>
          </div>
        </article>`).join('');
      bindTarjetasColapsables('#grid-ofertas');
      $$('[data-recoger-oferta]').forEach((btn) => btn.addEventListener('click', () => {
        const of = (estado.ofertas || []).find((x) => x.token === btn.dataset.recogerOferta);
        if (of) abrirRecogerOferta(of);
      }));
    }

    // ── Ciclo del transportista: recoger lo comprado y entregarlo ──
    let cargandoComprados = false;
    async function cargarComprados() {
      if (cargandoComprados || !$('#grid-comprados')) return;
      cargandoComprados = true;
      try {
        const r = await window.SheetsService.post({ accion: 'listar_comprados' });
        estado.comprados = r.comprados || [];
      } catch (err) { /* se reintenta en la próxima recarga */ }
      cargandoComprados = false;
      renderComprados();
    }

    function renderComprados() {
      const cont = $('#grid-comprados');
      if (!cont) return;
      const lista = estado.comprados || [];
      if (!lista.length) {
        cont.innerHTML = `<div class="empty-state">${e(t('cycle.empty'))}</div>`;
        return;
      }
      cont.innerHTML = lista.map((pr) => {
        const est = estadoPresupuesto(pr.estado);
        const boton = pr.estado === 'Comprada'
          ? `<button class="btn btn-primary btn-small" type="button" data-recogida="${e(pr.token)}">${e(t('cycle.pickupCta'))}</button>`
          : `<button class="btn btn-primary btn-small" type="button" data-entrega="${e(pr.token)}">${e(t('cycle.deliverCta'))}</button>`;
        return `<article class="card centro-card" data-centro-card>
          <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false">
            <span class="centro-resumen">
              <span class="badge-row"><span class="badge ${est.clase}">${e(est.texto)}</span></span>
              <span class="centro-nombre">${e(mostrarInsumo(pr.insumo))}</span>
              <span class="meta">${e(pr.tienda)} → ${e(pr.centro)}</span>
            </span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="centro-more" hidden>
            <p class="meta">${e(t('needs.budgetLine', { cantidad: numero(pr.cantidad), presentacion: pr.presentacion || '', tienda: pr.tienda }))}</p>
            <p class="meta"><strong>${e(t('cycle.pickupAt'))}</strong> ${e(pr.tienda)}${pr.direccion ? ' · ' + e(pr.direccion) : ''}</p>
            <p class="meta"><strong>${e(t('cycle.deliverTo'))}</strong> ${e(pr.centro)}</p>
            <div class="card-actions">${boton}</div>
          </div>
        </article>`;
      }).join('');
      bindTarjetasColapsables('#grid-comprados');
      $$('[data-recogida]').forEach((btn) => btn.addEventListener('click', () => {
        const pr = (estado.comprados || []).find((x) => x.token === btn.dataset.recogida);
        if (pr) abrirRegistrarRecogida(pr);
      }));
      $$('[data-entrega]').forEach((btn) => btn.addEventListener('click', () => {
        const pr = (estado.comprados || []).find((x) => x.token === btn.dataset.entrega);
        if (pr) abrirRegistrarEntrega(pr);
      }));
    }

    function abrirModal(titulo, contenido) {
      $('#modal-root').innerHTML = `<dialog><div class="modal-head"><h3>${e(titulo)}</h3><button class="modal-close" type="button" aria-label="${e(t('a11y.close'))}">×</button></div><div class="modal-body">${contenido}</div></dialog>`;
      const dialog = $('#modal-root dialog');
      dialog.querySelector('.modal-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { $('#modal-root').innerHTML = ''; });
      dialog.showModal();
    }
