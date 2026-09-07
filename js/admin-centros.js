// Consola de datos del admin — pantallas de centros.
// Centros de acopio, sus insumos, sus accesos de panel y las vacantes de voluntariado.
// Usa dvpFila/dvpUnidos de admin-personas.js y la fontanería de admin-datos.js.
'use strict';

    // ---- Centros de acopio ----
    // Un centro arrastra en CASCADE sus insumos y su acceso al panel; el aviso de
    // borrado lo calcula el servidor y lo enseña dvBorrar antes de confirmar.
    let dvcConPanel = null; // Set de lugar_id que ya tienen acceso de panel

    async function dvcCargarPaneles() {
      if (dvcConPanel) return dvcConPanel;
      const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'centros_panel', porPagina: 100 });
      dvcConPanel = new Set((r.filas || []).map((c) => String(c.lugar_id)));
      return dvcConPanel;
    }

    // La configuración de insumos se devuelve desde una función (no una constante)
    // para que t() se evalúe en el idioma actual, y porque se usa desde DOS sitios:
    // su propia pantalla y la lista anidada dentro de la ficha de un centro.
    function dvcCfgInsumos() {
      return {
        entidad: 'insumos', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titleSupplies'),
        fila: (i) => dvpFila(
          i.nombre || '',
          dvpUnidos([i.categoria, i.unidad,
                     dvTexto('coverage', { cubierta: i.cantidad_recibida, necesaria: i.cantidad_necesaria })]),
          `<span class="badge ${i.urgencia === 'Alta' ? 'red' : 'gray'}">${e(String(i.urgencia || ''))}</span>`),
        campos: [
          { id: 'lugar_id', etiqueta: dvTexto('fCenter'), tipo: 'ref' },
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'categoria', etiqueta: dvTexto('fCategory'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'opcion',
            opciones: ['Necesita', 'Disponible', 'Cubierto'] },
          { id: 'cantidad_necesaria', etiqueta: dvTexto('fNeeded'), tipo: 'numero' },
          { id: 'cantidad_recibida', etiqueta: dvTexto('fReceived'), tipo: 'numero' },
          { id: 'urgencia', etiqueta: dvTexto('fUrgency'), tipo: 'opcion',
            opciones: ['Alta', 'Normal', 'Baja'] },
          { id: 'unidad', etiqueta: dvTexto('fUnit'), tipo: 'texto' },
        ],
      };
    }

    function dvcCfgLugares() {
      return {
        entidad: 'lugares', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titlePlaces'),
        fila: (l) => dvpFila(
          l.nombre || '',
          dvpUnidos([l.tipo, l.ubicacion, l.telefono]),
          (dvcConPanel && dvcConPanel.has(String(l.id)))
            ? `<span class="badge green">${e(dvTexto('managed'))}</span>`
            : `<span class="badge gray">${e(dvTexto('notManaged'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'tipo', etiqueta: dvTexto('fType'), tipo: 'opcion',
            opciones: ['Centro', 'Hospital', 'Refugio'] },
          { id: 'ubicacion', etiqueta: dvTexto('fAddress'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'lat', etiqueta: dvTexto('fLat'), tipo: 'coord' },
          { id: 'lng', etiqueta: dvTexto('fLng'), tipo: 'coord' },
        ],
        // El mapa y los insumos anidados son lo que distingue esta ficha de un
        // formulario cualquiera: el centro se ve donde está y qué está pidiendo.
        extras: () => `
          <div id="dvc-mapa" class="of-mapa" style="height:240px"></div>
          <p class="meta" id="dvc-mapa-info"></p>
          <div id="dvc-insumos" class="admin-records"></div>`,
        alPintar: (l, id) => { dvcMapaCentro(l); if (id) dvcInsumosDe(id); },
      };
    }

    DV_DATOS_PANELES.lugares = {
      icono: '🏥',
      titulo: () => dvTexto('titlePlaces'),
      abrir: async () => { await dvcCargarPaneles(); dvDatosLista(dvcCfgLugares()); },
    };

    // Un clic en el mapa clava el punto y rellena los dos recuadros de coordenadas:
    // teclear latitud y longitud a mano es donde más se equivoca cualquiera.
    // Mismo patrón de Leaflet que ya usa el asistente de presupuestos (admin.js).
    function dvcMapaCentro(l) {
      if (!window.L || !$('#dvc-mapa')) return;
      const tienePunto = l.lat != null && l.lng != null;
      const inicio = tienePunto ? [Number(l.lat), Number(l.lng)] : [10.4806, -66.9036];
      const mapa = L.map('dvc-mapa').setView(inicio, tienePunto ? 15 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
      let marcador = tienePunto ? L.marker(inicio).addTo(mapa) : null;
      mapa.on('click', (ev) => {
        const lat = ev.latlng.lat, lng = ev.latlng.lng;
        if (marcador) marcador.setLatLng(ev.latlng); else marcador = L.marker(ev.latlng).addTo(mapa);
        $('#dvc-lat').value = lat.toFixed(6);
        $('#dvc-lng').value = lng.toFixed(6);
        $('#dvc-mapa-info').textContent = dvTexto('mapSet', { lat: lat.toFixed(5), lng: lng.toFixed(5) });
      });
      setTimeout(() => mapa.invalidateSize(), 80);
    }

    // Los insumos del centro, ahí mismo: el admin ve qué pide sin salir de la ficha,
    // y cada uno abre su propia ficha para corregirlo.
    async function dvcInsumosDe(lugarId) {
      const caja = $('#dvc-insumos');
      if (!caja) return;
      let filas = [];
      try {
        const r = await postAdmin({ accion: 'admin_datos_listar', entidad: 'insumos', porPagina: 100 });
        filas = (r.filas || []).filter((i) => String(i.lugar_id) === String(lugarId));
      } catch (err) { return; }
      caja.innerHTML = `<h4>${e(dvTexto('titleSupplies'))}</h4>` + (filas.map((i) => `
        <button class="admin-record" type="button" data-ins-id="${e(String(i.id))}">
          <span class="admin-record-main"><strong>${e(i.nombre)}</strong>
            <span class="meta">${e(dvTexto('coverage', { cubierta: i.cantidad_recibida, necesaria: i.cantidad_necesaria }))} ${e(i.unidad || '')}</span></span>
          <span class="admin-record-side"><span class="badge ${i.urgencia === 'Alta' ? 'red' : 'gray'}">${e(String(i.urgencia || ''))}</span></span>
        </button>`).join('') || `<p class="empty-state">${e(dvTexto('empty'))}</p>`);
      $$('#dvc-insumos [data-ins-id]').forEach((b) =>
        b.addEventListener('click', () => dvDatosFicha(dvcCfgInsumos(), b.dataset.insId)));
    }

    // ---- Insumos ----
    DV_DATOS_PANELES.insumos = {
      icono: '📦',
      titulo: () => dvTexto('titleSupplies'),
      abrir: () => dvDatosLista(dvcCfgInsumos()),
    };

    // ---- Accesos de centro ----
    // Aquí NO se edita la credencial: el token y el PIN no son editables ni siquiera
    // por el admin. Se REGENERAN con la acción que ya existía, o se REVOCAN borrando
    // la fila. Lo único editable es el correo al que se asoció el acceso.
    DV_DATOS_PANELES.centros_panel = {
      icono: '🔑',
      titulo: () => dvTexto('titleAccess'),
      abrir: () => dvDatosLista({
        entidad: 'centros_panel', pk: 'id', etiqueta: 'email',
        titulo: dvTexto('titleAccess'),
        fila: (c) => dvpFila(
          c.token_centro || '',
          dvpUnidos([dvTexto('accessOf', { id: c.lugar_id }), c.email, fechaRelativa(c.creado)]),
          `<span class="badge green">${e(dvTexto('managed'))}</span>`),
        campos: [
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
        ],
        // El botón de regenerar vive en la ficha, junto al acceso que va a cambiar.
        extras: (c) => c.id ? `
          <div class="card-actions">
            <button class="btn btn-soft btn-small" type="button" id="acc-regen"
                    data-lugar="${e(String(c.lugar_id || ''))}">${e(dvTexto('accessRegen'))}</button>
          </div>
          <div id="acc-regen-out"></div>` : '',
        alPintar: async (fila, id) => {
          const boton = $('#acc-regen');
          if (!boton || !id) return;
          boton.addEventListener('click', async () => {
            boton.disabled = true;
            try {
              // admin_regenerar_panel identifica el centro por NOMBRE, no por id,
              // y ahora necesita ademas el correo de quien lo administrara.
              const centros = await dvCentros();
              const centro = centros.find((c) => String(c.id) === String(fila.lugar_id));
              if (!centro) throw new Error(dvTexto('empty'));
              const correo = String(fila.email || '').trim();
              if (!correo) throw new Error(t('admin.regenEmail'));
              const r = await postAdmin({ accion: 'admin_regenerar_panel', nombre: centro.nombre, email: correo });
              $('#acc-regen-out').innerHTML = `<div class="recibo"><div class="recibo-row"><span class="meta">${e(t('access.centerTitle'))}</span><span class="token-value"><strong>${e(r.nombre)}</strong></span></div><div class="recibo-row"><span class="meta">${e(t('common.email'))}</span><span class="token-value"><strong>${e(r.email)}</strong></span></div><p class="meta">${e(t('admin.panelRegenerated'))}</p></div>`;
              toast(dvTexto('accessRegenDone'));
            } catch (err) {
              boton.disabled = false;
              mensajeAdmin('#gest-msg', 'error', String((err && err.message) || ''));
            }
          });
        },
      }),
    };

    // ---- Vacantes de voluntariado ----
    DV_DATOS_PANELES.vacantes_voluntarios = {
      icono: '📋',
      titulo: () => dvTexto('titleVacancies'),
      abrir: () => dvDatosLista({
        entidad: 'vacantes_voluntarios', pk: 'id', etiqueta: 'rol',
        titulo: dvTexto('titleVacancies'),
        fila: (v) => dvpFila(
          v.rol || '',
          dvpUnidos([v.lugar_nombre, v.turno,
                     dvTexto('coverage', { cubierta: v.cantidad_cubierta, necesaria: v.cantidad_necesaria })]),
          `<span class="badge ${v.estado === 'Abierta' ? 'green' : 'gray'}">${e(String(v.estado || ''))}</span>`),
        campos: [
          { id: 'rol', etiqueta: dvTexto('fRole'), tipo: 'texto' },
          { id: 'lugar_tipo', etiqueta: dvTexto('fPlaceType'), tipo: 'opcion',
            opciones: ['Centro', 'Hospital', 'Refugio', 'Zona de derrumbe'] },
          { id: 'lugar_nombre', etiqueta: dvTexto('fPlaceName'), tipo: 'texto' },
          { id: 'ubicacion', etiqueta: dvTexto('fAddress'), tipo: 'texto' },
          { id: 'descripcion', etiqueta: dvTexto('fDescription'), tipo: 'texto-largo' },
          { id: 'cantidad_necesaria', etiqueta: dvTexto('fNeeded'), tipo: 'numero' },
          { id: 'cantidad_cubierta', etiqueta: dvTexto('fReceived'), tipo: 'numero' },
          { id: 'urgencia', etiqueta: dvTexto('fUrgency'), tipo: 'opcion',
            opciones: ['Alta', 'Normal', 'Baja'] },
          { id: 'turno', etiqueta: dvTexto('fShift'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'estado', etiqueta: dvTexto('fVacancyState'), tipo: 'opcion',
            opciones: ['Abierta', 'Cubierta', 'Cerrada'] },
        ],
      }),
    };
