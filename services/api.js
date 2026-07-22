(function (window) {
  'use strict';

  // Cliente Supabase sin dependencias: lecturas por PostgREST (vistas públicas),
  // escrituras por la edge function /functions/v1/api. Mantiene la interfaz
  // window.SheetsService que ya consume js/app.js.

  // Mismo patrón que js/pwa.js: el texto sale del idioma activo; el respaldo
  // solo se usa si core.js aún no ha cargado las traducciones.
  function traducir(clave, respaldo) {
    return typeof window.t === 'function' ? window.t(clave) : respaldo;
  }

  let config = {
    supabaseUrl: '',
    supabaseKey: ''
  };

  // La cola local solo contiene formularios públicos. Nunca guardamos credenciales,
  // tokens de administración ni sesiones de Supabase en IndexedDB.
  const OFFLINE_DB = 'donaciones-venezuela-offline-v1';
  const OFFLINE_DB_VERSION = 1;
  const OFFLINE_QUEUE = 'outbox';
  const OFFLINE_CACHE = 'snapshots';
  const ACCIONES_OFFLINE = new Set([
    'registrar_lugar', 'registrar_voluntario', 'registrar_rescatista',
    'registrar_motorizado', 'reportar_persona', 'ofrecer_insumo',
    'donar_dinero', 'donar_motorizado', 'registrar_trayecto',
    'registrar_recogida', 'registrar_entrega_final'
  ]);
  let dbPromise = null;
  let flushing = null;

  function tieneIndexedDb() {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  function abrirDb() {
    if (!tieneIndexedDb()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_QUEUE)) {
          db.createObjectStore(OFFLINE_QUEUE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(OFFLINE_CACHE)) {
          db.createObjectStore(OFFLINE_CACHE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  function transaccion(store, mode, operation) {
    return abrirDb().then((db) => new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const tx = db.transaction(store, mode);
        const request = operation(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    }));
  }

  function guardarSnapshot(key, value) {
    return transaccion(OFFLINE_CACHE, 'readwrite', (store) => store.put({ key, value, savedAt: Date.now() }));
  }

  function leerSnapshot(key) {
    return transaccion(OFFLINE_CACHE, 'readonly', (store) => store.get(key)).then((row) => row && row.value);
  }

  function emitirCambioCola() {
    return contarCola().then((count) => {
      window.dispatchEvent(new CustomEvent('dv-offline-change', { detail: { count } }));
      return count;
    });
  }

  function contarCola() {
    return transaccion(OFFLINE_QUEUE, 'readonly', (store) => store.count()).then((count) => Number(count || 0));
  }

  function esAccionOffline(payload) {
    return payload && ACCIONES_OFFLINE.has(String(payload.accion || ''));
  }

  function esErrorDeRed(err) {
    if (!err) return false;
    if (err.name === 'AbortError' || err.name === 'TypeError' || err.name === 'NetworkError') return true;
    return /failed to fetch|network|offline|load failed|fetch/i.test(String(err.message || err));
  }

  function registrarSync() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.ready) return;
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.sync && typeof registration.sync.register === 'function') {
        return registration.sync.register('dv-outbox');
      }
      return null;
    }).catch(() => {});
  }

  async function encolar(payload, error) {
    const id = 'offline-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const row = { id, payload, createdAt: Date.now(), attempts: 0, lastError: error ? String(error.message || error) : '' };
    const saved = await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.put(row));
    if (!saved) throw new Error(traducir('messages.offlineQueueError', 'No se pudo guardar el formulario sin conexión'));
    registrarSync();
    await emitirCambioCola();
    return {
      success: true,
      queued: true,
      queueId: id,
      token: 'PENDIENTE-' + id.slice(-6).toUpperCase()
    };
  }

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
      traslados: [],
      voluntarios: [],
      rescatistas: [],
      motorizados: [],
      trayectos: [],
      historial: [],
      facturas: [],
      donacionesHumanitarias: [],
      vacantes: [],
      estadisticas: {}
    };
  }

  async function fetchJson(path, options, timeoutMs) {
    assertConfigured();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs || 8000);
    try {
      // La clave publishable (sb_publishable_…) solo va en `apikey`; Authorization
      // exige un JWT y con esta clave el gateway devuelve 401.
      const init = Object.assign({ signal: controller.signal }, options || {});
      init.headers = Object.assign({ apikey: config.supabaseKey }, (options && options.headers) || {});
      const resp = await fetch(config.supabaseUrl + path, init);
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const error = new Error((data && (data.error || data.message)) || 'HTTP ' + resp.status);
        error.status = resp.status;
        throw error;
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
    const cacheKey = 'all';
    if (navigator.onLine === false) {
      const cached = await leerSnapshot(cacheKey);
      if (cached) return { data: cached, source: 'offline-cache' };
    }
    try {
      const [lugares, voluntarios, motorizados, estadisticas, traslados, vacantes] = await Promise.all([
        rest('lugares_directorio', '?order=nombre'),
        rest('voluntarios_public', '?order=fecha_registro.desc'),
        rest('motorizados_public', '?order=fecha_registro.desc'),
        rpc('estadisticas'),
        // catch propio: si la vista falta, el resto de la app sigue viva
        rest('traslados_sugeridos', '?order=actualizado.desc&limit=30').catch(() => []),
        rest('vacantes_public', '?order=fecha_creacion.desc&limit=100').catch(() => [])
      ]);
      const data = Object.assign(emptyAll(), {
        lugares: lugares || [],
        centros: lugares || [],
        voluntarios: (voluntarios || []).map(voluntarioUI),
        // Los perfiles de rescatistas son información operativa sensible.
        // Solo se cargan mediante admin_listar_rescatistas con la clave admin.
        rescatistas: [],
        motorizados: (motorizados || []).map(motorizadoUI),
        estadisticas: estadisticas || {},
        traslados: traslados || [],
        vacantes: vacantes || []
      });
      await guardarSnapshot(cacheKey, data);
      return { data, source: 'live' };
    } catch (err) {
      const cached = await leerSnapshot(cacheKey);
      return cached ? { data: cached, source: 'offline-cache', error: err } : { data: emptyAll(), source: 'error', error: err };
    }
  }

  async function getList(view, query, mapFn) {
    const cacheKey = 'list:' + view + ':' + (query || '');
    if (navigator.onLine === false) {
      const cached = await leerSnapshot(cacheKey);
      if (cached) return { data: cached, source: 'offline-cache' };
    }
    try {
      const rows = await rest(view, query);
      const data = mapFn ? (rows || []).map(mapFn) : (rows || []);
      await guardarSnapshot(cacheKey, data);
      return { data, source: 'live' };
    } catch (err) {
      const cached = await leerSnapshot(cacheKey);
      return cached ? { data: cached, source: 'offline-cache', error: err } : { data: [], source: 'error', error: err };
    }
  }

  async function getFamiliares(query) {
    const cacheKey = 'familiares:' + String(query || '').trim().toLowerCase();
    if (navigator.onLine === false) {
      const cached = await leerSnapshot(cacheKey);
      if (cached) return { data: cached, source: 'offline-cache' };
    }
    try {
      const data = await rpc('buscar_familiar', { q: String(query || '') });
      await guardarSnapshot(cacheKey, data || []);
      return { data: data || [], source: 'live' };
    } catch (err) {
      const cached = await leerSnapshot(cacheKey);
      return cached ? { data: cached, source: 'offline-cache', error: err } : { data: [], source: 'error', error: err };
    }
  }

  async function getSeguimiento(token) {
    const cacheKey = 'seguimiento:' + String(token || '').trim().toUpperCase();
    if (navigator.onLine === false) {
      const cached = await leerSnapshot(cacheKey);
      if (cached) return { data: cached, source: 'offline-cache' };
    }
    try {
      const data = await rpc('seguimiento_factura', { tok: String(token || '') });
      if (!data) return { data: null, source: 'error', error: new Error('Factura no encontrada') };
      await guardarSnapshot(cacheKey, data);
      return { data, source: 'live' };
    } catch (err) {
      const cached = await leerSnapshot(cacheKey);
      return cached ? { data: cached, source: 'offline-cache', error: err } : { data: null, source: 'error', error: err };
    }
  }

  // ── Acceso por correo: OTP de Supabase Auth (código de 6 dígitos) ──
  async function authPost(path, body) {
    assertConfigured();
    const resp = await fetch(config.supabaseUrl + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error((data && (data.msg || data.error_description || data.message)) || 'HTTP ' + resp.status);
    }
    return data;
  }

  // Crea la cuenta (correo + contraseña). Con la confirmación de correo apagada,
  // Supabase devuelve la sesión al instante ({ access_token, … }); con ella
  // encendida, devuelve el usuario sin access_token (hay que confirmar el correo).
  function registrarse(email, password) {
    return authPost('signup', { email: email, password: password });
  }

  // Inicia sesión con contraseña. Devuelve la sesión de Supabase Auth
  // ({ access_token, refresh_token, expires_at, user, … }).
  function iniciarSesion(email, password) {
    return authPost('token?grant_type=password', { email: email, password: password });
  }

  // Renueva la sesión sin pedir otro código (refresh_token de GoTrue).
  function refrescarSesion(refreshToken) {
    return authPost('token?grant_type=refresh_token', { refresh_token: refreshToken });
  }

  async function requestPost(payload) {
    // 45s: los registros con fotos (transportistas) suben ~1-2MB en móvil
    const data = await fetchJson('/functions/v1/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 45000);
    if (!data || data.success === false) {
      throw new Error((data && data.error) || traducir('messages.saveError', 'No se pudo guardar'));
    }
    return data;
  }

  async function post(payload) {
    const data = payload || {};
    if (navigator.onLine === false && esAccionOffline(data)) return encolar(data);
    try {
      return await requestPost(data);
    } catch (err) {
      if (esAccionOffline(data) && esErrorDeRed(err)) return encolar(data, err);
      throw err;
    }
  }

  async function flushQueue() {
    if (flushing) return flushing;
    if (navigator.onLine === false) return { sent: 0, pending: await contarCola() };
    flushing = (async () => {
      let sent = 0;
      const db = await abrirDb();
      if (!db) return { sent, pending: 0 };
      const rows = await transaccion(OFFLINE_QUEUE, 'readonly', (store) => store.getAll()) || [];
      rows.sort((a, b) => a.createdAt - b.createdAt);
      for (const row of rows) {
        try {
          await requestPost(row.payload);
          await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.delete(row.id));
          sent += 1;
        } catch (err) {
          await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.put(Object.assign({}, row, {
            attempts: Number(row.attempts || 0) + 1,
            lastError: String(err.message || err)
          })));
          if (esErrorDeRed(err)) break;
        }
      }
      const pending = await emitirCambioCola();
      return { sent, pending };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  function iniciarSincronizacion() {
    window.addEventListener('online', () => flushQueue());
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'dv-sync') flushQueue();
      });
    }
    window.setTimeout(() => flushQueue(), 1200);
  }

  window.SheetsService = {
    configure,
    getAll,
    getLugares: () => getList('lugares_directorio', '?order=nombre'),
    getVoluntarios: () => getList('voluntarios_public', '?order=fecha_registro.desc', voluntarioUI),
    getRescatistas: () => Promise.resolve({ data: [], source: 'restricted' }),
    getMotorizados: () => getList('motorizados_public', '?order=fecha_registro.desc', motorizadoUI),
    getTrayectos: (motorizadoId) => getList('trayectos_public',
      '?order=fecha.desc' + (motorizadoId ? '&motorizado_id=eq.' + encodeURIComponent(motorizadoId) : '')),
    getHistorial: (lugar) => getList('historial_public',
      '?order=fecha.desc' + (lugar ? '&lugar=eq.' + encodeURIComponent(lugar) : '')),
    getFamiliares,
    getSeguimiento,
    registrarse,
    iniciarSesion,
    refrescarSesion,
    post,
    flushQueue,
    getQueueCount: contarCola
  };
  iniciarSincronizacion();
})(window);
