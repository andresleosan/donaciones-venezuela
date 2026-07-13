/* Prueba E2E de idioma: recorre las 14 vistas en inglés y en español y busca
   texto del OTRO idioma, desbordes horizontales y áreas táctiles pequeñas.

   Se ejecuta DENTRO del navegador (consola o Playwright), sobre la app cargada:
     const informe = await pruebaIdioma();   // ver scripts/e2e-idioma.md

   Devuelve un informe; `informe.ok` es true solo si no encontró nada. No escribe
   en la base de datos: solo mira. */
async function pruebaIdioma() {
  const VISTAS = ['inicio', 'donaciones', 'ayuda', 'donar', 'ayudar', 'necesidades', 'acceso',
    'transporte', 'centro', 'voluntarios', 'rescatistas', 'familiar', 'seguimiento', 'ofrecer'];
  const MIN_TACTIL = 44; // px de alto mínimo para un control en móvil (regla R4.3)

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
  // Solo cadenas largas y sin marcadores {…}: las cortas ("Token", "WhatsApp")
  // son iguales en los dos idiomas y darían falsos positivos.
  // Se descartan también los textos de EJEMPLO (placeholders y datos de muestra):
  // "Hospital Central de San Cristóbal" es un placeholder en español Y el nombre
  // real de un centro en la base — verlo en la página inglesa no es un fallo.
  const esEjemplo = (clave) => /Ph$|Placeholder$|\.mock\./i.test(clave);
  const frases = (dic) => {
    const plano = aplanar(dic);
    return new Set(Object.keys(plano)
      .filter((k) => !esEjemplo(k))
      .map((k) => plano[k])
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
    document.querySelectorAll('[placeholder]').forEach((el) => {
      if (el.offsetParent) salida.push(el.placeholder);
    });
    return salida;
  };

  const revisarVista = (idiomaEsperado) => {
    const intrusas = idiomaEsperado === 'en' ? soloES : soloEN;
    const textos = textoVisible();
    const activa = document.querySelector('.view.active') || document.body;
    // Lo que se toca de una casilla no es la casilla, es su etiqueta: se mide
    // el área táctil EFECTIVA, no el control de 13px que hay dentro.
    const areaTactil = (el) => (el.closest('label') || el).getBoundingClientRect().height;
    const controles = [...activa.querySelectorAll('button, a, input, select, textarea')]
      .filter((el) => el.offsetParent && el.getBoundingClientRect().height > 0);
    return {
      textoDelOtroIdioma: [...new Set(textos.filter((t) => intrusas.includes(t)))],
      desbordeHorizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
      tactilesPequenos: controles
        .filter((el) => areaTactil(el) < MIN_TACTIL)
        .map((el) => (el.id || el.textContent.trim().slice(0, 30) || el.tagName))
    };
  };

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const recorrer = async (idioma) => {
    await cambiarIdioma(idioma, { persist: false });
    await esperar(600);
    const hallazgos = {};
    for (const vista of VISTAS) {
      window.location.hash = '#' + vista;
      await esperar(700);
      const r = revisarVista(idioma);
      if (r.textoDelOtroIdioma.length || r.desbordeHorizontal || r.tactilesPequenos.length) hallazgos[vista] = r;
    }
    return hallazgos;
  };

  const ingles = await recorrer('en');
  const espanol = await recorrer('es');
  // Lo que más duele y no se ve leyendo el código: cambiar de idioma con la
  // pantalla ya pintada (lo que se construye con innerHTML no se traduce solo).
  window.location.hash = '#ofrecer';
  await esperar(900);
  await cambiarIdioma('en', { persist: false });
  await esperar(900);
  const enCaliente = revisarVista('en');
  await cambiarIdioma('es', { persist: false });

  const informe = {
    ok: !Object.keys(ingles).length && !Object.keys(espanol).length &&
        !enCaliente.textoDelOtroIdioma.length,
    ancho: window.innerWidth,
    claves: { es: Object.keys(aplanar(es)).length, en: Object.keys(aplanar(en)).length },
    ingles, espanol,
    cambioEnCaliente: enCaliente
  };
  console.log(informe.ok ? 'IDIOMA OK: nada que reportar.' : 'IDIOMA: hay hallazgos.', informe);
  return informe;
}
