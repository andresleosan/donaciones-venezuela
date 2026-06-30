/**
 * Donaciones Venezuela — Backend (Google Apps Script)
 * --------------------------------------------------------------------------
 * Lee la hoja `lugares`, agrupa las filas por lugar, calcula el matching
 * automático de insumos entre lugares y expone acciones de registro para
 * movimientos de donaciones, motorizados y trayectos.
 *
 * Deploy: Extensiones > Apps Script  →  Implementar > Nueva implementación >
 *         Aplicación web  →  Ejecutar como: Yo  /  Acceso: Cualquier usuario.
 * Copia la URL .../exec resultante en index.html (constante APPS_SCRIPT_URL).
 */

// ── CONFIGURACIÓN (editar estas dos líneas) ───────────────────────────────
var SHEET_ID = 'YOUR_SHEET_ID';      // <-- ID del Google Sheet (va entre /d/ y /edit en la URL)
var SHEET_NAME = 'lugares';          // <-- nombre de la pestaña/hoja

const HISTORIAL_SHEET_NAME = 'historial';
const MOTORIZADOS_SHEET_NAME = 'motorizados';
const TRAYECTOS_SHEET_NAME = 'trayectos';

// ── PUNTOS DE ENTRADA ────────────────────────────────────────────────────
function doGet(e) {
  try {
    var accion = e && e.parameter && e.parameter.accion;
    if (accion === 'historial') return obtenerHistorial(e.parameter.lugar || null);
    if (accion === 'motorizados') return obtenerMotorizados();
    if (accion === 'trayectos') return obtenerTrayectos(e.parameter.motorizadoId || null);

    return responder({ lugares: leerLugares() });
  } catch (err) {
    return responder({ error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);

    if (datos.accion === 'registrar_movimiento') return registrarMovimiento(datos);
    if (datos.accion === 'registrar_motorizado') return registrarMotorizado(datos);
    if (datos.accion === 'registrar_trayecto') return registrarTrayecto(datos);

    return agregarLugarInsumo(datos);
  } catch (err) {
    return responder({ success: false, exito: false, error: String(err && err.message ? err.message : err) });
  }
}

// Google Apps Script habilita CORS automáticamente para las web apps /exec.
function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(obj) {
  return responder(obj);
}

// ── UTILIDADES ────────────────────────────────────────────────────────────
function abrirSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function obtenerHoja(nombre) {
  var hoja = abrirSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la hoja "' + nombre + '" en el Sheet indicado');
  return hoja;
}

function obtenerHojaOpcional(nombre) {
  return abrirSpreadsheet().getSheetByName(nombre);
}

function numero(valor, fallback) {
  var n = Number(valor);
  return isNaN(n) ? (fallback || 0) : n;
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

// minúsculas + sin tildes/acentos + sin espacios sobrantes (para comparar insumos).
function normalizar(textoEntrada) {
  return String(textoEntrada == null ? '' : textoEntrada)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// "Necesita" / "Tiene disponible" tolerantes a mayúsculas y acentos.
function esNecesita(estado) {
  return normalizar(estado).indexOf('necesita') === 0;
}

function esTiene(estado) {
  var n = normalizar(estado);
  return n.indexOf('tiene') === 0 || n.indexOf('disponible') !== -1;
}

function crearInsumoDesdeFila(f) {
  var cantidadNecesaria = numero(f[8], 0);
  var cantidadRecibida = Math.max(0, numero(f[9], 0));
  if (cantidadNecesaria > 0) cantidadRecibida = Math.min(cantidadRecibida, cantidadNecesaria);

  var porcentaje = cantidadNecesaria > 0
    ? Math.min(100, Math.round((cantidadRecibida / cantidadNecesaria) * 100))
    : 0;

  return {
    nombre: texto(f[4]),
    categoria: texto(f[5]) || 'Otros',
    cantidadNecesaria: cantidadNecesaria,
    cantidadRecibida: cantidadRecibida,
    porcentaje: porcentaje,
    urgencia: texto(f[10]) || 'Normal',
    unidad: texto(f[11]) || 'unidades',
    yaCubierto: cantidadNecesaria > 0 && cantidadRecibida >= cantidadNecesaria,
    coincidencias: []
  };
}

// ── LECTURA + AGRUPADO + MATCHING ─────────────────────────────────────────
function leerLugares() {
  var hoja = obtenerHoja(SHEET_NAME);
  var filas = hoja.getDataRange().getValues();
  if (filas.length < 2) return [];   // solo cabecera o vacía

  // Columnas A..L:
  // Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado,
  // CantidadNecesaria, CantidadRecibida, Urgencia, Unidad
  var lugares = {};       // clave (nombre normalizado) -> objeto lugar
  var disponibles = [];   // { insumo: normalizado, lugarClave }

  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    var nombre = texto(f[1]);
    if (!nombre) continue;

    var clave = normalizar(nombre);
    if (!lugares[clave]) {
      lugares[clave] = {
        tipo: texto(f[0]),
        nombre: nombre,
        ubicacion: texto(f[2]),
        telefono: texto(f[3]),
        necesita: [],
        cubiertos: [],
        tiene_disponible: [],
        actualizado: f[7] ? new Date(f[7]).toISOString() : ''
      };
    }

    var insumo = texto(f[4]);
    if (!insumo) continue;

    if (esTiene(f[6])) {
      lugares[clave].tiene_disponible.push({ nombre: insumo, categoria: texto(f[5]) || 'Otros' });
      disponibles.push({ insumo: normalizar(insumo), lugarClave: clave });
    } else if (esNecesita(f[6])) {
      var item = crearInsumoDesdeFila(f);
      if (item.yaCubierto) {
        lugares[clave].cubiertos.push(item);
      } else {
        lugares[clave].necesita.push(item);
      }
    }
  }

  // Por cada necesidad, buscar el mismo insumo disponible en OTRO lugar.
  var lista = Object.keys(lugares).map(function (k) { return lugares[k]; });
  lista.forEach(function (lugar) {
    var claveLugar = normalizar(lugar.nombre);
    lugar.necesita.forEach(function (n) {
      var objetivo = normalizar(n.nombre);
      disponibles.forEach(function (d) {
        if (d.insumo === objetivo && d.lugarClave !== claveLugar) {
          var otro = lugares[d.lugarClave];
          n.coincidencias.push({
            nombre_lugar: otro.nombre,
            tipo: otro.tipo,
            telefono: otro.telefono,
            ubicacion: otro.ubicacion
          });
        }
      });
    });
  });

  return lista;
}

// ── ESCRITURA LEGACY: alta de lugar/insumo desde la app ───────────────────
function agregarLugarInsumo(datos) {
  if (!datos.tipo || !datos.nombre || !datos.insumo || !datos.estado) {
    throw new Error('Faltan campos obligatorios: tipo, nombre, insumo, estado');
  }

  var hoja = obtenerHoja(SHEET_NAME);

  // Columnas A..L: se preserva A-H y se inicializan I-L para necesidades.
  var esNecesidad = esNecesita(datos.estado);
  hoja.appendRow([
    texto(datos.tipo),
    texto(datos.nombre),
    texto(datos.ubicacion),
    texto(datos.telefono),
    texto(datos.insumo),
    texto(datos.categoria) || 'Otros',
    texto(datos.estado),
    new Date(),
    esNecesidad ? numero(datos.cantidadNecesaria, 0) : '',
    esNecesidad ? numero(datos.cantidadRecibida, 0) : '',
    esNecesidad ? (texto(datos.urgencia) || 'Normal') : '',
    esNecesidad ? (texto(datos.unidad) || 'unidades') : ''
  ]);

  return responder({ success: true, exito: true, mensaje: 'Lugar/insumo agregado exitosamente' });
}

// ── MOVIMIENTOS DE DONACIONES ─────────────────────────────────────────────
function registrarMovimiento(payload) {
  if (!payload.nombreLugar || !payload.insumo || !payload.tipoMovimiento) {
    throw new Error('Faltan campos obligatorios: nombreLugar, insumo, tipoMovimiento');
  }

  var cantidad = numero(payload.cantidad, 0);
  if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a 0');

  var hoja = obtenerHoja(SHEET_NAME);
  var filas = hoja.getDataRange().getValues();
  var filaEncontrada = -1;

  for (var i = 1; i < filas.length; i++) {
    if (normalizar(filas[i][1]) === normalizar(payload.nombreLugar) &&
        normalizar(filas[i][4]) === normalizar(payload.insumo)) {
      filaEncontrada = i + 1; // índice 1-based de Sheets
      break;
    }
  }

  if (filaEncontrada === -1) {
    throw new Error('No se encontró el insumo "' + payload.insumo + '" en "' + payload.nombreLugar + '"');
  }

  var fila = filas[filaEncontrada - 1];
  var cantidadNecesaria = numero(fila[8], 0);
  var cantidadActual = Math.max(0, numero(fila[9], 0));
  var tipoMov = texto(payload.tipoMovimiento);
  var nuevaCantidad = tipoMov === 'Salida'
    ? Math.max(0, cantidadActual - cantidad)
    : cantidadActual + cantidad;

  if (cantidadNecesaria > 0) nuevaCantidad = Math.min(nuevaCantidad, cantidadNecesaria);

  hoja.getRange(filaEncontrada, 10).setValue(nuevaCantidad); // J: CantidadRecibida
  hoja.getRange(filaEncontrada, 8).setValue(new Date());     // H: Actualizado

  var hojaHistorial = obtenerHoja(HISTORIAL_SHEET_NAME);
  hojaHistorial.appendRow([
    new Date(),
    texto(payload.tipoLugar) || texto(fila[0]),
    texto(payload.nombreLugar),
    texto(payload.insumo),
    texto(payload.categoria) || texto(fila[5]),
    tipoMov,
    cantidad,
    texto(payload.nombreVoluntario) || 'Anónimo',
    nuevaCantidad,
    texto(payload.observaciones)
  ]);

  return jsonResponse({
    success: true,
    nuevaCantidad: nuevaCantidad,
    tipoMovimiento: tipoMov,
    mensaje: 'Movimiento registrado'
  });
}

function obtenerHistorial(lugar) {
  var hoja = obtenerHojaOpcional(HISTORIAL_SHEET_NAME);
  if (!hoja) return jsonResponse({ historial: [], total: 0 });

  var data = hoja.getDataRange().getValues();
  var filas = data.slice(1);

  if (lugar) {
    filas = filas.filter(function (row) { return normalizar(row[2]) === normalizar(lugar); });
  }

  filas.sort(function (a, b) { return new Date(b[0]) - new Date(a[0]); });
  filas = filas.slice(0, 50);

  var historial = filas.map(function (row) {
    return {
      timestamp: row[0] ? new Date(row[0]).toISOString() : '',
      tipoLugar: row[1],
      lugar: row[2],
      insumo: row[3],
      categoria: row[4],
      tipoMovimiento: row[5],
      cantidad: row[6],
      voluntario: row[7],
      cantidadAcumulada: row[8],
      observaciones: row[9] || ''
    };
  });

  return jsonResponse({ historial: historial, total: historial.length });
}

// ── MOTORIZADOS ───────────────────────────────────────────────────────────
function registrarMotorizado(payload) {
  if (!payload.nombre || !payload.tipoVehiculo || !payload.zonaOperacion) {
    throw new Error('Faltan campos obligatorios: nombre, tipoVehiculo, zonaOperacion');
  }

  var hoja = obtenerHoja(MOTORIZADOS_SHEET_NAME);
  var data = hoja.getDataRange().getValues();
  var nombreNuevo = normalizar(payload.nombre);
  var placaNueva = normalizar(payload.placa || '');

  for (var i = 1; i < data.length; i++) {
    if (normalizar(data[i][1]) === nombreNuevo && normalizar(data[i][3] || '') === placaNueva) {
      throw new Error('Ya existe un motorizado registrado con ese nombre y placa');
    }
  }

  var nuevoId = 'MOT-' + Date.now().toString(36).toUpperCase();
  hoja.appendRow([
    nuevoId,
    texto(payload.nombre),
    texto(payload.tipoVehiculo),
    texto(payload.placa),
    texto(payload.zonaOperacion),
    texto(payload.telefono),
    0,
    0,
    true,
    new Date(),
    '',
    texto(payload.linkDonacion),
    texto(payload.infoDonacion)
  ]);

  return jsonResponse({
    success: true,
    id: nuevoId,
    nombre: texto(payload.nombre),
    mensaje: 'Motorizado registrado'
  });
}

function obtenerMotorizados() {
  var hoja = obtenerHojaOpcional(MOTORIZADOS_SHEET_NAME);
  if (!hoja) return jsonResponse({ motorizados: [], total: 0 });

  var data = hoja.getDataRange().getValues();
  var filas = data.slice(1);

  var motorizados = filas
    .filter(function (row) { return row[0] || row[1]; })
    .map(function (row) {
      return {
        id: row[0],
        nombre: row[1],
        tipoVehiculo: row[2],
        placa: row[3],
        zonaOperacion: row[4],
        telefono: row[5],
        totalTrayectos: numero(row[6], 0),
        totalKm: numero(row[7], 0),
        activo: row[8] === true || String(row[8]).toUpperCase() === 'TRUE',
        fechaRegistro: row[9] ? new Date(row[9]).toISOString() : '',
        ultimoTrayecto: row[10] ? new Date(row[10]).toISOString() : '',
        linkDonacion: row[11] || '',
        infoDonacion: row[12] || ''
      };
    });

  motorizados.sort(function (a, b) { return b.totalKm - a.totalKm; });

  return jsonResponse({ motorizados: motorizados, total: motorizados.length });
}

function registrarTrayecto(payload) {
  if (!payload.motorizadoId || !payload.origen || !payload.destino) {
    throw new Error('Faltan campos obligatorios: motorizadoId, origen, destino');
  }

  var km = numero(payload.kmRecorridos, 0);
  if (km <= 0) throw new Error('Los km recorridos deben ser mayores a 0');

  var hojaMotorizados = obtenerHoja(MOTORIZADOS_SHEET_NAME);
  var data = hojaMotorizados.getDataRange().getValues();
  var filaEncontrada = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(payload.motorizadoId)) {
      filaEncontrada = i + 1;
      break;
    }
  }

  if (filaEncontrada === -1) throw new Error('No se encontró el motorizado indicado');

  var fila = data[filaEncontrada - 1];
  var nombreMotorizado = texto(fila[1]);
  var totalTrayectos = numero(fila[6], 0) + 1;
  var totalKm = numero(fila[7], 0) + km;
  var ahora = new Date();

  hojaMotorizados.getRange(filaEncontrada, 7).setValue(totalTrayectos); // G
  hojaMotorizados.getRange(filaEncontrada, 8).setValue(totalKm);        // H
  hojaMotorizados.getRange(filaEncontrada, 11).setValue(ahora);         // K

  var hojaTrayectos = obtenerHoja(TRAYECTOS_SHEET_NAME);
  hojaTrayectos.appendRow([
    ahora,
    texto(payload.motorizadoId),
    nombreMotorizado,
    texto(payload.origen),
    texto(payload.destino),
    km,
    texto(payload.insumoTransportado) || 'Varios',
    texto(payload.observaciones)
  ]);

  return jsonResponse({
    success: true,
    totalTrayectos: totalTrayectos,
    totalKm: totalKm,
    mensaje: 'Trayecto registrado'
  });
}

function obtenerTrayectos(motorizadoId) {
  var hoja = obtenerHojaOpcional(TRAYECTOS_SHEET_NAME);
  if (!hoja) return jsonResponse({ trayectos: [], total: 0 });

  var data = hoja.getDataRange().getValues();
  var filas = data.slice(1);

  if (motorizadoId) {
    filas = filas.filter(function (row) { return String(row[1]) === String(motorizadoId); });
  }

  filas.sort(function (a, b) { return new Date(b[0]) - new Date(a[0]); });
  filas = filas.slice(0, motorizadoId ? 50 : 100);

  var trayectos = filas.map(function (row) {
    return {
      timestamp: row[0] ? new Date(row[0]).toISOString() : '',
      motorizadoId: row[1],
      motorizadoNombre: row[2],
      origen: row[3],
      destino: row[4],
      kmRecorridos: row[5],
      insumoTransportado: row[6],
      observaciones: row[7] || ''
    };
  });

  return jsonResponse({ trayectos: trayectos, total: trayectos.length });
}
