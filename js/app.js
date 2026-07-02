    'use strict';

    // -- INTERNACIONALIZACIÓN ----------------------------------------------
    const I18N_DEFAULT_LANGUAGE = 'es';
    const I18N_BASE_URL = 'https://donacionesvenezuela.vercel.app/';
    const I18N_LANGUAGES = {
      es: { label: 'Español', hreflang: 'es', locale: 'es_VE' },
      en: { label: 'English', hreflang: 'en', locale: 'en_US' },
      fr: { label: 'Français', hreflang: 'fr', locale: 'fr_FR' }
    };
    const i18nCache = {};
    let idiomaActual = I18N_DEFAULT_LANGUAGE;
    let traducciones = {};
    let fuenteDatosActual = 'loading';
    let ultimosFamiliares = null;
    let ultimoSeguimiento = null;

    function normalizarIdioma(lang) {
      const code = String(lang || '').toLowerCase().slice(0, 2);
      return I18N_LANGUAGES[code] ? code : I18N_DEFAULT_LANGUAGE;
    }

    function idiomaInicial() {
      const params = new URLSearchParams(window.location.search);
      return normalizarIdioma(params.get('lang') || navigator.language || I18N_DEFAULT_LANGUAGE);
    }

    async function cargarTraducciones(lang) {
      const code = normalizarIdioma(lang);
      if (i18nCache[code]) return i18nCache[code];
      try {
        const resp = await fetch(`locales/${code}.json`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        i18nCache[code] = await resp.json();
        return i18nCache[code];
      } catch (err) {
        if (code !== I18N_DEFAULT_LANGUAGE) return cargarTraducciones(I18N_DEFAULT_LANGUAGE);
        i18nCache[code] = {};
        return i18nCache[code];
      }
    }

    function leerTraduccion(source, key) {
      return String(key || '').split('.').reduce((acc, part) => acc && acc[part] != null ? acc[part] : undefined, source);
    }

    function interpolar(texto, params) {
      return String(texto == null ? '' : texto).replace(/\{(\w+)\}/g, (_, name) => params && params[name] != null ? params[name] : '');
    }

    function t(key, params) {
      const value = leerTraduccion(traducciones, key) || leerTraduccion(i18nCache[I18N_DEFAULT_LANGUAGE] || {}, key) || key;
      return interpolar(value, params || {});
    }

    function tValue(scope, value) {
      const raw = String(value == null ? '' : value);
      if (!raw) return '';
      return leerTraduccion(traducciones, `values.${scope}.${raw}`) || leerTraduccion(i18nCache[I18N_DEFAULT_LANGUAGE] || {}, `values.${scope}.${raw}`) || raw;
    }

    function setText(selector, key, params) {
      const el = $(selector);
      if (el) el.textContent = t(key, params);
    }

    function setAttr(selector, attr, key, params) {
      const el = $(selector);
      if (el) el.setAttribute(attr, t(key, params));
    }

    function setPlaceholder(selector, key) {
      const el = $(selector);
      if (el) el.setAttribute('placeholder', t(key));
    }

    function setInlineCheckboxText(selector, key) {
      const label = $(selector);
      if (!label) return;
      const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.nodeValue = ` ${t(key)}`;
    }

    function setOptionLabel(option, entry) {
      if (option.getAttribute('value') == null) option.value = option.value;
      if (Array.isArray(entry)) option.textContent = tValue(entry[0], entry[1]);
      else option.textContent = t(entry);
    }

    function aplicarOpciones(selector, labels) {
      const select = $(selector);
      if (!select) return;
      Array.from(select.options).forEach((option) => {
        const value = option.getAttribute('value') != null ? option.getAttribute('value') : option.value;
        if (labels[value] != null) setOptionLabel(option, labels[value]);
      });
    }

    function aplicarTraduccionesEstaticas() {
      setText('.skip-link', 'a11y.skip');
      setAttr('.brand', 'aria-label', 'a11y.brand');
      setText('.brand span:last-child', 'hero.title');
      setAttr('.top-nav', 'aria-label', 'a11y.mainNav');
      setText('.top-nav [data-view-link="inicio"]', 'nav.home');
      setText('.top-nav [data-view-link="donaciones"]', 'nav.centers');
      setText('.top-nav [data-view-link="voluntarios"]', 'nav.volunteers');
      setText('.top-nav [data-view-link="rescatistas"]', 'nav.rescuers');
      setText('.top-nav [data-view-link="familiar"]', 'nav.searchFamily');
      setText('.top-nav [data-view-link="seguimiento"]', 'nav.traceability');
      setText('label[for="language-select"]', 'language.selectorLabel');
      setAttr('#language-select', 'aria-label', 'language.selectorAria');

      const eyebrow = $('.eyebrow');
      if (eyebrow) eyebrow.innerHTML = `<span aria-hidden="true">VE</span> ${e(t('hero.eyebrow'))}`;
      setText('#hero-title', 'hero.title');
      setText('.hero-subtitle', 'hero.subtitle');
      setAttr('.hero-actions', 'aria-label', 'a11y.primaryActions');
      setText('.hero-actions [data-view-link="familiar"]', 'hero.findFamily');
      setText('.hero-actions [data-view-link="donaciones"]', 'hero.viewCenters');
      setText('.hero-actions [data-view-link="voluntarios"]', 'hero.volunteerRegistration');
      setAttr('.hero-visual', 'aria-label', 'a11y.heroVisual');
      setAttr('.ops-panel', 'aria-label', 'a11y.operationalPriorities');
      setText('.ops-card:nth-child(1) .ops-label', 'hero.priorityLabel');
      setText('.ops-card:nth-child(1) .ops-value', 'hero.priorityValue');
      setText('.ops-card:nth-child(2) .ops-label', 'hero.coverageLabel');
      setText('.ops-card:nth-child(2) .ops-value', 'hero.coverageValue');
      setText('.ops-card:nth-child(3) .ops-label', 'hero.responseLabel');
      setText('.ops-card:nth-child(3) .ops-value', 'hero.responseValue');

      setText('#dashboard-title', 'dashboard.title');
      setText('#dashboard-operaciones .section-copy', 'dashboard.copy');
      setText('#ayudar-title', 'help.title');
      setText('#ayudar-title + .section-copy', 'help.copy');
      setText('.help-grid article:nth-child(1) h3', 'help.donateTitle');
      setText('.help-grid article:nth-child(1) .meta', 'help.donateCopy');
      setText('.help-grid article:nth-child(1) button', 'help.donateAction');
      setText('.help-grid article:nth-child(2) h3', 'help.volunteerTitle');
      setText('.help-grid article:nth-child(2) .meta', 'help.volunteerCopy');
      setText('.help-grid article:nth-child(2) button', 'help.volunteerAction');
      setText('.help-grid article:nth-child(3) h3', 'help.reportTitle');
      setText('.help-grid article:nth-child(3) .meta', 'help.reportCopy');
      setText('.help-grid article:nth-child(3) button', 'help.reportAction');
      setText('#urgentes-title', 'urgent.title');
      setText('#urgentes-title + .section-copy', 'urgent.copy');
      setText('#mapa-title', 'map.title');
      setText('#mapa-title + .section-copy', 'map.copy');
      setText('.map-placeholder h3', 'map.emptyTitle');
      setText('.map-placeholder .meta', 'map.emptyCopy');
      setAttr('.map-layers', 'aria-label', 'a11y.mapLayers');
      const mapBadges = $$('.map-layers .badge');
      [['map.hospitals'], ['map.shelters'], ['map.collectionCenters'], ['map.helpPoints']].forEach(([key], idx) => { if (mapBadges[idx]) mapBadges[idx].textContent = t(key); });

      setText('#donaciones-title', 'centers.title');
      setText('#donaciones-title + .section-copy', 'centers.copy');
      setText('[data-scroll-target="form-lugar"]', 'centers.reportButton');
      setAttr('#view-donaciones .filters', 'aria-label', 'a11y.centerFilters');
      setText('label[for="filtro-lugar-q"]', 'common.search');
      setPlaceholder('#filtro-lugar-q', 'centers.searchPlaceholder');
      setText('label[for="filtro-lugar-tipo"]', 'common.type');
      setText('label[for="filtro-lugar-categoria"]', 'common.category');
      setText('#form-lugar-title', 'centers.formTitle');
      setText('#form-lugar-title + .section-copy', 'centers.formCopy');
      setText('label[for="lugar-tipo"]', 'centers.typeLabel');
      setText('label[for="lugar-nombre"]', 'common.name');
      setPlaceholder('#lugar-nombre', 'centers.namePlaceholder');
      setText('label[for="lugar-ubicacion"]', 'common.location');
      setPlaceholder('#lugar-ubicacion', 'centers.locationPlaceholder');
      setText('label[for="lugar-telefono"]', 'common.phone');
      setText('label[for="lugar-insumo"]', 'centers.supplyLabel');
      setPlaceholder('#lugar-insumo', 'centers.supplyPlaceholder');
      setText('label[for="lugar-categoria"]', 'common.category');
      setText('label[for="lugar-estado"]', 'centers.supplyStatus');
      setText('#lugar-form button[type="submit"]', 'centers.saveReport');
      setText('#lugar-form button[type="reset"]', 'common.clear');

      setText('#voluntarios-title', 'volunteers.title');
      setText('#voluntarios-title + .section-copy', 'volunteers.copy');
      setText('#vol-form-title', 'volunteers.formTitle');
      setText('#vol-form-title + .section-copy', 'volunteers.formCopy');
      setText('label[for="vol-nombre"]', 'common.name');
      setText('label[for="vol-apellido"]', 'common.lastName');
      setText('label[for="vol-telefono"]', 'common.phone');
      setText('label[for="vol-ciudad"]', 'common.city');
      setPlaceholder('#vol-ciudad', 'volunteers.cityPlaceholder');
      setText('label[for="vol-estado"]', 'common.state');
      setPlaceholder('#vol-estado', 'volunteers.statePlaceholder');
      setText('label[for="vol-profesion"]', 'common.profession');
      setText('label[for="vol-disponibilidad"]', 'common.availability');
      setPlaceholder('#vol-disponibilidad', 'volunteers.availabilityPlaceholder');
      setText('label[for="vol-transporte"]', 'volunteers.transport');
      setText('label[for="vol-observaciones"]', 'common.observations');
      setPlaceholder('#vol-observaciones', 'volunteers.observationsPlaceholder');
      setText('#voluntario-form button[type="submit"]', 'volunteers.save');
      setText('#voluntario-form button[type="reset"]', 'common.clear');
      setText('#vol-summary-title', 'volunteers.summaryTitle');
      setText('.volunteer-shell .registry-side > .meta', 'volunteers.summaryCopy');
      setText('#vol-list-title', 'volunteers.listTitle');
      setText('#vol-list-title + .section-copy', 'volunteers.listCopy');
      setAttr('#view-voluntarios .filters', 'aria-label', 'a11y.volunteerFilters');
      setText('label[for="filtro-vol-q"]', 'volunteers.searchLabel');
      setPlaceholder('#filtro-vol-q', 'volunteers.searchPlaceholder');
      setText('label[for="filtro-vol-profesion"]', 'common.profession');
      setText('label[for="filtro-vol-estado"]', 'common.state');
      setPlaceholder('#filtro-vol-estado', 'volunteers.stateFilterPlaceholder');

      setText('#rescatistas-title', 'rescuers.title');
      setText('#rescatistas-title + .section-copy', 'rescuers.copy');
      setText('#res-form-title', 'rescuers.formTitle');
      setText('#res-form-title + .section-copy', 'rescuers.formCopy');
      setText('label[for="res-nombre"]', 'common.name');
      setText('label[for="res-organizacion"]', 'common.organization');
      setPlaceholder('#res-organizacion', 'rescuers.organizationPlaceholder');
      setText('label[for="res-especialidad"]', 'common.specialty');
      setText('label[for="res-telefono"]', 'common.phone');
      setText('label[for="res-ciudad"]', 'common.city');
      setText('label[for="res-estado"]', 'common.state');
      setText('label[for="res-equipo"]', 'rescuers.equipment');
      setPlaceholder('#res-equipo', 'rescuers.equipmentPlaceholder');
      setText('label[for="res-capacidad"]', 'rescuers.capacity');
      setText('label[for="res-disponibilidad"]', 'common.availability');
      setPlaceholder('#res-disponibilidad', 'rescuers.availabilityPlaceholder');
      setText('label[for="res-observaciones"]', 'common.observations');
      setPlaceholder('#res-observaciones', 'rescuers.observationsPlaceholder');
      setText('#rescatista-form button[type="submit"]', 'rescuers.save');
      setText('#rescatista-form button[type="reset"]', 'common.clear');
      setText('#res-summary-title', 'rescuers.summaryTitle');
      setText('.rescue-shell .registry-side > .meta', 'rescuers.summaryCopy');
      setText('#res-list-title', 'rescuers.listTitle');
      setText('#res-list-title + .section-copy', 'rescuers.listCopy');
      setAttr('#view-rescatistas section[aria-labelledby="res-list-title"] .filters', 'aria-label', 'a11y.rescuerFilters');
      setText('label[for="filtro-res-q"]', 'rescuers.searchLabel');
      setPlaceholder('#filtro-res-q', 'rescuers.searchPlaceholder');
      setText('label[for="filtro-res-especialidad"]', 'common.specialty');
      setText('label[for="filtro-res-estado"]', 'common.state');
      setPlaceholder('#filtro-res-estado', 'rescuers.stateFilterPlaceholder');
      setText('#mot-title', 'drivers.title');
      setText('#mot-title + .section-copy', 'drivers.copy');
      setText('#btn-motorizado', 'drivers.register');
      setAttr('#view-rescatistas section[aria-labelledby="mot-title"] .filters', 'aria-label', 'a11y.driverFilters');
      setText('label[for="filtro-mot-q"]', 'common.search');
      setPlaceholder('#filtro-mot-q', 'drivers.searchPlaceholder');
      setText('label[for="filtro-mot-tipo"]', 'common.vehicle');

      setText('#familiar-title', 'family.title');
      setText('#familiar-title + .section-copy', 'family.copy');
      setText('label[for="familiar-query"]', 'family.queryLabel');
      setPlaceholder('#familiar-query', 'family.queryPlaceholder');
      setText('#familiar-form button[type="submit"]', 'family.submit');

      setText('#seguimiento-title', 'donations.title');
      setText('#seguimiento-title + .section-copy', 'donations.copy');
      setText('[data-scroll-target="donation-urgent-panel"]', 'donations.heroUrgentAction');
      setText('[data-scroll-target="donation-tracking-panel"]', 'donations.heroTrackingAction');
      setText('#donation-dashboard-title', 'donations.dashboardTitle');
      setText('#donation-dashboard-title + .section-copy', 'donations.dashboardCopy');
      setText('#donation-filter-title', 'donations.filtersTitle');
      setAttr('#view-seguimiento .donation-filters', 'aria-label', 'a11y.donationFilters');
      setText('label[for="filtro-donacion-tipo"]', 'donations.filters.type');
      setText('label[for="filtro-donacion-estado"]', 'common.state');
      setText('label[for="filtro-donacion-ciudad"]', 'common.city');
      setPlaceholder('#filtro-donacion-ciudad', 'donations.filters.cityPlaceholder');
      setText('label[for="filtro-donacion-urgencia"]', 'donations.filters.urgency');
      setInlineCheckboxText('label[for="filtro-donacion-reciente"]', 'donations.filters.recent');
      setInlineCheckboxText('label[for="filtro-donacion-verificado"]', 'donations.filters.verified');
      setText('#donation-urgent-title', 'donations.urgentTitle');
      setText('#donation-urgent-title + .section-copy', 'donations.urgentCopy');
      setText('#donation-map-title', 'donations.mapTitle');
      setText('#donation-map-title + .section-copy', 'donations.mapCopy');
      setText('#donation-needs-title', 'donations.needsTitle');
      setText('#donation-needs-title + .section-copy', 'donations.needsCopy');
      setText('#donation-impact-title', 'donations.impactTitle');
      setText('#donation-impact-title + .section-copy', 'donations.impactCopy');
      setText('#donation-acopios-title', 'donations.sections.collectionCenters');
      setText('#donation-hospitals-title', 'donations.sections.hospitals');
      setText('#donation-volunteers-title', 'donations.sections.volunteers');
      setText('#donation-rescuers-title', 'donations.sections.rescuers');
      setText('#donation-history-title', 'donations.historyTitle');
      setText('#donation-history-title + .section-copy', 'donations.historyCopy');
      setText('#donation-kinds-title', 'donations.inKindTitle');
      setText('#donation-services-title', 'donations.servicesTitle');
      setText('#donation-allies-title', 'donations.alliesTitle');
      setText('#donation-allies-title + .section-copy', 'donations.alliesCopy');
      setText('#donation-transparency-title', 'donations.transparencyTitle');
      setText('.transparency-note', 'donations.transparencyCopy');
      setText('#tracking-panel-title', 'tracking.panelTitle');
      setText('#donation-tracking-panel > .section-copy', 'tracking.copy');
      setText('label[for="seguimiento-token"]', 'tracking.tokenLabel');
      setPlaceholder('#seguimiento-token', 'tracking.tokenPlaceholder');
      setText('#seguimiento-form button[type="submit"]', 'tracking.submit');

      setAttr('.bottom-nav', 'aria-label', 'a11y.mobileNav');
      const bottomItems = [
        ['inicio', 'nav.home', 'nav.home'],
        ['donaciones', 'nav.centers', 'nav.centersLong'],
        ['voluntarios', 'nav.volunteersShort', 'nav.volunteersLong'],
        ['rescatistas', 'nav.rescueShort', 'nav.rescuersLong'],
        ['familiar', 'nav.searchShort', 'nav.searchFamily'],
        ['seguimiento', 'nav.donationsShort', 'nav.traceabilityLong']
      ];
      bottomItems.forEach(([view, textKey, ariaKey]) => {
        const btn = $(`.bottom-nav [data-view-link="${view}"]`);
        if (!btn) return;
        const icon = btn.querySelector('span');
        btn.setAttribute('aria-label', t(ariaKey));
        btn.innerHTML = `${icon ? icon.outerHTML : ''}${e(t(textKey))}`;
      });

      aplicarOpciones('#filtro-lugar-tipo', { todos: 'centers.typeAll', Centro: 'centers.typeCenters', Hospital: 'centers.typeHospitals', Refugio: 'centers.typeShelters' });
      aplicarOpciones('#lugar-tipo', { Centro: ['types', 'Centro de acopio'], Hospital: ['types', 'Hospital'], Refugio: ['types', 'Refugio'], 'Punto de ayuda': ['types', 'Punto de ayuda'] });
      aplicarOpciones('#lugar-categoria', { 'Agua potable': ['categories', 'Agua potable'], Medicamentos: ['categories', 'Medicamentos'], 'Insumos médicos': ['categories', 'Insumos médicos'], Alimentos: ['categories', 'Alimentos'], 'Plantas eléctricas': ['categories', 'Plantas eléctricas'], Combustible: ['categories', 'Combustible'], Higiene: ['categories', 'Higiene'], Ropa: ['categories', 'Ropa'], Otros: ['categories', 'Otros'] });
      aplicarOpciones('#lugar-estado', { Necesita: ['supplyStatus', 'Necesita'], 'Tiene disponible': ['supplyStatus', 'Tiene disponible'] });
      const professionOptions = { '': 'common.all', Voluntario: ['professions', 'Voluntario'], Médico: ['professions', 'Médico'], Enfermero: ['professions', 'Enfermero'], Psicólogo: ['professions', 'Psicólogo'], Logística: ['professions', 'Logística'], Transportista: ['professions', 'Transportista'], Ingeniero: ['professions', 'Ingeniero'], Electricista: ['professions', 'Electricista'], Comunicaciones: ['professions', 'Comunicaciones'], Otro: ['professions', 'Otro'] };
      aplicarOpciones('#vol-profesion', professionOptions);
      aplicarOpciones('#filtro-vol-profesion', professionOptions);
      aplicarOpciones('#vol-transporte', { '': 'common.pending', 'A pie': ['transport', 'A pie'], Bicicleta: ['transport', 'Bicicleta'], Moto: ['transport', 'Moto'], Carro: ['transport', 'Carro'], Camioneta: ['transport', 'Camioneta'], 'Transporte público': ['transport', 'Transporte público'], 'Ambulancia o unidad médica': ['transport', 'Ambulancia o unidad médica'], Otro: ['transport', 'Otro'] });
      const specialtyOptions = { '': 'common.allFemale', Bombero: ['specialties', 'Bombero'], Paramédico: ['specialties', 'Paramédico'], 'Protección Civil': ['specialties', 'Protección Civil'], 'Rescate Urbano': ['specialties', 'Rescate Urbano'], 'Rescate Acuático': ['specialties', 'Rescate Acuático'], 'Rescate Canino': ['specialties', 'Rescate Canino'], 'Defensa Civil': ['specialties', 'Defensa Civil'], Otro: ['specialties', 'Otro'] };
      aplicarOpciones('#res-especialidad', specialtyOptions);
      aplicarOpciones('#filtro-res-especialidad', specialtyOptions);
      aplicarOpciones('#res-capacidad', { '': 'common.pending', '1-2 personas': ['capacity', '1-2 personas'], '3-5 personas': ['capacity', '3-5 personas'], '6-10 personas': ['capacity', '6-10 personas'], 'Más de 10 personas': ['capacity', 'Más de 10 personas'], 'Unidad médica': ['capacity', 'Unidad médica'], 'Unidad de rescate pesado': ['capacity', 'Unidad de rescate pesado'] });
      aplicarOpciones('#filtro-mot-tipo', { '': 'common.all', Moto: ['transport', 'Moto'], Carro: ['transport', 'Carro'], Bicicleta: ['transport', 'Bicicleta'], Camión: ['transport', 'Camión'], Motocarro: ['transport', 'Motocarro'] });
      aplicarOpciones('#filtro-donacion-tipo', { '': 'common.all', Centro: 'donations.filters.collectionCenters', Hospital: 'donations.filters.hospitals', Voluntario: 'donations.filters.volunteers', Rescatista: 'donations.filters.rescuers' });
      aplicarOpciones('#filtro-donacion-urgencia', { '': 'common.all', 'Crítico': ['donationPriorities', 'Crítico'], Alto: ['donationPriorities', 'Alto'], Medio: ['donationPriorities', 'Medio'] });
    }

    function actualizarSeo() {
      const htmlLang = t('meta.htmlLang');
      document.documentElement.lang = htmlLang;
      document.title = t('meta.title');
      const langParam = idiomaActual === I18N_DEFAULT_LANGUAGE ? '' : `?lang=${idiomaActual}`;
      const canonicalUrl = I18N_BASE_URL + langParam;
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.href = canonicalUrl;
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) metaDescription.content = t('meta.description');
      const ogSite = document.querySelector('meta[property="og:site_name"]');
      if (ogSite) ogSite.content = t('meta.title');
      const ogLocale = document.querySelector('meta[property="og:locale"]');
      if (ogLocale) ogLocale.content = t('meta.locale');
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.content = canonicalUrl;
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.content = t('meta.title');
      const ogDescription = document.querySelector('meta[property="og:description"]');
      if (ogDescription) ogDescription.content = t('meta.ogDescription');
      const ogImageAlt = document.querySelector('meta[property="og:image:alt"]');
      if (ogImageAlt) ogImageAlt.content = t('meta.imageAlt');
      const twitterTitle = document.querySelector('meta[name="twitter:title"]');
      if (twitterTitle) twitterTitle.content = t('meta.title');
      const twitterDescription = document.querySelector('meta[name="twitter:description"]');
      if (twitterDescription) twitterDescription.content = t('meta.twitterDescription');
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd) {
        jsonLd.textContent = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': ['WebSite', 'WebApplication'],
          name: t('meta.title'),
          url: I18N_BASE_URL,
          applicationCategory: 'EmergencyApplication',
          operatingSystem: 'Web',
          inLanguage: htmlLang,
          description: t('meta.jsonLdDescription'),
          potentialAction: {
            '@type': 'SearchAction',
            target: `${I18N_BASE_URL}?q={search_term_string}`,
            'query-input': 'required name=search_term_string'
          }
        }, null, 2);
      }
    }

    function sincronizarUrlIdioma(lang) {
      const url = new URL(window.location.href);
      if (lang === I18N_DEFAULT_LANGUAGE) url.searchParams.delete('lang');
      else url.searchParams.set('lang', lang);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }

    async function cambiarIdioma(lang, options) {
      const nextLang = normalizarIdioma(lang);
      const shouldPersist = !options || options.persist !== false;
      document.body.classList.add('is-translating');
      idiomaActual = nextLang;
      traducciones = await cargarTraducciones(nextLang);
      if (shouldPersist) sincronizarUrlIdioma(nextLang);
      const select = $('#language-select');
      if (select) select.value = nextLang;
      actualizarSeo();
      aplicarTraduccionesEstaticas();
      setStatus(fuenteDatosActual);
      renderAll();
      if (ultimosFamiliares) renderFamiliares(ultimosFamiliares.resultados, ultimosFamiliares.encontrado);
      if (ultimoSeguimiento) renderSeguimiento(ultimoSeguimiento);
      window.setTimeout(() => document.body.classList.remove('is-translating'), 180);
      if (shouldPersist) toast(t('language.changed', { language: I18N_LANGUAGES[nextLang].label }));
    }

    async function initI18n() {
      idiomaActual = idiomaInicial();
      traducciones = await cargarTraducciones(idiomaActual);
      const select = $('#language-select');
      if (select) {
        select.value = idiomaActual;
        select.addEventListener('change', (ev) => cambiarIdioma(ev.target.value));
      }
      actualizarSeo();
      aplicarTraduccionesEstaticas();
    }

    // ── CONFIGURACIÓN ─────────────────────────────────────────
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzY39NEDPZrRZTtu7zLfuURf_bTnYXLAhjokfOzWq80H8yzrqe_TL7Y2vp-9LpgiU2GDg/exec';

    const estado = {
      lugares: [], voluntarios: [], rescatistas: [], motorizados: [], donacionesHumanitarias: [], estadisticas: {},
      filtros: {
        lugarQ: '', lugarTipo: 'todos', lugarCategoria: '',
        volQ: '', volProfesion: '', volEstado: '',
        resQ: '', resEspecialidad: '', resEstado: '',
        motQ: '', motTipo: '',
        donacionTipo: '', donacionEstado: '', donacionCiudad: '', donacionUrgencia: '',
        donacionReciente: false, donacionVerificado: false
      }
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
    const e = (str) => String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const normalizar = (txt) => String(txt == null ? '' : txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const soloDigitos = (tel) => String(tel || '').replace(/[^0-9]/g, '');
    const waHref = (tel) => `https://wa.me/${soloDigitos(tel)}?text=${encodeURIComponent(t('messages.whatsappText'))}`;
    const telHref = (tel) => `tel:${String(tel || '').replace(/[^0-9+]/g, '')}`;
    const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const formatearMonto = (value) => new Intl.NumberFormat(localeActual(), { maximumFractionDigits: 2 }).format(numero(value));
    const setTexto = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const normalizarTokenCliente = (value) => {
      const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
      const compacto = raw.replace(/[^A-Z0-9]/g, '');
      if (/^DV[A-Z0-9]{12}$/.test(compacto)) return `DV-${compacto.slice(2, 6)}-${compacto.slice(6, 10)}-${compacto.slice(10, 14)}`;
      return raw;
    };
    const tokenDesdeUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const queryToken = normalizarTokenCliente(params.get('token'));
      if (queryToken) return queryToken;
      const hash = decodeURIComponent(window.location.hash || '');
      const match = hash.match(/^#seguimiento\/(.+)$/i);
      return match ? normalizarTokenCliente(match[1]) : '';
    };
    const sincronizarUrlToken = (token) => {
      const url = new URL(window.location.href);
      const limpio = normalizarTokenCliente(token);
      if (limpio) url.searchParams.set('token', limpio);
      else url.searchParams.delete('token');
      url.hash = '';
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };
    const ultimoISO = (items, campo) => {
      const fechas = (items || [])
        .map((item) => new Date(item && item[campo]))
        .filter((fecha) => !Number.isNaN(fecha.getTime()))
        .sort((a, b) => b - a);
      return fechas[0] ? fechas[0].toISOString() : '';
    };
    const contarUnicos = (items, campo) => new Set((items || []).map((item) => normalizar(item[campo])).filter(Boolean)).size;
    const localeActual = () => t('meta.htmlLang') || 'es-VE';
    const mostrarTipo = (value) => tValue('types', value || 'Centro');
    const mostrarCategoria = (value) => tValue('categories', value || 'Otros');
    const mostrarEstadoInsumo = (value) => tValue('supplyStatus', value || 'Necesita');
    const mostrarUrgencia = (value) => tValue('urgency', value || 'Normal');
    const mostrarInsumo = (value) => tValue('items', value);
    const mostrarUnidad = (value) => tValue('units', value || 'unidades');
    const mostrarProfesion = (value) => tValue('professions', value);
    const mostrarTransporte = (value) => tValue('transport', value);
    const mostrarEspecialidad = (value) => tValue('specialties', value);
    const mostrarCapacidad = (value) => tValue('capacity', value);
    const mostrarNota = (value) => tValue('notes', value);
    const mostrarEstadoOperativo = (value) => tValue('operationalStatus', value);
    const mostrarEstadoFamiliar = (value) => tValue('familyStatus', value);
    const mostrarFuente = (value) => tValue('sources', value);
    const mostrarTextoConUnidades = (value) => String(value == null ? '' : value).replace(/\bpersonas\b/gi, mostrarUnidad('personas'));
    const mostrarInsumoTransportado = (value) => {
      const parts = String(value || '').split(' · ');
      if (!parts[0]) return t('common.various');
      return [mostrarInsumo(parts[0]), mostrarTextoConUnidades(parts.slice(1).join(' · '))].filter(Boolean).join(' · ');
    };
    const mostrarUbicacionFamiliar = (value) => String(value || '').replace(/^Última vez:/i, t('family.lastSeenPrefix'));

    window.SheetsService.configure({ appsScriptUrl: APPS_SCRIPT_URL });

    function fechaRelativa(iso) {
      if (!iso) return t('relative.noDate');
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      if (min < 1) return t('relative.now');
      if (min < 60) return t('relative.minutes', { count: min });
      const horas = Math.round(min / 60);
      if (horas < 24) return t('relative.hours', { count: horas });
      return d.toLocaleDateString(localeActual(), { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function setStatus(source) {
      fuenteDatosActual = source || 'loading';
      const banner = $('#banner');
      banner.classList.toggle('visible', source !== 'live' && source !== 'loading');
      banner.textContent = source === 'live' || source === 'loading' ? '' : t('status.errorBanner');
    }

    function cambiarVista(view) {
      const target = $(`.view[data-view="${view}"]`) ? view : 'inicio';
      $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.view === target));
      $$('[data-view-link]').forEach((btn) => {
        const active = btn.dataset.viewLink === target;
        if (btn.tagName === 'BUTTON') btn.setAttribute('aria-current', active ? 'page' : 'false');
      });
      $('#contenido').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function calcularStats() {
      const stats = Object.assign({}, estado.estadisticas);
      const centrosLocales = estado.lugares.filter((l) => normalizar(l.tipo).indexOf('hospital') !== 0).length;
      const hospitalesLocales = estado.lugares.filter((l) => normalizar(l.tipo).indexOf('hospital') === 0).length;
      stats.centrosRegistrados = Math.max(numero(stats.centrosRegistrados), centrosLocales);
      stats.hospitalesRegistrados = Math.max(numero(stats.hospitalesRegistrados), hospitalesLocales);
      stats.voluntariosActivos = Math.max(numero(stats.voluntariosActivos), estado.voluntarios.length);
      stats.rescatistasRegistrados = Math.max(numero(stats.rescatistasRegistrados), estado.rescatistas.length);
      stats.personasLocalizadas = stats.personasLocalizadas == null ? 0 : numero(stats.personasLocalizadas);
      stats.motorizadosRegistrados = Math.max(numero(stats.motorizadosRegistrados), estado.motorizados.length);
      stats.actualizado = stats.actualizado || ultimaActualizacion();
      return stats;
    }

    function ultimaActualizacion() {
      const fechas = [
        estado.estadisticas && estado.estadisticas.actualizado,
        ultimoISO(estado.lugares, 'actualizado'),
        ultimoISO(estado.voluntarios, 'fecha_registro'),
        ultimoISO(estado.rescatistas, 'fecha_registro'),
        ultimoISO(estado.motorizados, 'ultimoTrayecto')
      ].map((iso) => new Date(iso)).filter((fecha) => !Number.isNaN(fecha.getTime())).sort((a, b) => b - a);
      return fechas[0] ? fechas[0].toISOString() : '';
    }

    function renderStats() {
      const s = calcularStats();
      const items = [
        [t('dashboard.activeCenters'), s.centrosRegistrados || 0],
        [t('dashboard.hospitals'), s.hospitalesRegistrados || 0],
        [t('dashboard.volunteers'), s.voluntariosActivos || 0],
        [t('dashboard.rescuers'), s.rescatistasRegistrados || 0]
      ];
      $('#stats-grid').innerHTML = items.map(([label, value]) => `<div class="stat-card"><span class="stat-num">${e(value)}</span><span class="stat-label">${e(label)}</span></div>`).join('');
    }

    function renderDashboard() {
      const s = calcularStats();
      const actualizacion = ultimaActualizacion() || s.actualizado || '';
      const voluntariosConTransporte = estado.voluntarios.filter((v) => v.medioTransporte || v.medio_transporte || v.transporte).length;
      const rescatistasConEquipo = estado.rescatistas.filter((r) => r.equipoDisponible || r.equipo_disponible || r.equipo).length;
      const items = [
        [t('dashboard.registeredVolunteers'), s.voluntariosActivos || 0, t('dashboard.withTransport', { count: voluntariosConTransporte }), 'volunteer'],
        [t('dashboard.registeredRescuers'), s.rescatistasRegistrados || 0, t('dashboard.withEquipment', { count: rescatistasConEquipo }), 'rescue'],
        [t('dashboard.helpCentersActive'), s.centrosRegistrados || 0, t('dashboard.helpCentersMeta'), 'neutral'],
        [t('dashboard.hospitalsAvailable'), s.hospitalesRegistrados || 0, t('dashboard.hospitalsMeta'), 'critical'],
        [t('dashboard.familyReports'), s.personasLocalizadas || 0, t('dashboard.familyReportsMeta'), ''],
        [t('dashboard.lastUpdate'), actualizacion ? fechaRelativa(actualizacion) : t('relative.noDate'), actualizacion ? new Date(actualizacion).toLocaleString(localeActual()) : t('dashboard.pendingLiveData'), 'neutral']
      ];
      $('#dashboard-grid').innerHTML = items.map(([label, value, meta, cls]) => `<article class="dashboard-card ${e(cls)}"><div><span class="dashboard-value">${e(value)}</span><span class="dashboard-label">${e(label)}</span></div><p class="dashboard-meta">${e(meta)}</p></article>`).join('');
    }

    function prioridadCanonica(value) {
      const n = normalizar(value);
      if (n.indexOf('critico') === 0 || n.indexOf('emergencia') !== -1) return 'Crítico';
      if (n.indexOf('alto') === 0 || n.indexOf('urgente') !== -1 || n.indexOf('moderado') === 0) return 'Alto';
      return 'Medio';
    }

    function prioridadPeso(value) {
      const p = prioridadCanonica(value);
      if (p === 'Crítico') return 3;
      if (p === 'Alto') return 2;
      return 1;
    }

    function prioridadClase(value) {
      const p = prioridadCanonica(value);
      if (p === 'Crítico') return 'red';
      if (p === 'Alto') return 'yellow';
      return 'green';
    }

    function estadoAyudaCanonico(value) {
      const n = normalizar(value);
      if (n.indexOf('entreg') === 0 || n.indexOf('delivered') === 0) return 'Entregado';
      if (n.indexOf('proceso') !== -1 || n.indexOf('process') !== -1) return 'En proceso';
      return 'Pendiente';
    }

    function estadoAyudaClase(value) {
      const estadoAyuda = estadoAyudaCanonico(value);
      if (estadoAyuda === 'Entregado') return 'delivered';
      if (estadoAyuda === 'En proceso') return 'process';
      return 'pending';
    }

    function boolValue(value) {
      const n = normalizar(value);
      return value === true || n === 'si' || n === 'sí' || n === 'true' || n === 'verificado' || n === 'verified';
    }

    function splitItems(value) {
      if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
      return String(value || '').split(/[,;|\n]+/).map((item) => item.trim()).filter(Boolean);
    }

    function ubicacionPartes(value) {
      const partes = String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
      return { estado: partes[0] || '', ciudad: partes[1] || partes[0] || '' };
    }

    function fechaSegura(value) {
      const fecha = new Date(value);
      return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
    }

    function esReciente(value) {
      const fecha = new Date(value);
      if (Number.isNaN(fecha.getTime())) return false;
      return Date.now() - fecha.getTime() <= 1000 * 60 * 60 * 24 * 14;
    }

    function donationId(prefix, value, idx) {
      return `${prefix}-${normalizar(value || idx).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || idx}`;
    }

    function tipoDonacionCanonico(value) {
      const n = normalizar(value);
      if (n.includes('hospital')) return 'Hospital';
      if (n.includes('volunt') || n.includes('volunteer')) return 'Voluntario';
      if (n.includes('rescat') || n.includes('rescue')) return 'Rescatista';
      return 'Centro';
    }

    function normalizarDonacionSheet(row, idx) {
      const tipo = tipoDonacionCanonico(row.donation_type || row.tipo || row.type || 'Centro');
      const organization = row.organization || row.organizacion || row.nombre || row.name || t('donations.defaults.organization');
      return {
        id: donationId('sheet', organization, idx),
        type: tipo,
        organization,
        city: row.city || row.ciudad || '',
        state: row.state || row.estado || '',
        priority: prioridadCanonica(row.priority || row.prioridad),
        requestedItems: splitItems(row.requested_items || row.items || row.necesidades || row.insumos),
        beneficiaries: numero(row.beneficiaries || row.beneficiarios || row.personas_beneficiadas),
        verified: boolValue(row.verified || row.verificado),
        lastUpdate: fechaSegura(row.last_update || row.actualizado || row.fecha),
        status: estadoAyudaCanonico(row.status || row.estado_entrega),
        responsible: row.responsable || row.responsible || '',
        contact: row.contact || row.contacto || row.telefono || '',
        specialty: row.specialty || row.especialidad || '',
        availability: row.availability || row.disponibilidad || '',
        source: 'sheets'
      };
    }

    function registrosDesdeLugares() {
      return estado.lugares.map((lugar, idx) => {
        const tipoNormal = normalizar(lugar.tipo);
        const isHospital = tipoNormal.indexOf('hospital') === 0;
        const partes = ubicacionPartes(lugar.ubicacion);
        const items = (lugar.necesita || []).map((item) => item.nombre).filter(Boolean);
        const maxPrioridad = (lugar.necesita || []).reduce((max, item) => Math.max(max, prioridadPeso(item.urgencia)), 1);
        const priority = maxPrioridad >= 3 ? 'Crítico' : maxPrioridad === 2 ? 'Alto' : 'Medio';
        const beneficiaries = (lugar.necesita || []).reduce((total, item) => total + Math.max(1, numero(item.cantidadNecesaria || 1)), 0);
        return {
          id: donationId('lugar', lugar.nombre, idx),
          type: isHospital ? 'Hospital' : 'Centro',
          organization: lugar.nombre || t('donations.defaults.organization'),
          city: partes.ciudad,
          state: partes.estado,
          priority,
          requestedItems: items.length ? items : [t('donations.defaults.supplies')],
          beneficiaries: beneficiaries || (isHospital ? 80 : 40),
          verified: Boolean(lugar.telefono),
          lastUpdate: lugar.actualizado || '',
          status: lugar.necesita && lugar.necesita.length ? 'Pendiente' : 'En proceso',
          responsible: t('donations.defaults.coordination'),
          contact: lugar.telefono || '',
          specialty: isHospital ? t('donations.defaults.hospitalSpecialty') : '',
          availability: '',
          source: 'platform'
        };
      });
    }

    function registrosDesdeVoluntarios() {
      return estado.voluntarios.map((vol, idx) => ({
        id: donationId('vol', `${vol.nombre || ''}-${vol.telefono || idx}`, idx),
        type: 'Voluntario',
        organization: `${vol.nombre || ''} ${vol.apellido || ''}`.trim() || t('volunteers.defaultName'),
        city: vol.ciudad || '',
        state: vol.estado || '',
        priority: vol.medioTransporte || vol.medio_transporte ? 'Medio' : 'Alto',
        requestedItems: ['Transporte', 'Combustible', 'Alimentos'],
        beneficiaries: 12,
        verified: Boolean(vol.telefono),
        lastUpdate: vol.fecha_registro || '',
        status: 'En proceso',
        responsible: vol.profesion || t('volunteers.defaultName'),
        contact: vol.telefono || '',
        specialty: mostrarProfesion(vol.profesion),
        availability: vol.disponibilidad || '',
        source: 'platform'
      }));
    }

    function registrosDesdeRescatistas() {
      return estado.rescatistas.map((res, idx) => ({
        id: donationId('res', `${res.nombre || res.organizacion || ''}-${res.telefono || idx}`, idx),
        type: 'Rescatista',
        organization: res.organizacion || res.nombre || t('rescuers.defaultName'),
        city: res.ciudad || '',
        state: res.estado || '',
        priority: 'Alto',
        requestedItems: ['Equipos', 'Herramientas', 'Combustible'],
        beneficiaries: 25,
        verified: Boolean(res.telefono),
        lastUpdate: res.fecha_registro || '',
        status: 'En proceso',
        responsible: res.nombre || '',
        contact: res.telefono || '',
        specialty: mostrarEspecialidad(res.especialidad),
        availability: res.disponibilidad || '',
        source: 'platform'
      }));
    }

    function registrosMockDonaciones() {
      return [
        {
          id: 'mock-centro', type: 'Centro', organization: t('donations.mock.centerName'), city: t('donations.mock.cityOne'), state: t('donations.mock.stateOne'),
          priority: 'Crítico', requestedItems: ['Agua potable', 'Alimentos', 'Kits de higiene'], beneficiaries: 180,
          verified: true, lastUpdate: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), status: 'Pendiente', responsible: t('donations.mock.coordinator'), contact: '', source: 'mock', simulated: true
        },
        {
          id: 'mock-hospital', type: 'Hospital', organization: t('donations.mock.hospitalName'), city: t('donations.mock.cityTwo'), state: t('donations.mock.stateTwo'),
          priority: 'Crítico', requestedItems: ['Medicamentos', 'Material médico'], beneficiaries: 260,
          verified: true, lastUpdate: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(), status: 'En proceso', responsible: t('donations.mock.medicalLead'), contact: '', specialty: t('donations.mock.emergency'), source: 'mock', simulated: true
        },
        {
          id: 'mock-volunteer', type: 'Voluntario', organization: t('donations.mock.volunteerName'), city: t('donations.mock.cityThree'), state: t('donations.mock.stateThree'),
          priority: 'Alto', requestedItems: ['Transporte', 'Combustible'], beneficiaries: 60,
          verified: false, lastUpdate: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(), status: 'Pendiente', responsible: t('donations.mock.logistics'), contact: '', availability: t('donations.mock.daytime'), source: 'mock', simulated: true
        },
        {
          id: 'mock-rescue', type: 'Rescatista', organization: t('donations.mock.rescueName'), city: t('donations.mock.cityFour'), state: t('donations.mock.stateFour'),
          priority: 'Medio', requestedItems: ['Herramientas', 'Equipos'], beneficiaries: 90,
          verified: true, lastUpdate: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), status: 'Entregado', responsible: t('donations.mock.rescueLead'), contact: '', specialty: t('donations.mock.rescueSpecialty'), source: 'mock', simulated: true
        }
      ];
    }

    function registrosDonaciones() {
      const sheets = (estado.donacionesHumanitarias || []).map(normalizarDonacionSheet).filter((item) => item.organization);
      const registros = sheets.concat(registrosDesdeLugares(), registrosDesdeVoluntarios(), registrosDesdeRescatistas());
      return registros.length ? registros : registrosMockDonaciones();
    }

    function filtrarDonaciones(registros) {
      const f = estado.filtros;
      return registros.filter((item) => {
        if (f.donacionTipo && normalizar(item.type) !== normalizar(f.donacionTipo)) return false;
        if (f.donacionEstado && normalizar(item.state) !== normalizar(f.donacionEstado)) return false;
        if (f.donacionCiudad && !normalizar(item.city).includes(normalizar(f.donacionCiudad))) return false;
        if (f.donacionUrgencia && prioridadCanonica(item.priority) !== prioridadCanonica(f.donacionUrgencia)) return false;
        if (f.donacionReciente && !esReciente(item.lastUpdate)) return false;
        if (f.donacionVerificado && !item.verified) return false;
        return true;
      });
    }

    function poblarEstadosDonacion(registros) {
      const select = $('#filtro-donacion-estado');
      if (!select) return;
      const selected = estado.filtros.donacionEstado;
      const states = Array.from(new Set(registros.map((item) => item.state).filter(Boolean))).sort((a, b) => a.localeCompare(b, localeActual()));
      select.innerHTML = `<option value="">${e(t('common.all'))}</option>` + states.map((state) => `<option value="${e(state)}">${e(state)}</option>`).join('');
      select.value = states.includes(selected) ? selected : '';
      estado.filtros.donacionEstado = select.value;
    }

    function donationStats(registros) {
      const centros = registros.filter((item) => item.type === 'Centro');
      const hospitales = registros.filter((item) => item.type === 'Hospital');
      const voluntarios = registros.filter((item) => item.type === 'Voluntario');
      const rescatistas = registros.filter((item) => item.type === 'Rescatista');
      const entregas = registros.filter((item) => estadoAyudaCanonico(item.status) === 'Entregado').length;
      return {
        centros: centros.length,
        hospitales: hospitales.length,
        voluntarios: Math.max(voluntarios.length, estado.voluntarios.length),
        rescatistas: Math.max(rescatistas.length, estado.rescatistas.length),
        urgentes: registros.filter((item) => prioridadPeso(item.priority) >= 2).length,
        donaciones: registros.length,
        beneficiarios: registros.reduce((total, item) => total + Math.max(0, numero(item.beneficiaries)), 0),
        entregas
      };
    }

    function renderDonationDashboard(registros) {
      const stats = donationStats(registros);
      const items = [
        [t('donations.kpis.collectionCenters'), stats.centros, t('donations.kpis.collectionCentersMeta'), ''],
        [t('donations.kpis.hospitals'), stats.hospitales, t('donations.kpis.hospitalsMeta'), 'critical'],
        [t('donations.kpis.volunteers'), stats.voluntarios, t('donations.kpis.volunteersMeta'), 'green'],
        [t('donations.kpis.rescuers'), stats.rescatistas, t('donations.kpis.rescuersMeta'), 'rescue'],
        [t('donations.kpis.urgentRequests'), stats.urgentes, t('donations.kpis.urgentRequestsMeta'), 'critical'],
        [t('donations.kpis.registeredDonations'), stats.donaciones, t('donations.kpis.registeredDonationsMeta'), ''],
        [t('donations.kpis.beneficiaries'), stats.beneficiarios, t('donations.kpis.beneficiariesMeta'), 'green']
      ];
      $('#donation-dashboard-grid').innerHTML = items.map(([label, value, meta, cls]) => `<article class="donation-kpi-card ${e(cls)}"><div><span class="donation-kpi-value">${e(value)}</span><span class="donation-kpi-label">${e(label)}</span></div><p class="donation-kpi-meta">${e(meta)}</p></article>`).join('');
    }

    function renderDonationUrgent(registros) {
      const urgentes = registros.filter((item) => prioridadPeso(item.priority) >= 2).sort((a, b) => prioridadPeso(b.priority) - prioridadPeso(a.priority)).slice(0, 6);
      $('#donation-urgent-grid').innerHTML = urgentes.length ? urgentes.map((item) => {
        const tag = prioridadCanonica(item.priority) === 'Crítico' ? t('donations.urgentTags.critical') : t('donations.urgentTags.high');
        return `<article class="donation-urgent-card"><div class="supply-line"><strong>${e(item.organization)}</strong><span class="badge ${prioridadClase(item.priority)}">${e(tag)}</span></div><p class="meta">${e([item.city, item.state].filter(Boolean).join(', ') || t('centers.locationPending'))}</p><div class="badge-row">${item.requestedItems.slice(0, 4).map((need) => `<span class="badge">${e(mostrarInsumo(need))}</span>`).join('')}</div></article>`;
      }).join('') : `<div class="empty-state">${e(t('donations.emptyFiltered'))}</div>`;
    }

    function renderDonationMap(registros) {
      const grouped = {};
      registros.forEach((item) => {
        const key = `${item.state || t('centers.locationPending')}|${item.city || t('centers.locationPending')}`;
        if (!grouped[key]) grouped[key] = { state: item.state || t('centers.locationPending'), city: item.city || t('centers.locationPending'), count: 0, priority: 'Medio' };
        grouped[key].count += 1;
        if (prioridadPeso(item.priority) > prioridadPeso(grouped[key].priority)) grouped[key].priority = prioridadCanonica(item.priority);
      });
      const rows = Object.values(grouped).sort((a, b) => prioridadPeso(b.priority) - prioridadPeso(a.priority) || b.count - a.count).slice(0, 8);
      $('#donation-map-grid').innerHTML = rows.length ? rows.map((row) => `<article class="donation-map-item ${prioridadPeso(row.priority) >= 3 ? 'critical' : prioridadPeso(row.priority) === 2 ? 'high' : ''}"><div class="supply-line"><strong>${e(row.state)}</strong><span class="badge ${prioridadClase(row.priority)}">${e(tValue('donationPriorities', row.priority))}</span></div><p class="meta"><strong>${e(t('common.city'))}:</strong> ${e(row.city)}</p><p class="meta"><strong>${e(t('donations.mapRequests'))}:</strong> ${e(row.count)}</p></article>`).join('') : `<div class="empty-state">${e(t('donations.emptyFiltered'))}</div>`;
    }

    function necesidadBase(item) {
      const n = normalizar(item);
      if (n.includes('agua')) return 'Agua potable';
      if (n.includes('medic')) return 'Medicamentos';
      if (n.includes('alimento') || n.includes('arroz') || n.includes('comida')) return 'Alimentos';
      if (n.includes('material') || n.includes('insumo') || n.includes('equipo') || n.includes('gasa') || n.includes('guante')) return 'Material médico';
      if (n.includes('transporte')) return 'Transporte';
      if (n.includes('combustible') || n.includes('fuel')) return 'Combustible';
      if (n.includes('higiene') || n.includes('jabon') || n.includes('jabón')) return 'Kits de higiene';
      return item;
    }

    function renderDonationNeeds(registros) {
      const orden = ['Agua potable', 'Medicamentos', 'Alimentos', 'Material médico', 'Transporte', 'Combustible', 'Kits de higiene'];
      const counts = {};
      registros.forEach((item) => item.requestedItems.forEach((need) => {
        const key = necesidadBase(need);
        counts[key] = (counts[key] || 0) + prioridadPeso(item.priority);
      }));
      const rows = orden.map((name) => [name, counts[name] || 0]).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...rows.map(([, count]) => count));
      $('#donation-needs-ranking').innerHTML = rows.map(([name, count], idx) => {
        const pct = Math.max(8, Math.round((count / max) * 100));
        return `<div class="need-row"><div class="supply-line"><strong>${e(idx + 1)}. ${e(mostrarInsumo(name))}</strong><span>${e(pct)}%</span></div><div class="progress" role="progressbar" aria-label="${e(t('a11y.progress', { item: mostrarInsumo(name) }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(pct)}"><span style="--value:${e(pct)}%"></span></div></div>`;
      }).join('');
    }

    function renderDonationImpact(registros) {
      const stats = donationStats(registros);
      const items = [
        [t('donations.impact.beneficiaries'), stats.beneficiarios],
        [t('donations.impact.hospitals'), stats.hospitales],
        [t('donations.impact.centers'), stats.centros],
        [t('donations.impact.deliveries'), stats.entregas],
        [t('donations.impact.volunteers'), stats.voluntarios]
      ];
      $('#donation-impact-grid').innerHTML = items.map(([label, value]) => `<article class="donation-impact-card"><span class="donation-impact-value" data-counter-target="${e(value)}">0</span><span class="donation-impact-label">${e(label)}</span></article>`).join('');
      animarContadores();
    }

    function donationActionLabel(type) {
      if (type === 'Hospital') return t('donations.actions.supportHospital');
      if (type === 'Voluntario') return t('donations.actions.supportVolunteer');
      if (type === 'Rescatista') return t('donations.actions.supportRescuer');
      return t('donations.actions.donateCenter');
    }

    function donationCard(item) {
      const typeClass = item.type === 'Hospital' ? 'hospital' : item.type === 'Voluntario' ? 'volunteer' : item.type === 'Rescatista' ? 'rescue' : '';
      const titleMeta = item.type === 'Hospital' ? item.specialty || t('donations.defaults.hospitalSpecialty') : item.type === 'Voluntario' ? item.availability || t('common.availability') : item.type === 'Rescatista' ? item.specialty || t('common.specialty') : item.responsible || t('donations.defaults.coordination');
      const location = [item.city, item.state].filter(Boolean).join(', ') || t('centers.locationPending');
      const badges = [
        item.verified ? ['green', t('donations.badges.verified')] : ['gray', t('donations.badges.pendingValidation')],
        ['yellow', t('donations.badges.activeRequest')],
        esReciente(item.lastUpdate) ? ['green', t('donations.badges.recent')] : ['gray', t('donations.badges.lastUpdate', { date: fechaRelativa(item.lastUpdate) })]
      ];
      if (item.simulated) badges.unshift(['gray', t('donations.badges.example')]);
      return `<article class="card card-bordered donation-card ${typeClass}"><div class="card-top"><div><span class="badge ${prioridadClase(item.priority)}">${e(tValue('donationPriorities', prioridadCanonica(item.priority)))}</span><h3>${e(item.organization)}</h3></div><div class="icon-box ${typeClass === 'hospital' ? 'red' : typeClass === 'volunteer' ? 'green' : typeClass === 'rescue' ? 'rescue' : ''}" aria-hidden="true">${e(item.type === 'Hospital' ? 'H' : item.type === 'Voluntario' ? '✓' : item.type === 'Rescatista' ? '⚑' : '+')}</div></div><div class="meta-grid"><span><strong>${e(t('common.city'))}:</strong> ${e(item.city || t('common.pending'))}</span><span><strong>${e(t('common.state'))}:</strong> ${e(item.state || t('common.pending'))}</span><span><strong>${e(item.type === 'Rescatista' ? t('common.organization') : t('donations.card.responsible'))}:</strong> ${e(item.responsible || titleMeta || t('common.pending'))}</span><span><strong>${e(t('common.phone'))}:</strong> ${e(item.contact || t('centers.phonePending'))}</span></div><p class="meta">${e(location)}${titleMeta ? ' · ' + e(titleMeta) : ''}</p><div class="badge-row">${item.requestedItems.slice(0, 6).map((need) => `<span class="badge">${e(mostrarInsumo(need))}</span>`).join('')}</div><div class="donation-status-row">${badges.map(([cls, label]) => `<span class="badge ${cls}">${e(label)}</span>`).join('')}</div><div class="card-actions"><button class="btn btn-soft btn-small" type="button" data-donation-support="${e(item.id)}">${e(donationActionLabel(item.type))}</button></div><p class="meta">${e(t('centers.updated', { date: fechaRelativa(item.lastUpdate) }))}</p></article>`;
    }

    function renderDonationSections(registros) {
      const sections = [
        ['#grid-acopios', 'Centro'],
        ['#grid-hospitales', 'Hospital'],
        ['#grid-donacion-voluntarios', 'Voluntario'],
        ['#grid-donacion-rescatistas', 'Rescatista']
      ];
      sections.forEach(([selector, type]) => {
        const list = registros.filter((item) => item.type === type);
        $(selector).innerHTML = list.length ? list.map(donationCard).join('') : `<div class="empty-state">${e(t('donations.emptySection'))}</div>`;
      });
      $$('[data-donation-support]').forEach((btn) => btn.addEventListener('click', () => {
        const item = registros.find((record) => record.id === btn.dataset.donationSupport);
        if (item && soloDigitos(item.contact)) window.location.href = waHref(item.contact);
        else toast(t('donations.messages.contactPending'));
      }));
    }

    function renderDonationHistory(registros) {
      const items = registros.slice().sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate)).slice(0, 7);
      $('#donation-history-list').innerHTML = items.length ? items.map((item) => `<article class="donation-history-item ${estadoAyudaClase(item.status)}"><div class="supply-line"><strong>${e(item.organization)}</strong><span class="badge ${item.simulated ? 'gray' : 'green'}">${e(item.simulated ? t('donations.badges.example') : t('donations.badges.documented'))}</span></div><p class="meta">${e(item.requestedItems.slice(0, 3).map(mostrarInsumo).join(', '))}</p><div class="badge-row"><span class="badge ${estadoAyudaClase(item.status) === 'delivered' ? 'green' : estadoAyudaClase(item.status) === 'process' ? '' : 'yellow'}">${e(tValue('aidStatus', estadoAyudaCanonico(item.status)))}</span><span class="badge gray">${e(fechaRelativa(item.lastUpdate))}</span></div></article>`).join('') : `<div class="empty-state">${e(t('donations.emptyFiltered'))}</div>`;
    }

    function renderDonationCategoryGrid(selector, group, keys) {
      $(selector).innerHTML = keys.map((key) => `<article class="donation-category-card"><strong>${e(t(`donations.${group}.${key}.title`))}</strong><p class="meta">${e(t(`donations.${group}.${key}.copy`))}</p></article>`).join('');
    }

    function renderDonationTransparency(registros) {
      const last = ultimaActualizacion() || registros.map((item) => item.lastUpdate).filter(Boolean).sort().pop() || '';
      const hasMock = registros.some((item) => item.simulated);
      const source = hasMock && registros.every((item) => item.simulated) ? t('donations.transparency.exampleSource') : t('donations.transparency.platformSource');
      const validation = hasMock ? t('donations.transparency.exampleValidation') : t('donations.transparency.validated');
      const items = [
        [t('donations.transparency.lastUpdate'), last ? fechaRelativa(last) : t('relative.noDate')],
        [t('donations.transparency.source'), source],
        [t('donations.transparency.validation'), validation]
      ];
      $('#donation-transparency').innerHTML = items.map(([label, value]) => `<article class="donation-category-card"><strong>${e(label)}</strong><p class="meta">${e(value)}</p></article>`).join('');
    }

    function animarContadores() {
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $$('[data-counter-target]').forEach((node) => {
        const target = numero(node.dataset.counterTarget);
        if (reduceMotion) {
          node.textContent = String(target);
          return;
        }
        const start = performance.now();
        const duration = 720;
        function step(now) {
          const progress = Math.min(1, (now - start) / duration);
          node.textContent = String(Math.round(target * progress));
          if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }

    function renderDonations() {
      const base = registrosDonaciones();
      poblarEstadosDonacion(base);
      const filtrados = filtrarDonaciones(base);
      $('#donation-filter-count').textContent = t('donations.filters.count', { shown: filtrados.length, total: base.length });
      renderDonationDashboard(filtrados);
      renderDonationUrgent(filtrados);
      renderDonationMap(filtrados);
      renderDonationNeeds(filtrados);
      renderDonationImpact(filtrados);
      renderDonationSections(filtrados);
      renderDonationHistory(filtrados);
      renderDonationCategoryGrid('#donation-in-kind', 'inKind', ['water', 'food', 'medicine', 'medicalEquipment', 'hygiene', 'transport', 'fuel']);
      renderDonationCategoryGrid('#donation-services', 'services', ['transport', 'medicalCare', 'logistics', 'translation', 'communication', 'psychologicalSupport']);
      renderDonationCategoryGrid('#donation-allies', 'allies', ['ngos', 'hospitals', 'universities', 'companies', 'communityCenters']);
      renderDonationTransparency(base);
    }

    function renderRegistrySummaries() {
      const volUltimo = ultimoISO(estado.voluntarios, 'fecha_registro');
      const resUltimo = ultimoISO(estado.rescatistas, 'fecha_registro');
      const voluntariosConTransporte = estado.voluntarios.filter((v) => v.medioTransporte || v.medio_transporte || v.transporte).length;
      const rescatistasConEquipo = estado.rescatistas.filter((r) => r.equipoDisponible || r.equipo_disponible || r.equipo).length;
      const volGrid = $('.volunteer-shell .meta-grid');
      if (volGrid) {
        volGrid.innerHTML = `<span><strong id="vol-resumen-total">${e(estado.voluntarios.length)}</strong> ${e(t('volunteers.registered'))}</span><span><strong id="vol-resumen-zonas">${e(contarUnicos(estado.voluntarios, 'estado'))}</strong> ${e(t('volunteers.zones'))}</span><span><strong id="vol-resumen-transporte">${e(voluntariosConTransporte)}</strong> ${e(t('volunteers.withTransport'))}</span><span><strong id="vol-resumen-actualizado">${e(volUltimo ? fechaRelativa(volUltimo) : t('relative.noDate'))}</strong></span>`;
      }
      const resGrid = $('.rescue-shell .meta-grid');
      if (resGrid) {
        resGrid.innerHTML = `<span><strong id="res-resumen-total">${e(estado.rescatistas.length)}</strong> ${e(t('rescuers.registered'))}</span><span><strong id="res-resumen-especialidades">${e(contarUnicos(estado.rescatistas, 'especialidad'))}</strong> ${e(t('rescuers.specialties'))}</span><span><strong id="res-resumen-equipos">${e(rescatistasConEquipo)}</strong> ${e(t('rescuers.withEquipment'))}</span><span><strong id="res-resumen-actualizado">${e(resUltimo ? fechaRelativa(resUltimo) : t('relative.noDate'))}</strong></span>`;
      }
    }

    function renderUrgentes() {
      const necesidades = [];
      estado.lugares.forEach((lugar) => {
        (lugar.necesita || []).forEach((item) => {
          const cantidad = itemCantidad(item);
          necesidades.push({
            nombre: item.nombre,
            urgencia: item.urgencia,
            faltan: cantidad.faltan,
            unidad: cantidad.unidad,
            lugar: lugar.nombre
          });
        });
      });
      const prioridad = { critico: 0, moderado: 1, normal: 2 };
      const urgentes = necesidades
        .sort((a, b) => (prioridad[normalizar(a.urgencia)] || 3) - (prioridad[normalizar(b.urgencia)] || 3) || b.faltan - a.faltan)
        .slice(0, 6);
      $('#urgent-grid').innerHTML = urgentes.length
        ? urgentes.map((item) => `<div class="urgent-item"><strong>${e(mostrarInsumo(item.nombre))}</strong><span class="badge ${urgenciaClass(item.urgencia)}">${e(mostrarUrgencia(item.urgencia))}</span><span class="meta">${e(t('centers.missing', { count: item.faltan, unit: mostrarUnidad(item.unidad) }))} · ${e(item.lugar)}</span></div>`).join('')
        : `<div class="empty-state">${e(t('urgent.empty'))}</div>`;
    }

    function poblarCategorias() {
      const cats = new Set();
      estado.lugares.forEach((l) => (l.necesita || []).concat(l.tiene_disponible || [], l.cubiertos || []).forEach((i) => i.categoria && cats.add(i.categoria)));
      const sortedCats = Array.from(cats).sort((a, b) => mostrarCategoria(a).localeCompare(mostrarCategoria(b), localeActual()));
      $('#filtro-lugar-categoria').innerHTML = `<option value="">${e(t('common.allFemale'))}</option>` + sortedCats.map((cat) => `<option value="${e(cat)}">${e(mostrarCategoria(cat))}</option>`).join('');
      $('#filtro-lugar-categoria').value = estado.filtros.lugarCategoria;
    }

    function itemCantidad(item) {
      const necesaria = Math.max(0, numero(item.cantidadNecesaria || 1));
      const recibida = Math.max(0, Math.min(numero(item.cantidadRecibida), necesaria));
      const porcentaje = necesaria > 0 ? Math.round((recibida / necesaria) * 100) : numero(item.porcentaje);
      return { necesaria, recibida, porcentaje, faltan: Math.max(0, necesaria - recibida), unidad: item.unidad || 'unidades' };
    }

    function urgenciaClass(u) {
      const n = normalizar(u);
      if (n.indexOf('critico') === 0) return 'red';
      if (n.indexOf('moderado') === 0) return 'yellow';
      return 'green';
    }

    function tipoIcono(tipo) {
      const n = normalizar(tipo);
      if (n.indexOf('hospital') === 0) return 'H';
      if (n.indexOf('refugio') === 0) return 'R';
      return '+';
    }

    function accionesContacto(telefono, nombre) {
      if (!soloDigitos(telefono)) return `<span class="badge gray">${e(t('centers.phonePending'))}</span>`;
      const target = nombre ? (idiomaActual === 'es' ? ` a ${nombre}` : ` ${nombre}`) : '';
      return `<a class="btn btn-soft btn-small" href="${telHref(telefono)}" aria-label="${e(t('a11y.call', { target }))}">${e(t('common.call'))}</a><a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${waHref(telefono)}" aria-label="${e(t('a11y.whatsapp', { target }))}">${e(t('common.whatsapp'))}</a>`;
    }

    function renderLugarCard(lugar) {
      const tipoNormal = normalizar(lugar.tipo);
      const claseLugar = tipoNormal.indexOf('hospital') === 0 ? 'hospital' : tipoNormal.indexOf('refugio') === 0 ? 'refugio' : 'centro';
      const estadoOperativoRaw = lugar.estadoOperativo || (tipoNormal.indexOf('hospital') === 0 ? t('centers.operationalContact') : tipoNormal.indexOf('refugio') === 0 ? (lugar.capacidad || t('centers.capacityPending')) : t('centers.activeCenter'));
      const estadoOperativo = mostrarTextoConUnidades(mostrarEstadoOperativo(estadoOperativoRaw));
      const necesidades = (lugar.necesita || []).map((item) => {
        const c = itemCantidad(item);
        const matches = item.coincidencias || [];
        const itemNombre = mostrarInsumo(item.nombre);
        const plural = matches.length > 1 ? (idiomaActual === 'es' ? 'es' : 's') : '';
        const matchHtml = matches.length ? `<details class="match"><summary>${e(t('centers.availableIn', { count: matches.length, plural }))}</summary><div class="match-body">${matches.map((m) => `<div class="match-place"><strong>${e(m.nombre_lugar)}</strong><p class="meta">${e(mostrarTipo(m.tipo))} · ${e(m.ubicacion)}</p><div class="inline-actions">${accionesContacto(m.telefono, m.nombre_lugar)}</div></div>`).join('')}</div></details>` : '';
        return `<li class="supply-item"><div class="supply-line"><strong>${e(itemNombre)}</strong><span class="badge ${urgenciaClass(item.urgencia)}">${e(mostrarUrgencia(item.urgencia))}</span></div><div class="badge-row"><span class="badge gray">${e(mostrarCategoria(item.categoria))}</span><span class="badge">${e(t('centers.missing', { count: c.faltan, unit: mostrarUnidad(c.unidad) }))}</span></div><div class="progress" role="progressbar" aria-label="${e(t('a11y.progress', { item: itemNombre }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e(c.porcentaje)}"><span style="--value:${e(c.porcentaje)}%"></span></div>${matchHtml}</li>`;
      }).join('');
      const disponibles = (lugar.tiene_disponible || []).map((i) => `<span class="badge green">${e(mostrarInsumo(i.nombre))}</span>`).join('');
      const cubiertos = (lugar.cubiertos || []).map((i) => `<span class="badge green">${e(t('centers.covered', { item: mostrarInsumo(i.nombre) }))}</span>`).join('');
      const tipoBadge = tipoNormal.indexOf('hospital') === 0 ? 'red' : tipoNormal.indexOf('refugio') === 0 ? 'green' : '';
      const iconClass = tipoNormal.indexOf('hospital') === 0 ? 'red' : tipoNormal.indexOf('refugio') === 0 ? 'green' : '';
      return `<article class="card card-bordered place-card ${claseLugar}"><div class="card-top"><div><span class="badge ${tipoBadge}">${e(mostrarTipo(lugar.tipo || 'Centro'))}</span><h3>${e(lugar.nombre)}</h3></div><div class="icon-box ${iconClass}" aria-hidden="true">${tipoIcono(lugar.tipo)}</div></div><div class="meta-grid"><span>${e(lugar.ubicacion || t('centers.locationPending'))}</span><span>${e(estadoOperativo)}</span></div>${necesidades ? `<ul class="supply-list">${necesidades}</ul>` : `<p class="meta">${e(t('centers.noActiveNeeds'))}</p>`}${cubiertos ? `<div class="badge-row">${cubiertos}</div>` : ''}${disponibles ? `<div><p class="meta"><strong>${e(t('centers.hasAvailable'))}</strong></p><div class="badge-row">${disponibles}</div></div>` : ''}<div class="card-actions">${accionesContacto(lugar.telefono, lugar.nombre)}<button class="btn btn-ghost btn-small" type="button" data-historial="${e(lugar.nombre)}">${e(t('common.history'))}</button></div><p class="meta">${e(t('centers.updated', { date: fechaRelativa(lugar.actualizado) }))}</p></article>`;
    }

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
      $('#conteo-lugares').textContent = t('centers.count', { shown: filtered.length, total: estado.lugares.length });
      $('#grid-lugares').innerHTML = filtered.length ? filtered.map(renderLugarCard).join('') : `<div class="empty-state">${e(t('centers.empty'))}</div>`;
      $$('[data-historial]').forEach((btn) => btn.addEventListener('click', () => abrirHistorial(btn.dataset.historial)));
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

    function abrirRegistrarMotorizado() {
      abrirModal(t('modal.driverTitle'), `<form id="mot-form"><div class="form-grid"><div class="field"><label for="mot-nombre">${e(t('common.name'))}</label><input id="mot-nombre" required /></div><div class="field"><label for="mot-tipo">${e(t('common.vehicle'))}</label><select id="mot-tipo"><option value="Moto">${e(mostrarTransporte('Moto'))}</option><option value="Carro">${e(mostrarTransporte('Carro'))}</option><option value="Bicicleta">${e(mostrarTransporte('Bicicleta'))}</option><option value="Camión">${e(mostrarTransporte('Camión'))}</option><option value="Motocarro">${e(mostrarTransporte('Motocarro'))}</option></select></div><div class="field"><label for="mot-telefono">${e(t('common.phone'))}</label><input id="mot-telefono" type="tel" /></div><div class="field"><label for="mot-zona">${e(t('modal.zone'))}</label><input id="mot-zona" required /></div><div class="field"><label for="mot-placa">${e(t('modal.plate'))}</label><input id="mot-placa" /></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">${e(t('modal.saveDriver'))}</button></div></form>`);
      $('#mot-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const nuevo = { nombre: $('#mot-nombre').value.trim(), tipoVehiculo: $('#mot-tipo').value, telefono: $('#mot-telefono').value.trim(), zonaOperacion: $('#mot-zona').value.trim(), operaEn: $('#mot-zona').value.trim(), placa: $('#mot-placa').value.trim() };
        await window.SheetsService.post(Object.assign({ accion: 'registrar_motorizado' }, nuevo));
        await cargarTodo();
        $('#modal-root dialog').close();
        toast(t('messages.driverSaved'));
      });
    }

    function bindForms() {
      $('#lugar-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        if (!validarFormulario(form, '#lugar-message')) return;
        const payload = { accion: 'registrar_lugar', tipo: $('#lugar-tipo').value, nombre: $('#lugar-nombre').value.trim(), ubicacion: $('#lugar-ubicacion').value.trim(), telefono: $('#lugar-telefono').value.trim(), insumo: $('#lugar-insumo').value.trim(), categoria: $('#lugar-categoria').value, estado: $('#lugar-estado').value };
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
        return `<article class="card card-bordered family-card"><span class="badge ${delicado ? 'gray' : 'green'}">${e(mostrarEstadoFamiliar(p.estado))}</span><h3>${e(p.nombre)}</h3><div class="meta-grid"><span><strong>${e(t('family.idLabel'))}</strong> ${e(p.cedula)}</span>${p.ubicacion ? `<span><strong>${e(t('family.locationLabel'))}</strong> ${e(mostrarUbicacionFamiliar(p.ubicacion))}</span>` : ''}${p.fuente ? `<span><strong>${e(t('family.sourceLabel'))}</strong> ${e(mostrarFuente(p.fuente))}</span>` : ''}<span><strong>${e(t('family.updatedLabel'))}</strong> ${e(fechaRelativa(p.actualizado))}</span></div>${delicado ? `<p class="meta">${e(t('family.supportLine'))}</p>` : ''}</article>`;
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
      $$('[data-view-link]').forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); cambiarVista(el.dataset.viewLink); }));
      $$('[data-scroll-target]').forEach((el) => el.addEventListener('click', () => document.getElementById(el.dataset.scrollTarget).scrollIntoView({ behavior: 'smooth', block: 'start' })));
      $('#btn-motorizado').addEventListener('click', abrirRegistrarMotorizado);
    }

    function renderAll() {
      renderStats(); renderDashboard(); renderRegistrySummaries(); renderUrgentes(); poblarCategorias(); renderLugares(); renderVoluntarios(); renderRescatistas(); renderMotorizados(); renderDonations();
    }

    async function cargarTodo() {
      const result = await window.SheetsService.getAll();
      const data = result.data || {};
      estado.lugares = data.lugares || data.centros || [];
      estado.voluntarios = data.voluntarios || [];
      estado.rescatistas = data.rescatistas || [];
      estado.motorizados = data.motorizados || [];
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
      await cargarTodo();
      await cargarSeguimientoDesdeUrl();
      window.addEventListener('hashchange', () => { cargarSeguimientoDesdeUrl(); });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          const dialog = $('#modal-root dialog');
          if (dialog) dialog.close();
        }
      });
    }

    document.addEventListener('DOMContentLoaded', () => { init(); });
