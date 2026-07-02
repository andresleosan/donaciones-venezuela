(function (window) {
  'use strict';

  // Cliente Supabase sin dependencias: lecturas por PostgREST (vistas públicas),
  // escrituras por la edge function /functions/v1/api. Mantiene la interfaz
  // window.SheetsService que ya consume js/app.js.

  let config = {
    supabaseUrl: '',
    supabaseKey: ''
  };

  function configure(nextConfig) {
    config = Object.assign({}, config, nextConfig || {});
  }

  function assertConfigured() {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase no configurado');
    }
  }

  function emptyAll() {
    return {
      lugares: [],
      centros: [],
      voluntarios: [],
      rescatistas: [],
      motorizados: [],
      trayectos: [],
      historial: [],
      facturas: [],
      donacionesHumanitarias: [],
      estadisticas: {}
    };
  }

  async function fetchJson(path, options) {
    assertConfigured();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      // La clave publishable (sb_publishable_…) solo va en `apikey`; Authorization
      // exige un JWT y con esta clave el gateway devuelve 401.
      const init = Object.assign({ signal: controller.signal }, options || {});
      init.headers = Object.assign({ apikey: config.supabaseKey }, (options && options.headers) || {});
      const resp = await fetch(config.supabaseUrl + path, init);
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error((data && (data.error || data.message)) || 'HTTP ' + resp.status);
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function rest(view, query) {
    return fetchJson('/rest/v1/' + view + (query || ''));
  }

  function rpc(name, args) {
    return fetchJson('/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
  }

  // Adapta filas de vistas *_public a los nombres camelCase que espera la UI
  function voluntarioUI(v) {
    return Object.assign({}, v, { medioTransporte: v.medio_transporte });
  }
  function rescatistaUI(r) {
    return Object.assign({}, r, {
      equipoDisponible: r.equipo_disponible,
      capacidadOperativa: r.capacidad_operativa
    });
  }
  function motorizadoUI(m) {
    return Object.assign({}, m, {
      tipoVehiculo: m.tipo_vehiculo,
      zonaOperacion: m.zona_operacion,
      operaEn: m.zona_operacion
    });
  }

  async function getAll() {
    try {
      const [lugares, voluntarios, rescatistas, motorizados, estadisticas] = await Promise.all([
        rest('lugares_directorio', '?order=nombre'),
        rest('voluntarios_public', '?order=fecha_registro.desc'),
        rest('rescatistas_public', '?order=fecha_registro.desc'),
        rest('motorizados_public', '?order=fecha_registro.desc'),
        rpc('estadisticas')
      ]);
      const data = Object.assign(emptyAll(), {
        lugares: lugares || [],
        centros: lugares || [],
        voluntarios: (voluntarios || []).map(voluntarioUI),
        rescatistas: (rescatistas || []).map(rescatistaUI),
        motorizados: (motorizados || []).map(motorizadoUI),
        estadisticas: estadisticas || {}
      });
      return { data, source: 'live' };
    } catch (err) {
      return { data: emptyAll(), source: 'error', error: err };
    }
  }

  async function getList(view, query, mapFn) {
    try {
      const rows = await rest(view, query);
      return { data: mapFn ? (rows || []).map(mapFn) : (rows || []), source: 'live' };
    } catch (err) {
      return { data: [], source: 'error', error: err };
    }
  }

  async function getFamiliares(query) {
    try {
      const data = await rpc('buscar_familiar', { q: String(query || '') });
      return { data: data || [], source: 'live' };
    } catch (err) {
      return { data: [], source: 'error', error: err };
    }
  }

  async function getSeguimiento(token) {
    try {
      const data = await rpc('seguimiento_factura', { tok: String(token || '') });
      if (!data) return { data: null, source: 'error', error: new Error('Factura no encontrada') };
      return { data, source: 'live' };
    } catch (err) {
      return { data: null, source: 'error', error: err };
    }
  }

  async function post(payload) {
    const data = await fetchJson('/functions/v1/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!data || data.success === false) {
      throw new Error((data && data.error) || 'No se pudo guardar');
    }
    return data;
  }

  window.SheetsService = {
    configure,
    getAll,
    getLugares: () => getList('lugares_directorio', '?order=nombre'),
    getVoluntarios: () => getList('voluntarios_public', '?order=fecha_registro.desc', voluntarioUI),
    getRescatistas: () => getList('rescatistas_public', '?order=fecha_registro.desc', rescatistaUI),
    getMotorizados: () => getList('motorizados_public', '?order=fecha_registro.desc', motorizadoUI),
    getTrayectos: (motorizadoId) => getList('trayectos_public',
      '?order=fecha.desc' + (motorizadoId ? '&motorizado_id=eq.' + encodeURIComponent(motorizadoId) : '')),
    getHistorial: (lugar) => getList('historial_public',
      '?order=fecha.desc' + (lugar ? '&lugar=eq.' + encodeURIComponent(lugar) : '')),
    getFamiliares,
    getFacturas: () => getList('facturas_public', '?order=fecha_creacion.desc'),
    getDonacionesHumanitarias: () => getList('donaciones_motorizados_public', '?order=fecha.desc'),
    getSeguimiento,
    post
  };
})(window);
