/**
 * Donaciones Venezuela - Backend (Google Apps Script)
 * --------------------------------------------------------------------------
 * Base de datos: Google Sheets.
 * Spreadsheet principal:
 * 1fnXiSy1TbPqwlLKDSfPoBfKs8pH0WptoECGq_zu_Lco
 *
 * Compatibilidad obligatoria:
 * - La hoja "lugares" mantiene el esquema original A-H:
 *   Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado
 * - Se conservan endpoints existentes de centros, motorizados, trayectos,
 *   historial y donaciones a motorizados.
 * - Se agregan hojas/endpoints para voluntarios y rescatistas.
 */

const SHEET_ID = "1fnXiSy1TbPqwlLKDSfPoBfKs8pH0WptoECGq_zu_Lco";

const LUGARES_SHEET = "lugares";
const CENTROS_SHEET = "centros_necesidades";
const MOTORIZADOS_SHEET = "motorizados";
const TRAYECTOS_SHEET = "trayectos";
const HISTORIAL_SHEET = "historial_movimientos";
const DONACIONES_SHEET = "donaciones_motorizados";
const VOLUNTARIOS_SHEET = "voluntarios";
const RESCATISTAS_SHEET = "rescatistas";

const LUGARES_HEADERS = [
  "Tipo", "Nombre", "Ubicacion", "Telefono", "Insumo", "Categoria", "Estado", "Actualizado"
];
const VOLUNTARIOS_HEADERS = [
  "id", "nombre", "apellido", "telefono", "estado", "ciudad", "profesion",
  "disponibilidad", "observaciones", "fecha_registro"
];
const RESCATISTAS_HEADERS = [
  "id", "nombre", "organizacion", "telefono", "especialidad", "estado", "ciudad",
  "disponibilidad", "observaciones", "fecha_registro"
];
const HISTORIAL_HEADERS = [
  "Timestamp", "TipoLugar", "Lugar", "Insumo", "TipoMovimiento", "Cantidad",
  "Unidad", "Voluntario", "CantidadAcumulada", "Observaciones"
];

// -- PUNTOS DE ENTRADA ------------------------------------------------------
function doGet(e) {
  try {
    inicializarHojasBase();

    const params = (e && e.parameter) || {};
    const accion = normalizar(params.accion || "");

    if (accion === "lugares") return listarLugares(params);
    if (accion === "centros") return listarCentros();
    if (accion === "estadisticas" || accion === "stats") return listarEstadisticas();
    if (accion === "voluntarios") return listarVoluntarios(params);
    if (accion === "rescatistas") return listarRescatistas(params);
    if (accion === "motorizados") return listarMotorizados();
    if (accion === "perfil_motorizado") return obtenerPerfilMotorizado(params.id);
    if (accion === "trayectos") return obtenerTrayectos(params.motorizado || params.motorizadoId || null);
    if (accion === "historial") return obtenerHistorialMovimientos(params.centro || params.lugar || null);

    const lugares = construirLugares();
    const centros = construirCentrosSeguro(lugares);
    const voluntarios = filtrarPersonas(construirVoluntarios(), params);
    const rescatistas = filtrarPersonas(construirRescatistas(), params);
    const motorizados = construirMotorizadosSeguro();
    const estadisticas = construirEstadisticas({ lugares, voluntarios, rescatistas, motorizados });

    return jsonResponse({
      lugares,
      centros,
      voluntarios,
      rescatistas,
      motorizados,
      estadisticas,
      stats: estadisticas
    });
  } catch (err) {
    return jsonResponse({ error: errorMessage(err) }, 500);
  }
}

function doPost(e) {
  try {
    inicializarHojasBase();

    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const accion = normalizar(payload.accion || "");

    if (accion === "lugares" || accion === "registrar_lugar" || accion === "agregar_lugar") {
      return registrarLugar(payload);
    }
    if (accion === "voluntarios" || accion === "registrar_voluntario") {
      return registrarVoluntario(payload);
    }
    if (accion === "rescatistas" || accion === "registrar_rescatista") {
      return registrarRescatista(payload);
    }
    if (accion === "registrar_movimiento") return registrarMovimiento(payload);
    if (accion === "registrar_trayecto") return registrarTrayecto(payload);
    if (accion === "donar_motorizado") return donarMotorizado(payload);
    if (accion === "registrar_motorizado") return registrarMotorizado(payload);

    if (!accion && payload.tipo && payload.nombre && payload.insumo && payload.estado) {
      return registrarLugar(payload);
    }

    return jsonResponse({ error: "Accion no reconocida" }, 400);
  } catch (err) {
    return jsonResponse({ error: errorMessage(err) }, 500);
  }
}

function jsonResponse(obj, statusCode) {
  const out = obj || {};
  if (statusCode && out.status == null) out.status = statusCode;
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// -- UTILIDADES -------------------------------------------------------------
function abrirSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function obtenerHoja(nombre) {
  const hoja = abrirSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la hoja "' + nombre + '" en el Sheet indicado');
  return hoja;
}

function obtenerHojaOpcional(nombre) {
  return abrirSpreadsheet().getSheetByName(nombre);
}

function asegurarHoja(nombre, headers) {
  const ss = abrirSpreadsheet();
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);

  const lastColumn = hoja.getLastColumn();
  const lastRow = hoja.getLastRow();
  if (lastRow === 0 || lastColumn === 0) {
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function inicializarHojasBase() {
  asegurarHoja(LUGARES_SHEET, LUGARES_HEADERS);
  asegurarHoja(VOLUNTARIOS_SHEET, VOLUNTARIOS_HEADERS);
  asegurarHoja(RESCATISTAS_SHEET, RESCATISTAS_HEADERS);
  if (!obtenerHojaOpcional(HISTORIAL_SHEET)) {
    asegurarHoja(HISTORIAL_SHEET, HISTORIAL_HEADERS);
  }
}

function numero(valor, fallback) {
  const n = Number(valor);
  return isNaN(n) ? (fallback || 0) : n;
}

function texto(valor) {
  return String(valor == null ? "" : valor).trim();
}

function normalizar(textoEntrada) {
  return String(textoEntrada == null ? "" : textoEntrada)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function fechaISO(valor) {
  if (!valor) return "";
  const fecha = new Date(valor);
  return isNaN(fecha.getTime()) ? String(valor) : fecha.toISOString();
}

function esSi(valor) {
  const n = normalizar(valor);
  return valor === true || n === "si" || n === "sí" || n === "true";
}

function errorMessage(err) {
  return String(err && err.message ? err.message : err);
}

function leerFilas(nombreHoja) {
  const hoja = obtenerHoja(nombreHoja);
  const data = hoja.getDataRange().getValues();
  return data.length > 1 ? data : [data[0] || []];
}

function leerObjetos(nombreHoja, headersSiFalta) {
  const hoja = headersSiFalta ? asegurarHoja(nombreHoja, headersSiFalta) : obtenerHoja(nombreHoja);
  const values = hoja.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(texto);
  const objetos = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row.some(function (value) { return texto(value); })) continue;

    const item = {};
    headers.forEach(function (header, idx) {
      if (header) item[header] = row[idx];
    });
    objetos.push(item);
  }
  return objetos;
}

function valorPorCabecera(item, nombres) {
  for (let i = 0; i < nombres.length; i++) {
    const nombre = nombres[i];
    if (item[nombre] != null && texto(item[nombre]) !== "") return item[nombre];
  }
  return "";
}

function generarId(sheet, prefix) {
  const existentes = {};
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existentes[String(data[i][0])] = true;
  }

  let id = "";
  do {
    id = prefix + Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  } while (existentes[id]);

  return id;
}

// -- LUGARES ---------------------------------------------------------------
function listarLugares(params) {
  const lugares = aplicarFiltrosLugares(construirLugares(), params || {});
  return jsonResponse({ lugares, centros: lugares, total: lugares.length, estadisticas: construirEstadisticas({ lugares }) });
}

function construirLugares() {
  const rows = leerObjetos(LUGARES_SHEET, LUGARES_HEADERS);
  const lugaresMap = {};

  rows.forEach(function (row) {
    const tipo = texto(valorPorCabecera(row, ["Tipo", "tipo"]));
    const nombre = texto(valorPorCabecera(row, ["Nombre", "nombre"]));
    const insumoNombre = texto(valorPorCabecera(row, ["Insumo", "insumo"]));
    if (!tipo || !nombre || !insumoNombre) return;

    const ubicacion = texto(valorPorCabecera(row, ["Ubicacion", "Ubicación", "ubicacion"]));
    const telefono = texto(valorPorCabecera(row, ["Telefono", "Teléfono", "telefono"]));
    const categoria = texto(valorPorCabecera(row, ["Categoria", "Categoría", "categoria"])) || "Otros";
    const estado = texto(valorPorCabecera(row, ["Estado", "estado"]));
    const actualizado = fechaISO(valorPorCabecera(row, ["Actualizado", "actualizado"]));
    const key = normalizar(tipo + "|" + nombre);

    if (!lugaresMap[key]) {
      lugaresMap[key] = {
        tipo,
        nombre,
        ubicacion,
        telefono,
        necesita: [],
        cubiertos: [],
        tiene_disponible: [],
        actualizado
      };
    }

    if (actualizado) lugaresMap[key].actualizado = actualizado;

    if (esNecesita(estado)) {
      lugaresMap[key].necesita.push({
        nombre: insumoNombre,
        categoria,
        estado: "Necesita",
        cantidadNecesaria: numero(row.CantidadNecesaria, 1) || 1,
        cantidadRecibida: numero(row.CantidadRecibida, 0),
        porcentaje: 0,
        urgencia: texto(row.Urgencia) || "Normal",
        unidad: texto(row.Unidad) || "unidades",
        yaCubierto: false,
        coincidencias: []
      });
    } else {
      lugaresMap[key].tiene_disponible.push({
        nombre: insumoNombre,
        categoria,
        estado: "Tiene disponible"
      });
    }
  });

  const lugares = Object.keys(lugaresMap).map(function (key) { return lugaresMap[key]; });
  calcularCantidadesLugares(lugares);
  calcularCoincidencias(lugares);
  lugares.sort(function (a, b) { return normalizar(a.tipo + a.nombre) > normalizar(b.tipo + b.nombre) ? 1 : -1; });
  return lugares;
}

function esNecesita(estadoTxt) {
  return normalizar(estadoTxt).indexOf("necesita") === 0;
}

function calcularCantidadesLugares(lugares) {
  lugares.forEach(function (lugar) {
    lugar.necesita.forEach(function (item) {
      const necesaria = Math.max(0, numero(item.cantidadNecesaria, 1));
      const recibida = Math.max(0, Math.min(numero(item.cantidadRecibida, 0), necesaria));
      item.cantidadNecesaria = necesaria;
      item.cantidadRecibida = recibida;
      item.porcentaje = necesaria > 0 ? Math.round((recibida / necesaria) * 100) : 0;
      item.yaCubierto = necesaria > 0 && recibida >= necesaria;
    });
  });
}

function calcularCoincidencias(lugares) {
  const disponiblesPorInsumo = {};
  lugares.forEach(function (lugar) {
    lugar.tiene_disponible.forEach(function (item) {
      const key = normalizar(item.nombre);
      if (!disponiblesPorInsumo[key]) disponiblesPorInsumo[key] = [];
      disponiblesPorInsumo[key].push({
        keyLugar: normalizar(lugar.tipo + "|" + lugar.nombre),
        nombre_lugar: lugar.nombre,
        tipo: lugar.tipo,
        telefono: lugar.telefono,
        ubicacion: lugar.ubicacion,
        categoria: item.categoria
      });
    });
  });

  lugares.forEach(function (lugar) {
    const keyLugar = normalizar(lugar.tipo + "|" + lugar.nombre);
    lugar.necesita.forEach(function (item) {
      item.coincidencias = (disponiblesPorInsumo[normalizar(item.nombre)] || [])
        .filter(function (match) { return match.keyLugar !== keyLugar; })
        .map(function (match) {
          return {
            nombre_lugar: match.nombre_lugar,
            tipo: match.tipo,
            telefono: match.telefono,
            ubicacion: match.ubicacion,
            categoria: match.categoria
          };
        });
    });
  });
}

function aplicarFiltrosLugares(lugares, params) {
  const tipo = normalizar(params.tipo || "");
  const categoria = normalizar(params.categoria || "");
  const q = normalizar(params.q || params.busqueda || "");

  return lugares.filter(function (lugar) {
    if (tipo && tipo !== "todos" && normalizar(lugar.tipo).indexOf(tipo) !== 0) return false;
    if (q && normalizar([lugar.nombre, lugar.ubicacion, lugar.tipo].join(" ")).indexOf(q) === -1) return false;
    if (categoria) {
      const items = (lugar.necesita || []).concat(lugar.tiene_disponible || [], lugar.cubiertos || []);
      return items.some(function (item) { return normalizar(item.categoria) === categoria; });
    }
    return true;
  });
}

function registrarLugar(payload) {
  const tipo = texto(payload.tipo || payload.Tipo);
  const nombre = texto(payload.nombre || payload.Nombre);
  const insumo = texto(payload.insumo || payload.Insumo);
  const estado = texto(payload.estado || payload.Estado);

  if (!tipo || !nombre || !insumo || !estado) {
    throw new Error("Faltan campos obligatorios: tipo, nombre, insumo, estado");
  }

  const hoja = asegurarHoja(LUGARES_SHEET, LUGARES_HEADERS);
  hoja.appendRow([
    tipo,
    nombre,
    texto(payload.ubicacion || payload.Ubicacion),
    texto(payload.telefono || payload.Telefono),
    insumo,
    texto(payload.categoria || payload.Categoria) || "Otros",
    esNecesita(estado) ? "Necesita" : "Tiene disponible",
    new Date()
  ]);

  return jsonResponse({ success: true, exito: true });
}

// -- ESTADISTICAS ----------------------------------------------------------
function listarEstadisticas() {
  const lugares = construirLugares();
  const voluntarios = construirVoluntarios();
  const rescatistas = construirRescatistas();
  const motorizados = construirMotorizadosSeguro();
  const estadisticas = construirEstadisticas({ lugares, voluntarios, rescatistas, motorizados });
  return jsonResponse({ estadisticas, stats: estadisticas });
}

function construirEstadisticas(data) {
  const lugares = data.lugares || construirLugares();
  const voluntarios = data.voluntarios || [];
  const rescatistas = data.rescatistas || [];
  const centros = contarPorTipo(lugares, function (tipo) {
    return normalizar(tipo).indexOf("hospital") !== 0;
  });
  const hospitales = contarPorTipo(lugares, function (tipo) {
    return normalizar(tipo).indexOf("hospital") === 0;
  });

  return {
    centrosRegistrados: centros,
    hospitalesRegistrados: hospitales,
    personasLocalizadas: contarPersonasLocalizadas(),
    voluntariosActivos: voluntarios.length,
    rescatistasRegistrados: rescatistas.length,
    motorizadosRegistrados: (data.motorizados || []).length,
    actualizado: new Date().toISOString()
  };
}

function contarPorTipo(lugares, predicate) {
  const vistos = {};
  lugares.forEach(function (lugar) {
    if (predicate(lugar.tipo)) vistos[normalizar(lugar.tipo + "|" + lugar.nombre)] = true;
  });
  return Object.keys(vistos).length;
}

function contarPersonasLocalizadas() {
  const hoja = obtenerHojaOpcional("personas") || obtenerHojaOpcional("familiares");
  if (!hoja) return 0;

  const values = hoja.getDataRange().getValues();
  if (values.length <= 1) return 0;

  const headers = values[0].map(normalizar);
  const idxEstado = headers.indexOf("estado");
  if (idxEstado === -1) return values.length - 1;

  let total = 0;
  for (let i = 1; i < values.length; i++) {
    const estado = normalizar(values[i][idxEstado]);
    if (estado.indexOf("localizado") !== -1 || estado.indexOf("refugio") !== -1 || estado.indexOf("hospital") !== -1) {
      total++;
    }
  }
  return total;
}

// -- VOLUNTARIOS -----------------------------------------------------------
function listarVoluntarios(params) {
  const voluntarios = filtrarPersonas(construirVoluntarios(), params || {});
  return jsonResponse({ voluntarios, total: voluntarios.length });
}

function construirVoluntarios() {
  const rows = leerObjetos(VOLUNTARIOS_SHEET, VOLUNTARIOS_HEADERS);
  const voluntarios = rows.map(function (row) {
    return {
      id: texto(row.id),
      nombre: texto(row.nombre),
      apellido: texto(row.apellido),
      telefono: texto(row.telefono),
      estado: texto(row.estado),
      ciudad: texto(row.ciudad),
      profesion: texto(row.profesion),
      disponibilidad: texto(row.disponibilidad),
      observaciones: texto(row.observaciones),
      fecha_registro: fechaISO(row.fecha_registro)
    };
  }).filter(function (v) { return v.id || v.nombre || v.telefono; });

  voluntarios.sort(function (a, b) { return new Date(b.fecha_registro) - new Date(a.fecha_registro); });
  return voluntarios;
}

function registrarVoluntario(payload) {
  const nombre = texto(payload.nombre);
  const telefono = texto(payload.telefono);
  if (!nombre || !telefono) throw new Error("Faltan campos obligatorios: nombre, telefono");

  const hoja = asegurarHoja(VOLUNTARIOS_SHEET, VOLUNTARIOS_HEADERS);
  const id = generarId(hoja, "VOL");
  const fechaRegistro = new Date();
  hoja.appendRow([
    id,
    nombre,
    texto(payload.apellido),
    telefono,
    texto(payload.estado),
    texto(payload.ciudad),
    texto(payload.profesion),
    texto(payload.disponibilidad),
    texto(payload.observaciones),
    fechaRegistro
  ]);

  return jsonResponse({
    success: true,
    exito: true,
    id,
    voluntario: {
      id,
      nombre,
      apellido: texto(payload.apellido),
      telefono,
      estado: texto(payload.estado),
      ciudad: texto(payload.ciudad),
      profesion: texto(payload.profesion),
      disponibilidad: texto(payload.disponibilidad),
      observaciones: texto(payload.observaciones),
      fecha_registro: fechaRegistro.toISOString()
    }
  });
}

// -- RESCATISTAS -----------------------------------------------------------
function listarRescatistas(params) {
  const rescatistas = filtrarPersonas(construirRescatistas(), params || {});
  return jsonResponse({ rescatistas, total: rescatistas.length });
}

function construirRescatistas() {
  const rows = leerObjetos(RESCATISTAS_SHEET, RESCATISTAS_HEADERS);
  const rescatistas = rows.map(function (row) {
    return {
      id: texto(row.id),
      nombre: texto(row.nombre),
      organizacion: texto(row.organizacion),
      telefono: texto(row.telefono),
      especialidad: texto(row.especialidad),
      estado: texto(row.estado),
      ciudad: texto(row.ciudad),
      disponibilidad: texto(row.disponibilidad),
      observaciones: texto(row.observaciones),
      fecha_registro: fechaISO(row.fecha_registro)
    };
  }).filter(function (r) { return r.id || r.nombre || r.telefono; });

  rescatistas.sort(function (a, b) { return new Date(b.fecha_registro) - new Date(a.fecha_registro); });
  return rescatistas;
}

function registrarRescatista(payload) {
  const nombre = texto(payload.nombre);
  const telefono = texto(payload.telefono);
  if (!nombre || !telefono) throw new Error("Faltan campos obligatorios: nombre, telefono");

  const hoja = asegurarHoja(RESCATISTAS_SHEET, RESCATISTAS_HEADERS);
  const id = generarId(hoja, "RES");
  const fechaRegistro = new Date();
  hoja.appendRow([
    id,
    nombre,
    texto(payload.organizacion),
    telefono,
    texto(payload.especialidad),
    texto(payload.estado),
    texto(payload.ciudad),
    texto(payload.disponibilidad),
    texto(payload.observaciones),
    fechaRegistro
  ]);

  return jsonResponse({
    success: true,
    exito: true,
    id,
    rescatista: {
      id,
      nombre,
      organizacion: texto(payload.organizacion),
      telefono,
      especialidad: texto(payload.especialidad),
      estado: texto(payload.estado),
      ciudad: texto(payload.ciudad),
      disponibilidad: texto(payload.disponibilidad),
      observaciones: texto(payload.observaciones),
      fecha_registro: fechaRegistro.toISOString()
    }
  });
}

function filtrarPersonas(lista, params) {
  const q = normalizar(params.q || params.busqueda || "");
  const estado = normalizar(params.estado || "");
  const tipo = normalizar(params.tipo || params.profesion || params.especialidad || "");

  return (lista || []).filter(function (item) {
    if (estado && normalizar(item.estado) !== estado) return false;
    if (tipo && normalizar(item.profesion || item.especialidad) !== tipo) return false;
    if (!q) return true;
    return normalizar([
      item.nombre, item.apellido, item.organizacion, item.telefono, item.estado,
      item.ciudad, item.profesion, item.especialidad, item.disponibilidad
    ].join(" ")).indexOf(q) !== -1;
  });
}

// -- CENTROS / DONACIONES CUANTITATIVAS ------------------------------------
function listarCentros() {
  const lugares = construirLugares();
  const centros = construirCentrosSeguro(lugares);
  return jsonResponse({ centros, lugares: centros });
}

function construirCentrosSeguro(fallback) {
  try {
    if (!obtenerHojaOpcional(CENTROS_SHEET)) return fallback || [];
    return construirCentros();
  } catch (err) {
    return fallback || [];
  }
}

function construirCentros() {
  const data = leerFilas(CENTROS_SHEET);
  const centroMap = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[1]) continue;

    const tipo = texto(row[0]);
    const nombre = texto(row[1]);
    const key = normalizar(tipo + "|" + nombre);

    if (!centroMap[key]) {
      centroMap[key] = {
        tipo,
        nombre,
        ubicacion: texto(row[2]),
        telefono: texto(row[3]),
        necesita: [],
        no_acepta: [],
        cubiertos: [],
        tiene_disponible: [],
        actualizado: fechaISO(row[10])
      };
    }

    const cantidadNecesaria = numero(row[6], 0);
    const cantidadRecibida = Math.max(0, numero(row[7], 0));
    const recibidaCap = cantidadNecesaria > 0
      ? Math.min(cantidadRecibida, cantidadNecesaria)
      : cantidadRecibida;

    const insumo = {
      nombre: texto(row[4]),
      categoria: texto(row[5]) || "Otros",
      cantidadNecesaria,
      cantidadRecibida: recibidaCap,
      urgencia: texto(row[8]) || "Normal",
      unidad: texto(row[9]) || "unidades",
      coincidencias: []
    };

    if (!insumo.nombre) continue;

    insumo.porcentaje = insumo.cantidadNecesaria > 0
      ? Math.round((insumo.cantidadRecibida / insumo.cantidadNecesaria) * 100)
      : 0;
    insumo.yaCubierto = insumo.cantidadRecibida >= insumo.cantidadNecesaria && insumo.cantidadNecesaria > 0;

    if (insumo.yaCubierto) {
      centroMap[key].cubiertos.push(insumo);
      centroMap[key].tiene_disponible.push({ nombre: insumo.nombre, categoria: insumo.categoria });
    } else {
      centroMap[key].necesita.push(insumo);
    }

    if (row[10]) centroMap[key].actualizado = fechaISO(row[10]);
  }

  const centros = Object.keys(centroMap).map(function (key) { return centroMap[key]; });
  calcularCoincidencias(centros);
  return centros;
}

function registrarMovimiento(payload) {
  if (!payload.nombreLugar || !payload.insumo || !payload.tipoMovimiento) {
    throw new Error("Faltan campos obligatorios: nombreLugar, insumo, tipoMovimiento");
  }

  const cantidad = numero(payload.cantidad, 0);
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0");

  const ss = abrirSpreadsheet();
  const centroSheet = ss.getSheetByName(CENTROS_SHEET);
  if (!centroSheet) throw new Error('No existe la hoja "' + CENTROS_SHEET + '"');
  const histSheet = asegurarHoja(HISTORIAL_SHEET, HISTORIAL_HEADERS);
  const centroData = centroSheet.getDataRange().getValues();

  for (let i = 1; i < centroData.length; i++) {
    if (normalizar(centroData[i][1]) === normalizar(payload.nombreLugar) &&
        normalizar(centroData[i][4]) === normalizar(payload.insumo)) {
      const cantidadActual = parseFloat(centroData[i][7]) || 0;
      let nuevaCantidad = cantidadActual;

      if (normalizar(payload.tipoMovimiento) === "entrada") {
        nuevaCantidad += cantidad;
      } else {
        nuevaCantidad = Math.max(0, cantidadActual - cantidad);
      }

      const cantidadNecesaria = parseFloat(centroData[i][6]) || 0;
      if (cantidadNecesaria > 0) {
        nuevaCantidad = Math.min(nuevaCantidad, cantidadNecesaria);
      }

      centroSheet.getRange(i + 1, 8).setValue(nuevaCantidad);
      centroSheet.getRange(i + 1, 11).setValue(new Date());

      histSheet.appendRow([
        new Date(),
        texto(payload.tipoLugar) || texto(centroData[i][0]),
        texto(payload.nombreLugar),
        texto(payload.insumo),
        texto(payload.tipoMovimiento),
        cantidad,
        texto(payload.unidad) || texto(centroData[i][9]) || "unidades",
        texto(payload.nombreVoluntario) || "Anonimo",
        nuevaCantidad,
        texto(payload.observaciones)
      ]);

      return jsonResponse({ success: true, exito: true, nuevaCantidad });
    }
  }

  return jsonResponse({ error: "Insumo no encontrado" }, 404);
}

function obtenerHistorialMovimientos(centro) {
  const sheet = asegurarHoja(HISTORIAL_SHEET, HISTORIAL_HEADERS);
  const data = sheet.getDataRange().getValues();

  let movimientos = [];
  for (let i = 1; i < data.length; i++) {
    if (!centro || normalizar(data[i][2]) === normalizar(centro)) {
      const item = {
        timestamp: fechaISO(data[i][0]),
        tipoCentro: data[i][1],
        tipoLugar: data[i][1],
        centro: data[i][2],
        lugar: data[i][2],
        insumo: data[i][3],
        tipo: data[i][4],
        tipoMovimiento: data[i][4],
        cantidad: data[i][5],
        unidad: data[i][6],
        voluntario: data[i][7],
        cantidadAcumulada: data[i][8],
        observaciones: data[i][9] || ""
      };
      movimientos.push(item);
    }
  }

  movimientos.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  movimientos = movimientos.slice(0, centro ? 50 : 100);

  return jsonResponse({ movimientos, historial: movimientos, total: movimientos.length });
}

// -- MOTORIZADOS ------------------------------------------------------------
function listarMotorizados() {
  const motorizados = construirMotorizados();
  return jsonResponse({ motorizados, total: motorizados.length });
}

function construirMotorizadosSeguro() {
  try {
    if (!obtenerHojaOpcional(MOTORIZADOS_SHEET) || !obtenerHojaOpcional(TRAYECTOS_SHEET)) return [];
    return construirMotorizados();
  } catch (err) {
    return [];
  }
}

function construirMotorizados() {
  const motorSheet = obtenerHoja(MOTORIZADOS_SHEET);
  const trajSheet = obtenerHoja(TRAYECTOS_SHEET);
  const motorData = motorSheet.getDataRange().getValues();
  const trajData = trajSheet.getDataRange().getValues();

  const totalesPorMotor = {};
  for (let i = 1; i < trajData.length; i++) {
    const row = trajData[i];
    const id = texto(row[1]);
    if (!id) continue;

    const km = parseFloat(row[5]) || 0;
    if (!totalesPorMotor[id]) {
      totalesPorMotor[id] = { trayectos: 0, km: 0 };
    }
    totalesPorMotor[id].trayectos++;
    totalesPorMotor[id].km += km;
  }

  const motorizados = [];
  for (let i = 1; i < motorData.length; i++) {
    const row = motorData[i];
    const id = texto(row[0]);
    if (!id) continue;

    const totales = totalesPorMotor[id] || {
      trayectos: numero(row[8], 0),
      km: numero(row[9], 0)
    };
    const estado = texto(row[6]) || "Activo";

    motorizados.push({
      id,
      nombre: row[1],
      tipoVehiculo: row[2],
      telefono: row[3],
      operaEn: row[4],
      zonaOperacion: row[4],
      placa: row[5],
      estado,
      activo: normalizar(estado) !== "inactivo",
      fechaRegistro: fechaISO(row[7]),
      totalTrayectos: totales.trayectos,
      totalKm: Math.round(totales.km * 10) / 10,
      aporteDonado: parseFloat(row[10]) || 0,
      verificado: esSi(row[11]),
      ultimoTrayecto: fechaISO(row[12])
    });
  }

  motorizados.sort(function (a, b) { return b.totalKm - a.totalKm; });
  return motorizados;
}

function obtenerPerfilMotorizado(id) {
  if (!id) return jsonResponse({ error: "Falta id de motorizado" }, 400);

  const motorSheet = obtenerHoja(MOTORIZADOS_SHEET);
  const motorData = motorSheet.getDataRange().getValues();

  let motorizado = null;
  for (let i = 1; i < motorData.length; i++) {
    if (String(motorData[i][0]) === String(id)) {
      motorizado = {
        id: motorData[i][0],
        nombre: motorData[i][1],
        tipoVehiculo: motorData[i][2],
        telefono: motorData[i][3],
        operaEn: motorData[i][4],
        zonaOperacion: motorData[i][4],
        placa: motorData[i][5],
        estado: motorData[i][6],
        aporteDonado: parseFloat(motorData[i][10]) || 0,
        verificado: esSi(motorData[i][11])
      };
      break;
    }
  }

  if (!motorizado) {
    return jsonResponse({ error: "Motorizado no encontrado" }, 404);
  }

  const trayectos = construirTrayectos(id);
  const donaciones = construirDonacionesMotorizado(id);

  return jsonResponse({ motorizado, trayectos, donaciones });
}

function registrarMotorizado(payload) {
  if (!payload.nombre || !payload.tipoVehiculo) {
    throw new Error("Faltan campos obligatorios: nombre, tipoVehiculo");
  }

  const operaEn = texto(payload.operaEn || payload.zonaOperacion);
  if (!operaEn) throw new Error("Falta el campo operaEn");

  const motorSheet = obtenerHoja(MOTORIZADOS_SHEET);
  const id = generarIdMotorizado(motorSheet);

  motorSheet.appendRow([
    id,
    texto(payload.nombre),
    texto(payload.tipoVehiculo),
    texto(payload.telefono),
    operaEn,
    texto(payload.placa),
    "Activo",
    new Date(),
    0,
    0,
    0,
    "No",
    null
  ]);

  return jsonResponse({ success: true, exito: true, id });
}

function generarIdMotorizado(motorSheet) {
  const existentes = {};
  const data = motorSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existentes[String(data[i][0])] = true;
  }

  let id = "";
  do {
    id = "MOTO" + (Math.floor(Math.random() * 10000)).toString().padStart(4, "0");
  } while (existentes[id]);

  return id;
}

// -- TRAYECTOS --------------------------------------------------------------
function obtenerTrayectos(motorizado) {
  const trayectos = construirTrayectos(motorizado);
  return jsonResponse({ trayectos, total: trayectos.length });
}

function construirTrayectos(motorizado) {
  const sheet = obtenerHoja(TRAYECTOS_SHEET);
  const data = sheet.getDataRange().getValues();

  const trayectos = [];
  for (let i = 1; i < data.length; i++) {
    if (!motorizado || String(data[i][1]) === String(motorizado)) {
      const insumo = texto(data[i][7]);
      const cantidad = texto(data[i][8]);
      const unidad = texto(data[i][9]);
      const insumoTransportado = [insumo, cantidad && unidad ? cantidad + " " + unidad : cantidad || unidad]
        .filter(Boolean)
        .join(" · ");

      trayectos.push({
        timestamp: fechaISO(data[i][0]),
        idMotorizado: data[i][1],
        motorizadoId: data[i][1],
        nombreMotorizado: data[i][2],
        motorizadoNombre: data[i][2],
        origen: data[i][3],
        destino: data[i][4],
        km: data[i][5],
        kmRecorridos: data[i][5],
        minutos: data[i][6],
        tiempoMinutos: data[i][6],
        insumo,
        insumoTransportado: insumoTransportado || "Varios",
        cantidad: data[i][8],
        unidad: data[i][9],
        foto: data[i][10],
        notas: data[i][11] || "",
        observaciones: data[i][11] || "",
        verificado: esSi(data[i][12])
      });
    }
  }

  trayectos.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return trayectos;
}

function registrarTrayecto(payload) {
  const idMotorizado = texto(payload.idMotorizado || payload.motorizadoId);
  if (!idMotorizado || !payload.origen || !payload.destino) {
    throw new Error("Faltan campos obligatorios: idMotorizado, origen, destino");
  }

  const km = numero(payload.km != null ? payload.km : payload.kmRecorridos, 0);
  if (km <= 0) throw new Error("Los km recorridos deben ser mayores a 0");

  const ss = abrirSpreadsheet();
  const trajSheet = ss.getSheetByName(TRAYECTOS_SHEET);
  const motorSheet = ss.getSheetByName(MOTORIZADOS_SHEET);
  if (!trajSheet || !motorSheet) throw new Error("Faltan hojas de motorizados o trayectos");

  const ahora = new Date();
  let nombreMotorizado = texto(payload.nombreMotorizado);

  const motorData = motorSheet.getDataRange().getValues();
  let filaMotorizado = -1;
  let totalTrayectos = 0;
  let totalKm = 0;

  for (let i = 1; i < motorData.length; i++) {
    if (String(motorData[i][0]) === String(idMotorizado)) {
      filaMotorizado = i + 1;
      nombreMotorizado = nombreMotorizado || texto(motorData[i][1]);
      totalTrayectos = numero(motorData[i][8], 0) + 1;
      totalKm = numero(motorData[i][9], 0) + km;
      break;
    }
  }

  if (filaMotorizado === -1) throw new Error("No se encontro el motorizado indicado");

  trajSheet.appendRow([
    ahora,
    idMotorizado,
    nombreMotorizado,
    texto(payload.origen),
    texto(payload.destino),
    km,
    numero(payload.tiempoMinutos || payload.minutos, 0) || "",
    texto(payload.insumo || payload.insumoTransportado) || "Varios",
    payload.cantidad || "",
    texto(payload.unidad),
    texto(payload.foto),
    texto(payload.notas || payload.observaciones),
    "No"
  ]);

  motorSheet.getRange(filaMotorizado, 9).setValue(totalTrayectos);
  motorSheet.getRange(filaMotorizado, 10).setValue(totalKm);
  motorSheet.getRange(filaMotorizado, 13).setValue(ahora);

  return jsonResponse({
    success: true,
    exito: true,
    totalTrayectos,
    totalKm: Math.round(totalKm * 10) / 10
  });
}

// -- DONACIONES A MOTORIZADOS ---------------------------------------------
function donarMotorizado(payload) {
  const idMotorizado = texto(payload.idMotorizado || payload.motorizadoId);
  if (!idMotorizado) throw new Error("Falta idMotorizado");

  const monto = numero(payload.monto, 0);
  if (monto <= 0) throw new Error("El monto debe ser mayor a 0");

  const ss = abrirSpreadsheet();
  const donSheet = ss.getSheetByName(DONACIONES_SHEET);
  const motorSheet = ss.getSheetByName(MOTORIZADOS_SHEET);
  if (!donSheet || !motorSheet) throw new Error("Faltan hojas de donaciones o motorizados");

  const motorData = motorSheet.getDataRange().getValues();

  let filaMotorizado = -1;
  let nuevoAporte = monto;
  let nombreMotorizado = texto(payload.nombreMotorizado);

  for (let i = 1; i < motorData.length; i++) {
    if (String(motorData[i][0]) === String(idMotorizado)) {
      filaMotorizado = i + 1;
      nombreMotorizado = nombreMotorizado || texto(motorData[i][1]);
      const aporteActual = parseFloat(motorData[i][10]) || 0;
      nuevoAporte = aporteActual + monto;
      break;
    }
  }

  if (filaMotorizado === -1) return jsonResponse({ error: "Motorizado no encontrado" }, 404);

  donSheet.appendRow([
    new Date(),
    idMotorizado,
    nombreMotorizado,
    monto,
    texto(payload.tipo) || "Aporte",
    texto(payload.donanteName) || "Anonimo",
    texto(payload.mensaje),
    texto(payload.ciudad)
  ]);

  motorSheet.getRange(filaMotorizado, 11).setValue(nuevoAporte);

  return jsonResponse({ success: true, exito: true, aporteDonado: nuevoAporte });
}

function construirDonacionesMotorizado(id) {
  const sheet = obtenerHoja(DONACIONES_SHEET);
  const data = sheet.getDataRange().getValues();
  const donaciones = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(id)) {
      donaciones.push({
        timestamp: fechaISO(data[i][0]),
        idMotorizado: data[i][1],
        nombreMotorizado: data[i][2],
        monto: data[i][3],
        tipo: data[i][4],
        donante: data[i][5],
        mensaje: data[i][6],
        ciudad: data[i][7]
      });
    }
  }

  donaciones.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return donaciones;
}
