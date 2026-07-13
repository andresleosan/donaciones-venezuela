/* wiz.js — wizPublico: convierte cualquier formulario .form-grid/.field en un
   asistente "una casilla a la vez" con barra de progreso superior.
   Progressive enhancement: los campos, ids y handlers de submit originales no
   cambian, así el payload enviado al backend es idéntico al de antes. */
// Scope global compartido con core.js: usa t() y e() reales.

  function wizPublico(ref, opts) {
    const form = typeof ref === 'string' ? document.getElementById(ref) : ref;
    if (!form || form.dataset.wizOn) return null;
    const o = opts || {};
    // Pasos = cada .field visible + bloques especiales [data-wiz-step], en orden DOM
    const pasos = Array.from(form.querySelectorAll('.field, [data-wiz-step]'))
      .filter((el) => !el.hidden && !el.closest('[hidden]') && !el.matches('.field .field'));
    if (pasos.length < 2) return null; // con 1 campo ya es "uno a la vez"
    form.dataset.wizOn = '1';
    form.classList.add('wiz-on');

    // total = Inicio (pre-completado) + pasos + Confirmar
    const total = pasos.length + 2;
    let actual = 0; // índice dentro de pasos; el Inicio ya cuenta como hecho

    const head = document.createElement('div');
    head.className = 'wiz-head';
    head.innerHTML = `<div class="wizard-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="wizard-progress-fill"></div></div><p class="wiz-eyebrow" aria-live="polite"></p>`;
    form.prepend(head);

    const resumen = document.createElement('dl');
    resumen.className = 'wiz-resumen';
    resumen.hidden = true;

    const foot = document.createElement('div');
    foot.className = 'wiz-foot';
    foot.innerHTML = `<button class="btn btn-ghost" type="button" data-wiz-atras>${e(t('wizard.back'))}</button><button class="btn btn-primary" type="button" data-wiz-sig>${e(t('wizard.next'))}</button>`;
    const acciones = form.querySelector('.form-actions');
    form.insertBefore(resumen, acciones || null);
    form.insertBefore(foot, acciones || null);

    const aviso = document.createElement('div');
    aviso.className = 'form-message';
    aviso.setAttribute('role', 'status');
    form.insertBefore(aviso, foot);

    const control = (p) => p.querySelector('input, select, textarea');
    const enFinal = () => actual >= pasos.length;

    function pintar() {
      pasos.forEach((p, i) => p.classList.toggle('wiz-active', i === actual));
      form.classList.toggle('wiz-final', enFinal());
      resumen.hidden = !enFinal();
      foot.querySelector('[data-wiz-sig]').hidden = enFinal();
      // Paso mostrado: Inicio(1, ya hecho) -> campos(2..) -> Confirmar(total)
      const num = actual + 2;
      head.querySelector('.wiz-eyebrow').textContent = t('wizard.stepOf', { current: num, total: total });
      const fill = Math.round(((num - 1) / (total - 1)) * 100);
      head.querySelector('.wizard-progress-fill').style.width = fill + '%';
      head.querySelector('.wizard-progress').setAttribute('aria-valuenow', String(fill));
      aviso.className = 'form-message';
      aviso.textContent = '';
      if (enFinal()) {
        pintarResumen();
      } else {
        const c = control(pasos[actual]);
        if (c && c.type !== 'file') { try { c.focus({ preventScroll: false }); } catch (err) { /* sin foco */ } }
        if (o.alEntrar) o.alEntrar(pasos[actual]);
      }
    }

    function pintarResumen() {
      resumen.innerHTML = pasos.map((p) => {
        const label = p.querySelector('label');
        const c = control(p);
        if (!label) return '';
        let valor;
        if (p.dataset.wizDone) valor = p.dataset.wizDone;
        else if (!c) valor = '';
        else if (c.type === 'file') valor = (c.files && c.files.length) ? t('wizard.confirm') : '—';
        else if (c.tagName === 'SELECT') valor = c.options[c.selectedIndex] ? c.options[c.selectedIndex].textContent : '';
        else valor = c.value.trim();
        return `<div><dt>${e(label.textContent)}</dt><dd>${e(valor || '—')}</dd></div>`;
      }).join('');
    }

    function fallo(msg) {
      aviso.className = 'form-message visible error';
      aviso.textContent = msg;
    }

    function valido() {
      const p = pasos[actual];
      if (o.validar) {
        const r = o.validar(p);
        if (r !== true && r !== undefined) { fallo(typeof r === 'string' ? r : t('validation.reviewFields', { count: 1, plural: '' })); return false; }
        if (r === true && !control(p)) return true;
      }
      const c = control(p);
      if (c && !c.checkValidity()) {
        const label = p.querySelector('label');
        fallo(t('wizard.requiredField', { field: label ? label.textContent : c.id }));
        c.reportValidity();
        return false;
      }
      return true;
    }

    foot.querySelector('[data-wiz-sig]').addEventListener('click', () => {
      if (!valido()) return;
      actual = Math.min(pasos.length, actual + 1);
      pintar();
    });
    foot.querySelector('[data-wiz-atras]').addEventListener('click', () => {
      if (actual === 0) return;
      actual -= 1;
      pintar();
    });
    form.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || enFinal()) return;
      const tag = ev.target.tagName;
      if (tag === 'TEXTAREA' || ev.target.type === 'submit') return;
      ev.preventDefault();
      foot.querySelector('[data-wiz-sig]').click();
    });
    form.addEventListener('reset', () => { actual = 0; setTimeout(pintar, 0); });

    pintar();
    return { irA: (i) => { actual = Math.max(0, Math.min(pasos.length, i)); pintar(); } };
  }
