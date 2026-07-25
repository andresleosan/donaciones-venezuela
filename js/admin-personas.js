// Consola de datos del admin — pantallas de personas.
// Voluntarios, transportistas, rescatistas y personas buscadas. Cada pantalla decide
// QUÉ enseña de cada ficha; el listar / buscar / editar / borrar lo pone admin-datos.js.
'use strict';

    // Resumen de una fila: título a la izquierda, datos secundarios debajo, distintivo
    // a la derecha. Es la forma que ya usan los demás paneles del admin.
    function dvpFila(titulo, secundario, badge) {
      return `
        <span class="admin-record-main">
          <strong>${e(titulo)}</strong>
          <span class="meta">${e(secundario)}</span>
        </span>
        <span class="admin-record-side">${badge}</span>`;
    }

    const dvpUnidos = (partes) => partes.filter(Boolean).join(' · ');

    // ---- Voluntarios ----
    DV_DATOS_PANELES.voluntarios = {
      icono: '🙌',
      titulo: () => t('admin.manageVolunteers'),
      abrir: () => dvDatosLista({
        entidad: 'voluntarios', pk: 'id', etiqueta: 'nombre',
        titulo: t('admin.manageVolunteers'),
        // La cédula a la vista es la palanca contra los registros falsos: el distintivo
        // dice de un vistazo quién tiene documento subido y quién no.
        fila: (v) => dvpFila(
          `${v.nombre || ''} ${v.apellido || ''}`.trim(),
          dvpUnidos([v.ciudad, v.profesion, v.telefono, v.email]),
          v.foto_cedula
            ? `<span class="badge green">${e(dvTexto('hasId'))}</span>`
            : `<span class="badge red">${e(dvTexto('noId'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'apellido', etiqueta: dvTexto('fLastName'), tipo: 'texto' },
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'ciudad', etiqueta: dvTexto('fCity'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'profesion', etiqueta: dvTexto('fProfession'), tipo: 'texto' },
          { id: 'disponibilidad', etiqueta: dvTexto('fAvailability'), tipo: 'texto' },
          { id: 'medio_transporte', etiqueta: dvTexto('fTransport'), tipo: 'texto' },
          { id: 'observaciones', etiqueta: dvTexto('fNotes'), tipo: 'texto-largo' },
        ],
      }),
    };

    // ---- Transportistas ----
    DV_DATOS_PANELES.motorizados = {
      icono: '🛵',
      titulo: () => dvTexto('titleDrivers'),
      abrir: () => dvDatosLista({
        entidad: 'motorizados', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titleDrivers'),
        fila: (m) => dvpFila(
          m.nombre || '',
          dvpUnidos([m.tipo_vehiculo, m.placa, m.zona_operacion, m.telefono]),
          m.foto_cedula && m.foto_placa && m.foto_vehiculo
            ? `<span class="badge green">${e(dvTexto('hasId'))}</span>`
            : `<span class="badge red">${e(dvTexto('noId'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'tipo_vehiculo', etiqueta: dvTexto('fVehicle'), tipo: 'opcion',
            opciones: ['Moto', 'Carro', 'Bicicleta', 'Camión', 'Triciclo motorizado'] },
          { id: 'placa', etiqueta: dvTexto('fPlate'), tipo: 'texto' },
          { id: 'zona_operacion', etiqueta: dvTexto('fZone'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'email', etiqueta: dvTexto('fEmail'), tipo: 'email' },
        ],
        // Cuántos trayectos y aportes tiene: lo calcula el servidor como
        // «dependientes» y aquí sirve para saber si el registro está vivo o vacío.
        extras: (m, dep) => (dep && dep.length)
          ? `<p class="meta">${e(dep.map((d) => `${d.cuantos} ${d.etiqueta}`).join(' · '))}</p>`
          : '',
      }),
    };

    // ---- Rescatistas ----
    DV_DATOS_PANELES.rescatistas = {
      icono: '🚑',
      titulo: () => t('admin.manageRescuers'),
      abrir: () => dvDatosLista({
        entidad: 'rescatistas', pk: 'id', etiqueta: 'nombre',
        titulo: t('admin.manageRescuers'),
        fila: (r) => dvpFila(
          r.nombre || '',
          dvpUnidos([r.organizacion, r.especialidad, r.ciudad, r.telefono]),
          r.capacidad_operativa ? `<span class="badge gray">${e(r.capacidad_operativa)}</span>` : ''),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'organizacion', etiqueta: dvTexto('fOrg'), tipo: 'texto' },
          { id: 'especialidad', etiqueta: dvTexto('fSpecialty'), tipo: 'texto' },
          { id: 'telefono', etiqueta: dvTexto('fPhone'), tipo: 'telefono' },
          { id: 'ciudad', etiqueta: dvTexto('fCity'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'disponibilidad', etiqueta: dvTexto('fAvailability'), tipo: 'texto' },
          { id: 'equipo_disponible', etiqueta: dvTexto('fEquipment'), tipo: 'texto-largo' },
          { id: 'capacidad_operativa', etiqueta: dvTexto('fCapacity'), tipo: 'texto' },
          { id: 'observaciones', etiqueta: dvTexto('fNotes'), tipo: 'texto-largo' },
        ],
      }),
    };

    // ---- Personas buscadas ----
    DV_DATOS_PANELES.personas = {
      icono: '🔎',
      titulo: () => dvTexto('titlePeople'),
      abrir: () => dvDatosLista({
        entidad: 'personas', pk: 'id', etiqueta: 'nombre',
        titulo: dvTexto('titlePeople'),
        fila: (p) => dvpFila(
          p.nombre || '',
          dvpUnidos([p.cedula, p.ubicacion, p.contacto, fechaRelativa(p.fecha)]),
          p.verificada
            ? `<span class="badge green">${e(dvTexto('fVerified'))}</span>`
            : `<span class="badge yellow">${e(t('common.pending'))}</span>`),
        campos: [
          { id: 'nombre', etiqueta: dvTexto('fName'), tipo: 'texto' },
          { id: 'cedula', etiqueta: dvTexto('fCedula'), tipo: 'texto' },
          { id: 'estado', etiqueta: dvTexto('fState'), tipo: 'texto' },
          { id: 'ubicacion', etiqueta: dvTexto('fLocation'), tipo: 'texto' },
          { id: 'contacto', etiqueta: dvTexto('fContact'), tipo: 'texto' },
          { id: 'fuente', etiqueta: dvTexto('fSource'), tipo: 'texto' },
          { id: 'reportado_por', etiqueta: dvTexto('fReportedBy'), tipo: 'texto' },
          { id: 'verificada', etiqueta: dvTexto('fVerified'), tipo: 'booleano' },
        ],
      }),
    };
