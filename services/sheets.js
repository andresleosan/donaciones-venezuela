(function (window) {
  'use strict';

  const DEFAULT_DELAY = 220;
  let config = {
    appsScriptUrl: '',
    sandboxMode: true,
    fallback: {},
    cacheKeys: {}
  };

  function configure(nextConfig) {
    config = Object.assign({}, config, nextConfig || {});
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isFile() {
    return window.location && window.location.protocol === 'file:';
  }

  function withQuery(action, params) {
    const url = new URL(config.appsScriptUrl);
    if (action) url.searchParams.set('accion', action);
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url.toString();
  }

  function cacheRead(key) {
    if (!key) return null;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function cacheWrite(key, value) {
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // Sin localStorage disponible: la app sigue funcionando con memoria/fallback.
    }
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function fallbackAll() {
    return Object.assign({
      lugares: [],
      centros: [],
      voluntarios: [],
      rescatistas: [],
      motorizados: [],
      estadisticas: {}
    }, config.fallback || {});
  }

  async function demoAll() {
    if (isFile()) return fallbackAll();
    try {
      const data = await fetchJson('data/ejemplo.json');
      return Object.assign({}, fallbackAll(), data, {
        lugares: data.lugares || data.centros || fallbackAll().lugares,
        centros: data.centros || data.lugares || fallbackAll().lugares,
        voluntarios: fallbackAll().voluntarios,
        rescatistas: fallbackAll().rescatistas,
        estadisticas: fallbackAll().estadisticas
      });
    } catch (err) {
      return fallbackAll();
    }
  }

  async function getAll() {
    const cacheKey = config.cacheKeys.all;
    try {
      const data = config.sandboxMode ? await demoAll() : await fetchJson(config.appsScriptUrl);
      const normalized = Object.assign({}, fallbackAll(), data, {
        lugares: data.lugares || data.centros || [],
        centros: data.centros || data.lugares || [],
        estadisticas: data.estadisticas || data.stats || {}
      });
      cacheWrite(cacheKey, normalized);
      return { data: normalized, source: config.sandboxMode ? 'demo' : 'live' };
    } catch (err) {
      const cached = cacheRead(cacheKey);
      if (cached) return { data: cached, source: 'cache' };
      return { data: fallbackAll(), source: 'demo', error: err };
    }
  }

  async function getAction(action, responseKey, cacheKey, fallbackValue, params) {
    try {
      if (config.sandboxMode) {
        await delay(DEFAULT_DELAY);
        return { data: fallbackValue || [], source: 'demo' };
      }
      const data = await fetchJson(withQuery(action, params || {}));
      const value = data[responseKey] || [];
      cacheWrite(cacheKey, value);
      return { data: value, source: 'live' };
    } catch (err) {
      const cached = cacheRead(cacheKey);
      if (cached) return { data: cached, source: 'cache' };
      return { data: fallbackValue || [], source: 'demo', error: err };
    }
  }

  async function post(payload, optimistic) {
    if (config.sandboxMode) {
      await delay(DEFAULT_DELAY);
      return Object.assign({ success: true, exito: true, demo: true }, optimistic || {});
    }
    await fetch(config.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(payload || {})
    });
    return Object.assign({ success: true, exito: true, opaque: true }, optimistic || {});
  }

  window.SheetsService = {
    configure,
    getAll,
    getLugares: (params) => getAction('lugares', 'lugares', config.cacheKeys.lugares, fallbackAll().lugares, params),
    getVoluntarios: (params) => getAction('voluntarios', 'voluntarios', config.cacheKeys.voluntarios, fallbackAll().voluntarios, params),
    getRescatistas: (params) => getAction('rescatistas', 'rescatistas', config.cacheKeys.rescatistas, fallbackAll().rescatistas, params),
    getMotorizados: (params) => getAction('motorizados', 'motorizados', config.cacheKeys.motorizados, fallbackAll().motorizados, params),
    getTrayectos: (motorizadoId) => getAction('trayectos', 'trayectos', config.cacheKeys.trayectos, fallbackAll().trayectos || [], { motorizado: motorizadoId }),
    getHistorial: (lugar) => getAction('historial', 'movimientos', config.cacheKeys.historial, fallbackAll().historial || [], { centro: lugar }),
    buscarFamiliar: (query) => getAction('buscar_familiar', 'resultados', config.cacheKeys.familiar, [], { query }),
    post,
    cacheRead,
    cacheWrite
  };
})(window);
