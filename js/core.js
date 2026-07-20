// Modulo generado por modularizacion (build-loop S7). Scope global compartido.
'use strict';

    // -- INTERNACIONALIZACIÓN ----------------------------------------------
    const I18N_DEFAULT_LANGUAGE = 'es';
    const I18N_BASE_URL = 'https://donacionesvenezuela.vercel.app/';
    const I18N_LANGUAGES = {
      es: { label: 'Español', hreflang: 'es', locale: 'es_VE' },
      en: { label: 'English', hreflang: 'en', locale: 'en_US' }
    };
    const i18nCache = {};
    let idiomaActual = I18N_DEFAULT_LANGUAGE;
    let traducciones = {};
    let fuenteDatosActual = 'loading';
    let ultimosFamiliares = null;
    let ultimoSeguimiento = null;
    window.centrosModoActual = window.centrosModoActual || 'ayuda';

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
      setText('label[for="language-select"]', 'language.selectorLabel');
      setAttr('#language-select', 'aria-label', 'language.selectorAria');
      setText('#btn-panel-centro', 'panel.manageCta');
      setText('#btn-cerca-texto', 'centers.nearbyCta');
      setText('#btn-geo-lugar', 'panel.useMyLocation');
      setText('label[for="lugar-coords"]', 'panel.coordsLabel');
      setText('#reportar-persona-summary', 'family.reportTitle');
      setText('#reportar-persona-copy', 'family.reportCopy');
      setText('label[for="per-nombre"]', 'family.reportName');
      setText('label[for="per-cedula"]', 'family.reportId');
      setText('label[for="per-estado"]', 'family.reportStatus');
      setText('label[for="per-ubicacion"]', 'family.reportLocation');
      setText('label[for="per-contacto"]', 'family.reportContact');
      setText('label[for="per-fuente"]', 'family.reportSource');
      setPlaceholder('#per-fuente', 'family.reportSourcePh');
      setText('#per-guardar', 'family.reportCta');
      aplicarOpciones('#per-estado', {
        'Localizado con vida': ['familyStatus', 'Localizado con vida'],
        'Hospitalizado': ['familyStatus', 'Hospitalizado'],
        'En refugio': ['familyStatus', 'En refugio'],
        'Sin información reciente': ['familyStatus', 'Sin información reciente'],
        'Fallecido': ['familyStatus', 'Fallecido']
      });

      // Home de 4 puertas
      setText('#home-question', 'home.question');
      setText('#home-sub', 'home.sub');
      setText('#door-ayuda-title', 'home.doors.ayuda.title');
      setText('#door-ayuda-copy', 'home.doors.ayuda.copy');
      setText('#door-ayudar-title', 'home.doors.ayudar.title');
      setText('#door-ayudar-copy', 'home.doors.ayudar.copy');
      setText('#door-transporte-title', 'home.doors.transporte.title');
      setText('#door-transporte-copy', 'home.doors.transporte.copy');
      setText('#door-centro-title', 'home.doors.centro.title');
      setText('#door-centro-copy', 'home.doors.centro.copy');
      setText('#door-necesidad-title', 'home.doors.necesidad.title');
      setText('#door-necesidad-copy', 'home.doors.necesidad.copy');
      setText('#door-acceso-title', 'home.doors.acceso.title');
      setText('#door-acceso-copy', 'home.doors.acceso.copy');
      setText('#home-foot-q', 'home.footQuestion');
      setText('#home-foot-link', 'home.footLink');
      setText('#btn-volver-texto', 'home.back');
      setAttr('#btn-volver', 'aria-label', 'home.back');

      // Puerta 2 · Quiero ayudar
      setText('#ayudar-hub-title', 'helpHub.title');
      setText('#ayudar-hub-copy', 'helpHub.copy');
      setText('#help-donar-title', 'helpHub.donateTitle');
      setText('#help-donar-copy', 'helpHub.donateCopy');
      setText('#help-voluntario-title', 'helpHub.volunteerTitle');
      setText('#help-voluntario-copy', 'helpHub.volunteerCopy');
      setText('#help-ofrecer-title', 'helpHub.offerTitle');
      setText('#help-ofrecer-copy', 'helpHub.offerCopy');
      setText('#ofrecer-title', 'offer.pageTitle');
      setText('#ofrecer-page-copy', 'offer.pageCopy');
      setText('#donar-dinero-title', 'money.modalTitle');
      setText('#btn-rescatista-texto', 'helpHub.rescuerCta');
      setText('#reportar-summary', 'helpHub.reportSummary');
      setText('#form-lugar-copy', 'centers.formCopy');

      // Puerta · Donar a una necesidad
      setText('#necesidades-title', 'needs.title');
      setText('#necesidades-copy', 'needs.copy');
      setPlaceholder('#filtro-necesidad-q', 'needs.searchPlaceholder');
      setText('#presupuestos-title', 'needs.budgetsTitle');
      setText('#presupuestos-copy', 'needs.budgetsCopy');
      setText('#necesidades-insumos-title', 'needs.inKindTitle');
      setText('#btn-home-admin', 'home.adminCta');
      setText('#comprados-title', 'cycle.title');
      setText('#comprados-copy', 'cycle.copy');
      setText('#ofertas-title', 'offer.listTitle');
      setText('#ofertas-copy', 'offer.listCopy');

      // Puerta · Registrarme o entrar
      setText('#acceso-title', 'access.title');
      setText('#acceso-copy', 'access.copy');
      setText('#acceso-transportista-title', 'access.driverTitle');
      setText('#acceso-transportista-copy', 'access.driverCopy');
      setText('#btn-acceso-transportista', 'access.driverCta');
      setText('#acceso-voluntario-title', 'access.volunteerTitle');
      setText('#acceso-voluntario-copy', 'access.volunteerCopy');
      setText('#btn-acceso-voluntario', 'access.volunteerCta');
      setText('#acceso-centro-title', 'access.centerTitle');
      setText('#acceso-centro-copy', 'access.centerCopy');
      setText('#btn-acceso-panel', 'access.centerCta');
      setText('#btn-acceso-crear-centro', 'access.centerCreateCta');
      setText('#acceso-login-title', 'access.loginTitle');
      setText('#acceso-login-copy', 'access.loginCopy');
      setText('label[for="acceso-email"]', 'common.email');
      setText('#acceso-enviar-btn', 'access.sendCode');
      setText('label[for="acceso-codigo"]', 'access.codeLabel');
      setText('#acceso-entrar-btn', 'access.enter');
      setText('#acceso-otro-correo', 'access.changeEmail');
      setText('#btn-acceso-entrar-transportista', 'access.loginCta');
      setText('#btn-acceso-entrar-voluntario', 'access.loginCta');
      setText('#btn-acceso-entrar-centro', 'access.centerRecoverCta');

      // Puerta 3 · Transportistas
      setText('#transporte-title', 'transportHub.title');
      setText('#transporte-copy', 'transportHub.copy');
      setText('#transporte-registro-title', 'transportHub.registerTitle');
      setText('#transporte-registro-copy', 'transportHub.registerCopy');
      setText('#traslados-title', 'transfers.title');
      setText('#traslados-copy', 'transfers.copy');

      // Puerta 4 · Centros y equipos
      setText('#centro-hub-title', 'centerHub.title');
      setText('#centro-hub-copy', 'centerHub.copy');
      setText('#centro-panel-title', 'centerHub.panelTitle');
      setText('#centro-panel-copy', 'centerHub.panelCopy');
      setText('#btn-panel-centro', 'centerHub.panelCta');
      setText('#centro-crear-title', 'centerHub.createTitle');
      setText('#centro-crear-copy', 'centerHub.createCopy');
      setText('#btn-crear-centro', 'centerHub.createCta');
      setText('#centro-admin-note', 'centerHub.adminNote');

      // Puerta 1 · Centros cerca. #donaciones queda como alias histórico;
      // #ayuda y #donar expresan la intención de la persona.
      const modoCentros = window.centrosModoActual === 'donar' ? 'donar' : 'ayuda';
      setText('#donaciones-title', `centers.${modoCentros}Title`);
      setText('#donaciones-copy', `centers.${modoCentros}Copy`);
      setText('#buscar-familiar-prompt', 'centers.findFamilyPrompt');
      setText('#btn-mapa-toggle', 'centers.mapToggle');
      setText('#filtros-extra-summary', 'centers.filtersSummary');
      setText('#btn-buscar-familiar-texto', 'centers.findFamilyCta');
      const modeLink = $('#centers-mode-link');
      if (modeLink) {
        const siguienteModo = modoCentros === 'donar' ? 'ayuda' : 'donar';
        modeLink.href = '#' + siguienteModo;
        modeLink.dataset.viewLink = siguienteModo;
        setText('#centers-mode-link-text', `centers.switchTo${modoCentros === 'donar' ? 'Help' : 'Donate'}`);
      }
      setText('#centers-search-label', 'centers.searchLabel');
      setText('#centers-trust-note-text', 'centers.confirmBeforeGoing');
      const geoStatus = $('#centros-geo-status');
      if (geoStatus && geoStatus.dataset.i18nKey) geoStatus.textContent = t(geoStatus.dataset.i18nKey);
      setAttr('#center-filter-controls', 'aria-label', 'a11y.centerFilters');
      setAttr('#mapa-centros', 'aria-label', 'centers.mapAria');
      setAttr('#filtro-lugar-q', 'aria-label', 'common.search');
      setPlaceholder('#filtro-lugar-q', 'centers.searchPlaceholder');
      setText('label[for="filtro-lugar-tipo"]', 'centers.typeFilterLabel');
      setText('label[for="filtro-lugar-categoria"]', 'common.category');
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

      setText('#voluntarios-title', 'vacancies.title');
      setText('#voluntarios-title + .section-copy', 'vacancies.copy');
      setText('#vac-kpi-cupos-lbl', 'vacancies.kpiMissing');
      setText('#vac-kpi-urgentes-lbl', 'vacancies.kpiUrgent');
      setText('#vac-kpi-lugares-lbl', 'vacancies.kpiPlaces');
      setText('label[for="filtro-vac-q"]', 'vacancies.searchLabel');
      setPlaceholder('#filtro-vac-q', 'vacancies.searchPlaceholder');
      setText('label[for="filtro-vac-tipo"]', 'vacancies.placeTypeLabel');
      setText('label[for="filtro-vac-urgencia"]', 'panel.urgency');
      aplicarOpciones('#filtro-vac-tipo', {
        'Centro': ['types', 'Centro'],
        'Hospital': ['types', 'Hospital'],
        'Refugio': ['types', 'Refugio'],
        'Zona de derrumbe': ['types', 'Zona de derrumbe']
      });
      aplicarOpciones('#filtro-vac-urgencia', {
        'Alta': ['urgency', 'Alta'],
        'Normal': ['urgency', 'Normal'],
        'Baja': ['urgency', 'Baja']
      });
      setText('#vol-registro-summary', 'vacancies.registerSummary');
      setText('#vol-form-title', 'volunteers.formTitle');
      setText('#vol-form-title + .section-copy', 'volunteers.formCopy');
      setText('label[for="vol-nombre"]', 'common.name');
      setText('label[for="vol-apellido"]', 'common.lastName');
      setText('label[for="vol-telefono"]', 'common.phone');
      setText('label[for="vol-email"]', 'common.email');
      // Paso de cámara de la cédula (inyectado por bindForms): sus textos también
      // se re-rotulan al cambiar de idioma, sin perder la foto tomada (R1.3/R1.4).
      setText('#vol-cedula-field > label', 'volunteers.idPhoto');
      setText('#vol-cedula-field > .section-copy', 'volunteers.idPhotoHelp');
      setText('#vol-cedula-field .cam-guia-texto', 'offer.idGuide');
      setText('label[for="vol-ciudad"]', 'volunteers.parish');
      setPlaceholder('#vol-ciudad', 'volunteers.parishPlaceholder');
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
      setAttr('#view-voluntarios .filters', 'aria-label', 'a11y.volunteerFilters');

      setText('#rescatistas-title', 'rescuers.title');
      setText('#rescatistas-title + .section-copy', 'rescuers.copy');
      setText('#res-list-title', 'rescuers.privateTitle');
      setText('#res-list-title + .section-copy', 'rescuers.privateCopy');
      setText('#res-private-title', 'rescuers.privateAdminTitle');
      setText('#res-private-copy', 'rescuers.privateAdminCopy');
      setText('#btn-rescatista-admin', 'rescuers.privateAdminCta');
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

    // Cambiar de idioma no puede costarle al usuario lo que ya escribió. Los
    // modales se pintan con innerHTML, así que hay que reconstruirlos en el
    // idioma nuevo y devolverles su estado: valores, fotos y paso del asistente.
    let reabrirModal = null;
    function recordarModal(fn) { reabrirModal = fn; }

    function guardarEstadoModal(dialog) {
      const valores = {};
      dialog.querySelectorAll('input, select, textarea').forEach((c) => {
        if (c.id && c.type !== 'file') valores[c.id] = c.value;
      });
      const fotos = {};
      dialog.querySelectorAll('.of-cam').forEach((cam) => {
        if (cam.id && cam.__camara) fotos[cam.id] = cam.__camara.fotos.slice();
      });
      const form = dialog.querySelector('form');
      const paso = form && form.__wiz ? form.__wiz.pasoActual() : null;
      return { valores, fotos, paso };
    }

    function restaurarEstadoModal(estado) {
      const dialog = $('#modal-root dialog');
      if (!dialog || !estado) return;
      Object.keys(estado.valores).forEach((id) => {
        const control = document.getElementById(id);
        if (control) control.value = estado.valores[id];
      });
      Object.keys(estado.fotos).forEach((id) => {
        const cam = document.getElementById(id);
        if (cam && cam.__camara && estado.fotos[id].length) {
          cam.__camara.fotos.push.apply(cam.__camara.fotos, estado.fotos[id]);
          cam.__camara.pintar();
        }
      });
      const form = dialog.querySelector('form');
      if (form && form.__wiz && estado.paso != null) form.__wiz.irA(estado.paso);
    }

    // -- SESIÓN DE USUARIO (persistente entre pestañas y recargas) ---------
    // Guarda la sesión OTP de Supabase Auth: tokens + email + nombre + roles.
    // Se usa localStorage (no sessionStorage) para que «usar la app sin
    // problemas» no exija pedir otro código en cada recarga. NUNCA se guarda
    // el PIN de un centro ni el código OTP.
    const SESION_KEY = 'dv-sesion';
    function guardarSesion(datos) {
      try { localStorage.setItem(SESION_KEY, JSON.stringify(datos)); } catch (err) { /* modo privado */ }
      pintarBotonSesion();
    }
    function sesionActual() {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); } catch (err) { return null; }
      return (s && s.access_token) ? s : null;
    }
    async function sesionValida() {
      const s = sesionActual();
      if (!s) return null;
      if (Date.now() / 1000 < (Number(s.expires_at) || 0) - 60) return s;
      try {
        const fresca = await window.SheetsService.refrescarSesion(s.refresh_token);
        const unida = Object.assign({}, s, fresca);
        guardarSesion(unida);
        return unida;
      } catch (err) { cerrarSesion(); return null; }
    }
    function cerrarSesion() {
      try { localStorage.removeItem(SESION_KEY); } catch (err) { /* modo privado */ }
      pintarBotonSesion();
    }
    function nombreSesion(s) {
      if (!s) return '';
      if (s.nombre) return s.nombre;
      const conNombre = (s.roles || []).find((r) => r.nombre);
      if (conNombre) return conNombre.nombre;
      return String(s.email || '').split('@')[0];
    }
    function pintarBotonSesion() {
      const btn = $('#btn-sesion');
      if (!btn) return;
      const s = sesionActual();
      btn.hidden = false;
      btn.textContent = s ? nombreSesion(s) : t('session.login');
      btn.setAttribute('aria-haspopup', s ? 'dialog' : 'false');
    }
    function filaRolSesion(r) {
      if (r.tipo === 'transportista') return `<li><strong>${e(t('access.driverTitle'))}</strong> · ${e(r.nombre)} — <a href="#transporte">${e(t('access.goDriver'))}</a></li>`;
      if (r.tipo === 'voluntario') return `<li><strong>${e(t('access.volunteerTitle'))}</strong> · ${e(r.nombre)} — <a href="#voluntarios">${e(t('access.goVolunteer'))}</a></li>`;
      return `<li><strong>${e(t('access.centerTitle'))}</strong> · ${e(r.nombre)} — <a href="/panel-centro?token=${e(encodeURIComponent(r.token || ''))}">${e(t('access.goCenter'))}</a></li>`;
    }
    function abrirMenuSesion() {
      const s = sesionActual();
      if (!s) { window.location.hash = '#acceso'; return; }
      const filas = (s.roles || []).map(filaRolSesion).join('');
      const roles = filas ? `<ul class="acceso-roles">${filas}</ul>` : `<p class="meta">${e(t('session.noRoles'))}</p>`;
      const html = `
        <p class="meta">${e(t('access.signedInAs', { email: s.email }))}</p>
        ${roles}
        <p class="centro-detail-heading">${e(t('session.registerHeading'))}</p>
        <ul class="acceso-roles session-register">
          <li><a href="#voluntarios">${e(t('session.registerVolunteer'))}</a></li>
          <li><a href="#acceso">${e(t('session.registerDriver'))}</a></li>
          <li><a href="/crear-centro">${e(t('session.createCenter'))}</a></li>
          <li><a href="#familiar">${e(t('session.reportPerson'))}</a></li>
        </ul>
        <div class="form-actions"><button class="btn btn-ghost" type="button" id="session-logout">${e(t('session.logout'))}</button></div>`;
      abrirModal(t('session.menuTitle'), html);
      recordarModal(abrirMenuSesion); // sobrevive al cambio de idioma (R1.3/R1.4)
      const salir = $('#session-logout');
      if (salir) salir.addEventListener('click', () => {
        cerrarSesion();
        const dlg = $('#modal-root dialog');
        if (dlg) dlg.close();
        toast(t('access.signedOut'));
      });
    }
    window.sesionActual = sesionActual;
    window.sesionValida = sesionValida;
    window.guardarSesion = guardarSesion;
    window.cerrarSesion = cerrarSesion;
    window.pintarBotonSesion = pintarBotonSesion;
    window.abrirMenuSesion = abrirMenuSesion;

    async function cambiarIdioma(lang, options) {
      const nextLang = normalizarIdioma(lang);
      const shouldPersist = !options || options.persist !== false;
      document.body.classList.add('is-translating');
      idiomaActual = nextLang;
      traducciones = await cargarTraducciones(nextLang);
      const modalAbierto = $('#modal-root dialog');
      // Si el modal sabe reconstruirse, se salva lo que el usuario llevaba dentro.
      const estadoModal = modalAbierto && reabrirModal ? guardarEstadoModal(modalAbierto) : null;
      const rehacerModal = estadoModal ? reabrirModal : null;
      if (modalAbierto && rehacerModal) {
        // OJO: dialog.close() emite su evento «close» de forma ASÍNCRONA, y ese
        // manejador vacía #modal-root — llegaría tarde y borraría el modal ya
        // reconstruido. Se reemplaza sin cerrarlo, apagando antes las cámaras
        // (de eso se encargaba el manejador de cierre).
        modalAbierto.querySelectorAll('.of-cam').forEach((cam) => {
          if (cam.__camara) cam.__camara.parar();
        });
      } else if (modalAbierto) {
        modalAbierto.close();
      }
      if (shouldPersist) sincronizarUrlIdioma(nextLang);
      const select = $('#language-select');
      if (select) select.value = nextLang;
      actualizarSeo();
      aplicarTraduccionesEstaticas();
      window.dispatchEvent(new CustomEvent('dv-language-change', { detail: { language: nextLang } }));
      setStatus(fuenteDatosActual);
      renderAll();
      // Lo pintado con innerHTML no se traduce solo: hay que reconstruirlo.
      if (typeof window.reconstruirOfrecer === 'function') window.reconstruirOfrecer();
      if (typeof window.reconstruirDonarDinero === 'function') window.reconstruirDonarDinero();
      if (typeof wizRetraducirTodos === 'function') wizRetraducirTodos();
      pintarBotonSesion();
      if (rehacerModal) { rehacerModal(); restaurarEstadoModal(estadoModal); }
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
      window.dispatchEvent(new CustomEvent('dv-language-change', { detail: { language: idiomaActual } }));
    }

    // ── CONFIGURACIÓN ─────────────────────────────────────────
    const SUPABASE_URL = 'https://zryfwbjvlacorryzdaod.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_T7fK4bKb1f3o9b7z84IbxQ_1HMnEi56'; // clave pública (publishable), segura en el cliente

    const estado = {
      lugares: [], voluntarios: [], rescatistas: [], motorizados: [], traslados: [], donacionesHumanitarias: [], estadisticas: {},
      presupuestos: [], comprados: [], ofertas: [], vacantes: [],
      filtros: {
        lugarQ: '', lugarTipo: 'todos', lugarCategoria: '', necesidadQ: '',
        vacQ: '', vacTipo: '', vacUrgencia: '',
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
    const waHref = (tel, messageKey) => `https://wa.me/${soloDigitos(tel)}?text=${encodeURIComponent(t(messageKey || 'messages.whatsappText'))}`;
    const telHref = (tel) => `tel:${String(tel || '').replace(/[^0-9+]/g, '')}`;
    const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const formatearMonto = (value) => new Intl.NumberFormat(localeActual(), { maximumFractionDigits: 2 }).format(numero(value));
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

    window.SheetsService.configure({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });

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
      const aliasCentros = { ayuda: 'donaciones', donar: 'donaciones' };
      const vistaReal = aliasCentros[view] || view;
      const target = $(`.view[data-view="${vistaReal}"]`) ? vistaReal : 'inicio';
      if (aliasCentros[view] && typeof window.establecerModoCentros === 'function') {
        window.establecerModoCentros(view === 'donar' ? 'donar' : 'ayuda');
      }
      $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.view === target));
      $$('[data-view-link]').forEach((btn) => {
        const active = btn.dataset.viewLink === view || btn.dataset.viewLink === target;
        if (btn.tagName === 'BUTTON') btn.setAttribute('aria-current', active ? 'page' : 'false');
      });
      const volver = $('#btn-volver');
      if (volver) volver.hidden = target === 'inicio';
      $('#contenido').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // Editor visual local: permite ajustar textos, placeholders y etiquetas
    // accesibles sin tocar la lógica de datos. Los cambios se guardan en el
    // navegador para que también sobrevivan a los rerenders de cada vista.
    const EDITOR_STORAGE_KEY = 'dv-editor-overrides-v1';
    let editorApplyingOverrides = false;

    function leerOverridesEditor() {
      try { return JSON.parse(localStorage.getItem(EDITOR_STORAGE_KEY) || '{}') || {}; }
      catch (_) { return {}; }
    }

    function guardarOverridesEditor(overrides) {
      try { localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(overrides)); return true; }
      catch (_) { return false; }
    }

    function textoDirectoEditor(el) {
      if (!el) return null;
      return Array.from(el.childNodes || []).find((node) => node.nodeType === Node.TEXT_NODE && String(node.nodeValue || '').trim()) || null;
    }

    function destinoTextoEditor(el) {
      if (!el || /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName)) return el;
      if (textoDirectoEditor(el)) return el;
      const leaf = Array.from(el.querySelectorAll ? el.querySelectorAll('*') : [])
        .find((node) => textoDirectoEditor(node) || (!node.children.length && String(node.textContent || '').trim()));
      return leaf || el;
    }

    function leerTextoEditor(el) {
      if (!el) return '';
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return el.getAttribute('placeholder') || '';
      const direct = textoDirectoEditor(el);
      return direct ? String(direct.nodeValue || '').trim() : String(el.textContent || '').trim();
    }

    function aplicarTextoEditor(el, value) {
      if (!el) return;
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        if (value) el.setAttribute('placeholder', value);
        else el.removeAttribute('placeholder');
        return;
      }
      const direct = textoDirectoEditor(el);
      if (direct) {
        const original = String(direct.nodeValue || '');
        const prefix = (original.match(/^\s*/) || [''])[0];
        const suffix = (original.match(/\s*$/) || [''])[0];
        direct.nodeValue = prefix + value + suffix;
      }
      else if (!el.children.length) el.textContent = value;
      else el.textContent = value;
    }

    function aplicarOverrideEditor(entry) {
      if (!entry || !entry.selector) return;
      let el;
      try { el = document.querySelector(entry.selector); } catch (_) { return; }
      if (!el) return;
      let textTarget = el;
      if (entry.targetSelector) {
        try { textTarget = document.querySelector(entry.targetSelector) || el; } catch (_) { textTarget = el; }
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'text')) aplicarTextoEditor(textTarget, entry.text);
      if (Object.prototype.hasOwnProperty.call(entry, 'placeholder') && /^(INPUT|TEXTAREA)$/.test(el.tagName)) aplicarTextoEditor(el, entry.placeholder);
      if (Object.prototype.hasOwnProperty.call(entry, 'ariaLabel')) {
        if (entry.ariaLabel) el.setAttribute('aria-label', entry.ariaLabel);
        else el.removeAttribute('aria-label');
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'title')) {
        if (entry.title) el.setAttribute('title', entry.title);
        else el.removeAttribute('title');
      }
    }

    function aplicarOverridesEditor() {
      if (editorApplyingOverrides) return;
      editorApplyingOverrides = true;
      try { Object.values(leerOverridesEditor()).forEach(aplicarOverrideEditor); }
      finally { window.setTimeout(() => { editorApplyingOverrides = false; }, 0); }
    }

    function iniciarObservadorEditor() {
      if (window.__dvEditorObserver || !document.body || !window.MutationObserver) return;
      window.__dvEditorObserver = new MutationObserver((records) => {
        if (editorApplyingOverrides || !records.some((record) => record.addedNodes.length)) return;
        window.clearTimeout(window.__dvEditorApplyTimer);
        window.__dvEditorApplyTimer = window.setTimeout(aplicarOverridesEditor, 0);
      });
      window.__dvEditorObserver.observe(document.body, { childList: true, subtree: true });
    }

    window.DVEditor = window.DVEditor || {};
    window.DVEditor.apply = aplicarOverridesEditor;
    window.DVEditor.clear = function () {
      try { localStorage.removeItem(EDITOR_STORAGE_KEY); } catch (_) { /* almacenamiento bloqueado */ }
    };
    window.addEventListener('dv-language-change', aplicarOverridesEditor);

    function initEditAssistant() {
      if (document.getElementById('edit-assistant')) return;

      const ui = document.createElement('div');
      ui.id = 'edit-assistant';
      ui.className = 'edit-assistant';
      ui.innerHTML = `
        <button class="edit-assistant-btn" id="edit-screen-btn" type="button" aria-pressed="false" title="Copiar la pantalla activa para pedir cambios">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-13Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span class="label">Copiar pantalla</span>
        </button>
        <button class="edit-assistant-btn" id="edit-pick-btn" type="button" aria-pressed="false" title="Seleccionar cualquier elemento para pedir un cambio">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4l6.8 16 2.2-6 6-2.2L4 4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 13l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span class="label">Seleccionar elemento</span>
        </button>`;
      document.body.appendChild(ui);

      const mark = document.createElement('div');
      mark.className = 'edit-assistant-mark';
      mark.id = 'edit-assistant-mark';
      mark.innerHTML = '<span class="edit-assistant-tag" id="edit-assistant-tag"></span>';
      document.body.appendChild(mark);

      const pop = document.createElement('div');
      pop.className = 'edit-assistant-pop';
      pop.id = 'edit-assistant-pop';
      pop.innerHTML = `
        <h3>Editar elemento</h3>
        <p class="edit-assistant-selector" id="edit-assistant-selector"></p>
        <p class="edit-assistant-preview" id="edit-assistant-preview"></p>
        <label class="edit-assistant-field">Texto visible o placeholder
          <input id="edit-assistant-value" type="text" autocomplete="off" />
        </label>
        <label class="edit-assistant-field">Etiqueta accesible (opcional)
          <input id="edit-assistant-aria" type="text" autocomplete="off" placeholder="Cómo debe anunciarse" />
        </label>
        <textarea id="edit-assistant-note" placeholder="Describe el cambio que quieres hacer aquí..."></textarea>
        <div class="edit-assistant-actions">
          <button class="btn btn-ghost btn-small" type="button" id="edit-assistant-cancel">Cancelar</button>
          <button class="btn btn-primary btn-small" type="button" id="edit-assistant-save">Guardar cambio</button>
          <button class="btn btn-primary btn-small" type="button" id="edit-assistant-copy">Copiar prompt</button>
        </div>`;
      document.body.appendChild(pop);

      const screenBtn = $('#edit-screen-btn');
      const pickBtn = $('#edit-pick-btn');
      const tag = $('#edit-assistant-tag');
      const selectorNode = $('#edit-assistant-selector');
      const previewNode = $('#edit-assistant-preview');
      const valueNode = $('#edit-assistant-value');
      const ariaNode = $('#edit-assistant-aria');
      const noteNode = $('#edit-assistant-note');
      let inspectMode = false;
      let picked = null;
      let pickedPath = '';
      let pickedTarget = null;
      let pickedTargetPath = '';

      function editToast(msg) {
        if (typeof toast === 'function') {
          toast(msg);
          return;
        }
        const root = $('#toast-root');
        if (!root) return;
        root.innerHTML = `<div class="toast" role="status">${e(msg)}</div>`;
        window.setTimeout(() => { root.innerHTML = ''; }, 2800);
      }

      function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          editToast('Prompt copiado. Pégalo en el chat.');
        } catch (err) {
          editToast('No se pudo copiar automáticamente.');
        }
        document.body.removeChild(ta);
      }

      function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(() => editToast('Prompt copiado. Pégalo en el chat.'))
            .catch(() => fallbackCopy(text));
          return;
        }
        fallbackCopy(text);
      }

      function compactText(value, max) {
        const clean = String(value || '').replace(/\s+/g, ' ').trim();
        return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
      }

      function cssIdent(value) {
        if (window.CSS && CSS.escape) return CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      }

      function classSummary(el) {
        if (!el || !el.classList || !el.classList.length) return '';
        return Array.from(el.classList).slice(0, 4).join('.');
      }

      function cssPath(el) {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
          if (node.id) {
            parts.unshift('#' + cssIdent(node.id));
            break;
          }
          let part = node.tagName.toLowerCase();
          const cls = classSummary(node);
          if (cls) part += '.' + cls.split('.').map(cssIdent).join('.');
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((sibling) => sibling.tagName === node.tagName)
            : [];
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      }

      function isOwnUi(el) {
        return !!(el && el.closest('.edit-assistant,.edit-assistant-mark,.edit-assistant-pop,#toast-root,#modal-root,dialog'));
      }

      function activeView() {
        return $('.view.active') || $('main');
      }

      function contextLabel(el) {
        const context = el && el.closest('section, article, form, .card, .gate-card, .donation-panel, .door, .view');
        if (!context) return '';
        const id = context.id ? '#' + context.id : '';
        const data = context.dataset && (context.dataset.view || context.dataset.pantalla || context.dataset.puerta);
        const heading = context.querySelector && context.querySelector('h1, h2, h3, .door-title, .centro-nombre');
        const name = heading ? compactText(heading.textContent, 80) : '';
        return [context.tagName ? context.tagName.toLowerCase() : '', id, data ? '[' + data + ']' : '', name].filter(Boolean).join(' ');
      }

      function domSnippet(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('script, style, svg, img, input[type="file"]').forEach((node) => node.remove());
        return compactText(clone.outerHTML || clone.textContent || '', 1600);
      }

      function buildElementPrompt(changeText) {
        const view = activeView();
        const visibleText = compactText(picked ? picked.innerText || picked.textContent : '', 500);
        return [
          'EDITAR ELEMENTO EN DONACIONES VENEZUELA',
          '------------------------------------------------',
          'URL: ' + location.href,
          'Vista activa: ' + (view ? cssPath(view) : '(sin vista)'),
          'Contexto: ' + contextLabel(picked),
          'Selector CSS: ' + pickedPath,
          'Elemento: <' + picked.tagName.toLowerCase() + '>' + (picked.className && typeof picked.className === 'string' ? ' class="' + picked.className + '"' : ''),
          'Texto visible: ' + (visibleText || '(sin texto visible)'),
          'HTML resumido: ' + domSnippet(picked),
          '------------------------------------------------',
          'Cambio pedido: ' + (changeText || '(describe el cambio aquí)'),
          '------------------------------------------------',
          'Notas técnicas:',
          '- Mantener vanilla HTML/CSS/JS, sin frameworks ni npm.',
          '- Archivos esperados: index.html, css/app.css, js/core.js/js/vistas.js/js/panel.js/js/admin.js según corresponda.',
          '- Todo valor dinámico insertado con innerHTML debe pasar por e().',
          '- Si se cambian assets estáticos, subir versiones en index.html y sw.js.'
        ].join('\n');
      }

      function buildScreenPrompt() {
        const view = activeView();
        const title = view ? (view.querySelector('h1, h2') || view).textContent : '';
        return [
          'EDITAR PANTALLA EN DONACIONES VENEZUELA',
          '------------------------------------------------',
          'URL: ' + location.href,
          'Vista activa: ' + (view ? cssPath(view) : '(sin vista)'),
          'Título/contexto: ' + compactText(title, 120),
          'Texto visible:',
          compactText(view ? view.innerText : document.body.innerText, 1800),
          '------------------------------------------------',
          'Cambio pedido: (describe aquí lo que quieres cambiar en esta pantalla)',
          '------------------------------------------------',
          'Notas técnicas:',
          '- Mantener vanilla HTML/CSS/JS, sin frameworks ni npm.',
          '- No tocar Supabase ni datos si el cambio es solo visual.',
          '- Si se cambian assets estáticos, subir versiones en index.html y sw.js.'
        ].join('\n');
      }

      function highlight(el) {
        if (!el || isOwnUi(el) || el === document.body || el === document.documentElement) {
          mark.style.display = 'none';
          return;
        }
        const r = el.getBoundingClientRect();
        mark.style.display = 'block';
        mark.style.left = r.left + 'px';
        mark.style.top = r.top + 'px';
        mark.style.width = r.width + 'px';
        mark.style.height = r.height + 'px';
        tag.textContent = cssPath(el);
      }

      function elementAt(ev) {
        return document.elementFromPoint(ev.clientX, ev.clientY);
      }

      function onMove(ev) {
        highlight(elementAt(ev));
      }

      function positionPop(ev) {
        const width = Math.min(380, window.innerWidth - 24);
        pop.style.left = Math.max(12, Math.min(ev.clientX, window.innerWidth - width - 12)) + 'px';
        pop.style.top = Math.max(12, Math.min(ev.clientY + 12, window.innerHeight - 430)) + 'px';
      }

      function onPick(ev) {
        const el = elementAt(ev);
        if (!el || isOwnUi(el)) return;
        ev.preventDefault();
        ev.stopPropagation();
        picked = el;
        pickedPath = cssPath(el);
        pickedTarget = destinoTextoEditor(el);
        pickedTargetPath = pickedTarget && pickedTarget !== picked ? cssPath(pickedTarget) : '';
        selectorNode.textContent = pickedPath;
        const text = compactText(el.innerText || el.textContent || '', 150);
        previewNode.textContent = text ? '“' + text + '”' : '(sin texto visible)';
        const esSelect = el.tagName === 'SELECT';
        valueNode.disabled = esSelect;
        valueNode.value = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? (el.getAttribute('placeholder') || '') : (esSelect ? '' : leerTextoEditor(pickedTarget));
        ariaNode.value = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        noteNode.value = '';
        pop.style.display = 'block';
        positionPop(ev);
        noteNode.focus();
      }

      function guardarCambio() {
        if (!picked) return;
        const overrides = leerOverridesEditor();
        const entry = overrides[pickedPath] || { selector: pickedPath };
        entry.targetSelector = pickedTargetPath;
        if (/^(INPUT|TEXTAREA)$/.test(picked.tagName)) entry.placeholder = valueNode.value;
        else if (picked.tagName !== 'SELECT') {
          entry.text = valueNode.value;
          if (pickedTarget) aplicarTextoEditor(pickedTarget, valueNode.value);
        }
        entry.ariaLabel = ariaNode.value.trim();
        entry.title = ariaNode.value.trim();
        overrides[pickedPath] = entry;
        if (!guardarOverridesEditor(overrides)) {
          editToast('No se pudo guardar el cambio en este dispositivo.');
          return;
        }
        aplicarOverrideEditor(entry);
        editToast('Cambio guardado en este dispositivo.');
        pop.style.display = 'none';
        if (inspectMode) setInspectMode(false);
      }

      function setInspectMode(on) {
        inspectMode = on;
        document.body.classList.toggle('edit-inspect-mode', on);
        pickBtn.classList.toggle('is-active', on);
        pickBtn.setAttribute('aria-pressed', String(on));
        pickBtn.querySelector('.label').textContent = on ? 'Listo' : 'Seleccionar elemento';
        mark.style.display = 'none';
        if (!on) pop.style.display = 'none';
        if (on) {
          editToast('Haz clic en cualquier elemento para pedir un cambio.');
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('click', onPick, true);
        } else {
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('click', onPick, true);
        }
      }

      screenBtn.addEventListener('click', () => {
        document.body.classList.toggle('edit-screen-mode');
        const active = document.body.classList.contains('edit-screen-mode');
        screenBtn.classList.toggle('is-active', active);
        screenBtn.setAttribute('aria-pressed', String(active));
        copyText(buildScreenPrompt());
      });

      pickBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setInspectMode(!inspectMode);
      });

      $('#edit-assistant-cancel').addEventListener('click', () => {
        pop.style.display = 'none';
        if (inspectMode) setInspectMode(false);
      });

      $('#edit-assistant-copy').addEventListener('click', () => {
        if (!picked) return;
        copyText(buildElementPrompt(noteNode.value.trim()));
        pop.style.display = 'none';
      });

      $('#edit-assistant-save').addEventListener('click', guardarCambio);

      document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        pop.style.display = 'none';
        if (inspectMode) setInspectMode(false);
        document.body.classList.remove('edit-screen-mode');
        screenBtn.classList.remove('is-active');
        screenBtn.setAttribute('aria-pressed', 'false');
      });
      iniciarObservadorEditor();
      aplicarOverridesEditor();
    }

    function editAssistantDisponible() {
      // Herramienta interna de edición. ?edit=1 es el acceso explícito y
      // ?dev=1 se conserva por compatibilidad con el editor anterior.
      const params = new URLSearchParams(location.search);
      const pedido = params.get('edit') || params.get('dev');
      try {
        if (pedido === '1') sessionStorage.setItem('dv-dev', '1');
        else if (pedido === '0') sessionStorage.removeItem('dv-dev');
        return sessionStorage.getItem('dv-dev') === '1';
      } catch (err) {
        return pedido === '1'; // sin sessionStorage (modo privado): solo por URL
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      iniciarObservadorEditor();
      aplicarOverridesEditor();
      if (editAssistantDisponible()) initEditAssistant();
    });

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

    function accionesCentro(lugar) {
      const modoDonar = window.centrosModoActual === 'donar';
      const telefonoValido = soloDigitos(lugar.telefono);
      const ubicacion = String(lugar.ubicacion || '').trim();
      const destino = ubicacion ? encodeURIComponent(/venezuela/i.test(ubicacion) ? ubicacion : ubicacion + ', Venezuela') : '';
      const target = lugar.nombre ? (idiomaActual === 'es' ? ` a ${lugar.nombre}` : ` ${lugar.nombre}`) : '';
      const principales = [];
      const secundarias = [];

      if (telefonoValido) {
        if (modoDonar) {
          principales.push(`<a class="btn btn-primary btn-small" target="_blank" rel="noopener" href="${waHref(lugar.telefono, 'centers.whatsappText')}" aria-label="${e(t('a11y.whatsapp', { target }))}">${e(t('centers.coordinateDonation'))}</a>`);
          secundarias.push(`<a class="btn btn-ghost btn-small" href="${telHref(lugar.telefono)}" aria-label="${e(t('a11y.call', { target }))}">${e(t('common.call'))}</a>`);
        } else {
          principales.push(`<a class="btn btn-primary btn-small" href="${telHref(lugar.telefono)}" aria-label="${e(t('a11y.call', { target }))}">${e(t('centers.callCenter'))}</a>`);
          secundarias.push(`<a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="${waHref(lugar.telefono, 'centers.whatsappText')}" aria-label="${e(t('a11y.whatsapp', { target }))}">${e(t('common.whatsapp'))}</a>`);
        }
      }
      if (destino) {
        principales.push(`<a class="btn ${telefonoValido ? 'btn-ghost' : 'btn-primary'} btn-small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${destino}" aria-label="${e(t('centers.directionsTo', { center: lugar.nombre }))}">${e(t('centers.directions'))}</a>`);
        secundarias.push(`<a class="btn btn-ghost btn-small" target="_blank" rel="noopener" href="https://waze.com/ul?q=${destino}&navigate=yes">Waze</a>`);
      }
      secundarias.push(`<button class="btn btn-ghost btn-small" type="button" data-historial="${e(lugar.nombre)}">${e(t('common.history'))}</button>`);

      return `<div class="center-actions" role="group" aria-label="${e(t('centers.actionsFor', { center: lugar.nombre }))}">
        ${telefonoValido ? '' : `<p class="center-phone-pending">${e(t('centers.phonePending'))}</p>`}
        ${principales.length ? `<div class="center-primary-actions">${principales.join('')}</div>` : ''}
        <details class="center-more-actions">
          <summary>${e(t('centers.moreOptions'))}<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
          <div class="center-secondary-actions">${secundarias.join('')}</div>
        </details>
      </div>`;
    }

    function supplyChipUrgencyClass(value) {
      const n = normalizar(value);
      if (n.startsWith('critico')) return 'red';
      if (n.startsWith('moderado') || n.startsWith('alto')) return 'yellow';
      return 'neutral';
    }

    function renderSupplyPreview(items, mode) {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      const needs = mode === 'needs';
      const labelKey = needs ? 'centers.needsHeading' : 'centers.availabilityHeading';
      const emptyKey = needs ? 'centers.noActiveNeeds' : 'centers.noAvailability';
      if (!list.length) {
        return `<span class="centro-supply-empty ${needs ? 'is-needs' : 'is-available'}">${e(t(emptyKey))}</span>`;
      }
      const chips = list.map((item) => {
        const itemName = mostrarInsumo(item.nombre);
        const urgency = needs ? ` supply-chip-${supplyChipUrgencyClass(item.urgencia)}` : ' supply-chip-available';
        const meta = needs
          ? `<span class="supply-chip-meta">${e(t('centers.missing', { count: itemCantidad(item).faltan, unit: mostrarUnidad(item.unidad) }))}</span>`
          : '';
        return `<span class="supply-chip${urgency}" role="listitem" aria-label="${e([itemName, needs ? t('centers.missing', { count: itemCantidad(item).faltan, unit: mostrarUnidad(item.unidad) }) : ''].filter(Boolean).join(', '))}"><span class="supply-chip-name">${e(itemName)}</span>${meta}</span>`;
      }).join('');
      return `<div class="centro-supply-preview" aria-label="${e(t(labelKey))}"><span class="centro-supply-preview-label">${e(t(labelKey))}</span><div class="centro-supply-chips" role="list">${chips}</div></div>`;
    }

    // Tarjeta de centro con progressive disclosure: cerrada = resumen en una línea
    // (tipo, nombre, zona, 1-2 necesidades urgentes, distancia); abierta = detalle
    // completo con contacto, navegación e historial.
    function renderLugarCard(lugar, index) {
      const modoDonar = window.centrosModoActual === 'donar';
      const tipoNormal = normalizar(lugar.tipo);
      const claseLugar = tipoNormal.indexOf('hospital') === 0 ? 'hospital' : tipoNormal.indexOf('refugio') === 0 ? 'refugio' : 'centro';
      const detalleId = `centro-detalle-${index}`;
      const nombreId = `centro-nombre-${index}`;
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
      const resumenOperacion = modoDonar
        ? renderSupplyPreview(lugar.necesita || [], 'needs')
        : renderSupplyPreview(lugar.tiene_disponible || [], 'available');
      const disponibilidadBlock = disponibles ? `<div><p class="meta"><strong>${e(t('centers.hasAvailable'))}</strong></p><div class="badge-row">${disponibles}</div></div>` : '';
      const necesidadesBlock = necesidades ? `<ul class="supply-list">${necesidades}</ul>` : '';
      const disponibilidadHeading = disponibilidadBlock ? `<p class="centro-detail-heading">${e(t('centers.availabilityHeading'))}</p>` : '';
      const necesidadesHeading = necesidadesBlock ? `<p class="centro-detail-heading">${e(t('centers.needsHeading'))}</p>` : '';
      const detalleOperativo = modoDonar
        ? `${necesidadesHeading}${necesidadesBlock}${cubiertos ? `<div class="badge-row">${cubiertos}</div>` : ''}${disponibilidadHeading}${disponibilidadBlock}`
        : `${disponibilidadHeading}${disponibilidadBlock}${necesidadesHeading}${necesidadesBlock}${cubiertos ? `<div class="badge-row">${cubiertos}</div>` : ''}`;
      const d = distanciaKm(lugar);
      const distancia = d != null ? `<span class="centro-dist">${d.toFixed(1)} km</span>` : '';
      return `<article class="card centro-card ${claseLugar}" data-centro-card aria-labelledby="${nombreId}">
        <button class="centro-toggle" type="button" data-centro-toggle aria-expanded="false" aria-controls="${detalleId}">
          <span class="centro-resumen">
            <span class="badge-row"><span class="badge ${tipoBadge}">${e(mostrarTipo(lugar.tipo || 'Centro'))}</span>${lugar.gestionado ? `<span class="badge green">${e(t('centers.managedBadge'))}</span>` : ''}</span>
            <span class="centro-nombre" id="${nombreId}">${e(lugar.nombre)}</span>
            <span class="centro-meta"><span>${e(lugar.ubicacion || t('centers.locationPending'))}</span><span>${e(t('centers.updated', { date: fechaRelativa(lugar.actualizado) }))}</span></span>
            ${resumenOperacion}
          </span>
          <span class="centro-toggle-side">
            ${distancia}
            <span class="centro-toggle-label" data-centro-toggle-text>${e(t('centers.viewDetails'))}</span>
            <svg class="centro-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </button>
        <div class="centro-more" id="${detalleId}" hidden>
          ${detalleOperativo}
          ${accionesCentro(lugar)}
        </div>
      </article>`;
    }
