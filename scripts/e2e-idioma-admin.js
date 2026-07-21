/* Prueba E2E de idioma del PANEL ADMIN (ventana.html?v=admin): recorre las
   secciones de la consola admin en inglés y en español buscando texto del OTRO
   idioma, desbordes horizontales y áreas táctiles pequeñas. Espejo de
   e2e-idioma.js pero para la ventana de administración (plan 08 T1).

   OJO: el panel admin NO cambia de idioma en caliente (vive en un <dialog>;
   cambiarIdioma lo cerraría y saldría a «/»). Su idioma se fija al CARGAR con
   ?lang=. Por eso este script audita el idioma ACTUAL y se corre UNA VEZ POR
   IDIOMA, recargando la ventana en cada uno:
     ventana.html?v=admin&lang=es → const a = await pruebaIdiomaAdmin('CLAVE');
     ventana.html?v=admin&lang=en → const b = await pruebaIdiomaAdmin('CLAVE');
     // ok global = a.ok && b.ok

   Solo lee: usa las acciones admin_listar_* (lectura) y las vistas ya pintadas.
   `informe.ok` es true solo si no encontró nada en el idioma cargado. */
async function pruebaIdiomaAdmin(claveAdmin) {
  const SECCIONES = ['track', 'facturas', 'vacantes', 'personas', 'rescatistas', 'denuncias', 'regenerar'];
  const MIN_TACTIL = 44; // px de alto mínimo para un control en móvil
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  const aplanar = (obj, prefijo = '', salida = {}) => {
    Object.keys(obj).forEach((clave) => {
      const valor = obj[clave];
      if (valor && typeof valor === 'object') aplanar(valor, prefijo + clave + '.', salida);
      else salida[prefijo + clave] = String(valor);
    });
    return salida;
  };
  const [es, en] = await Promise.all([
    fetch('locales/es.json').then((r) => r.json()),
    fetch('locales/en.json').then((r) => r.json())
  ]);
  const esEjemplo = (clave) => /Ph$|Placeholder$|\.mock\./i.test(clave);
  const frases = (dic) => {
    const plano = aplanar(dic);
    return new Set(Object.keys(plano).filter((k) => !esEjemplo(k)).map((k) => plano[k])
      .filter((s) => s.length > 4 && !s.includes('{')));
  };
  const fraseEs = frases(es), fraseEn = frases(en);
  const soloES = [...fraseEs].filter((s) => !fraseEn.has(s));
  const soloEN = [...fraseEn].filter((s) => !fraseEs.has(s));

  const textoVisible = () => {
    const salida = [];
    const paseo = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let nodo;
    while ((nodo = paseo.nextNode())) {
      const txt = nodo.textContent.trim();
      const el = nodo.parentElement;
      if (txt.length > 4 && el && el.offsetParent) salida.push(txt);
    }
    document.querySelectorAll('[placeholder]').forEach((el) => { if (el.offsetParent) salida.push(el.placeholder); });
    return salida;
  };
  const revisar = (idioma) => {
    const intrusas = idioma === 'en' ? soloES : soloEN;
    const textos = textoVisible();
    const areaTactil = (el) => (el.closest('label') || el).getBoundingClientRect().height;
    const controles = [...document.querySelectorAll('#admin-console button, #admin-console a, #admin-console input, #admin-console select, #admin-console textarea')]
      .filter((el) => el.offsetParent && el.getBoundingClientRect().height > 0);
    return {
      textoDelOtroIdioma: [...new Set(textos.filter((t) => intrusas.includes(t)))],
      desbordeHorizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
      tactilesPequenos: controles.filter((el) => areaTactil(el) < MIN_TACTIL)
        .map((el) => (el.id || el.textContent.trim().slice(0, 30) || el.tagName))
    };
  };

  // Login si aún estamos en la pantalla de clave.
  const consola = document.querySelector('#admin-console');
  const auth = document.querySelector('#admin-auth-form');
  if (auth && consola && consola.hidden !== false) {
    if (claveAdmin) document.querySelector('#admin-key').value = claveAdmin;
    auth.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await esperar(1200);
  }
  const irAlMenu = async () => { const m = document.querySelector('#gest-menu'); if (m) { m.click(); await esperar(300); } };
  const abrirSeccion = async (id) => {
    await irAlMenu();
    const btn = document.querySelector(`#admin-console [data-admin-gestion="${id}"]`);
    if (!btn) return false;
    btn.click(); await esperar(500); return true;
  };
  // El idioma cargado (?lang=): buscamos texto del OTRO idioma.
  const idioma = (document.documentElement.lang || 'es').slice(0, 2) === 'en' ? 'en' : 'es';
  await irAlMenu();
  const hallazgos = {};
  const menu = revisar(idioma);
  if (menu.textoDelOtroIdioma.length || menu.desbordeHorizontal || menu.tactilesPequenos.length) hallazgos['menu'] = menu;
  for (const sec of SECCIONES) {
    if (!(await abrirSeccion(sec))) continue;
    const r = revisar(idioma);
    if (r.textoDelOtroIdioma.length || r.desbordeHorizontal || r.tactilesPequenos.length) hallazgos[sec] = r;
  }
  await irAlMenu();

  const informe = {
    idioma,
    ok: !Object.keys(hallazgos).length,
    ancho: window.innerWidth,
    claves: { es: Object.keys(aplanar(es)).length, en: Object.keys(aplanar(en)).length },
    hallazgos
  };
  console.log(informe.ok ? `IDIOMA ADMIN (${idioma}) OK: nada que reportar.` : `IDIOMA ADMIN (${idioma}): hay hallazgos.`, informe);
  return informe;
}
