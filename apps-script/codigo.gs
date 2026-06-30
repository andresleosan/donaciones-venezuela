/**
 * Donaciones Venezuela - Backend (Google Apps Script)
 * --------------------------------------------------------------------------
 * Un solo Google Sheet con cinco pestanas:
 * centros_necesidades, motorizados, trayectos, historial_movimientos y
 * donaciones_motorizados.
 *
 * Deploy: Extensiones > Apps Script -> Implementar > Nueva implementacion >
 *         Aplicacion web -> Ejecutar como: Yo / Acceso: Cualquier usuario.
 * Copia la URL .../exec resultante en index.html (constante APPS_SCRIPT_URL).
 */

const SHEET_ID = "1fnXiSy1TbPqwlLKDSfPoBfKs8pH0WptoECGq_zu_Lco";
const CENTROS_SHEET = "centros_necesidades";
const MOTORIZADOS_SHEET = "motorizados";
const TRAYECTOS_SHEET = "trayectos";
const HISTORIAL_SHEET = "historial_movimientos";
const DONACIONES_SHEET = "donaciones_motorizados";

// -- PUNTOS DE ENTRADA ------------------------------------------------------
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const accion = params.accion;

    if (accion === "centros") return listarCentros();
    if (accion === "motorizados") return listarMotorizados();
    if (accion === "perfil_motorizado") return obtenerPerfilMotorizado(params.id);
    if (accion === "trayectos") return obtenerTrayectos(params.motorizado || params.motorizadoId || null);
    if (accion === "historial") return obtenerHistorialMovimientos(params.centro || params.lugar || null);

    const centros = construirCentros();
    const motorizados = construirMotorizados();
    return jsonResponse({ centros, lugares: centros, motorizados });
  } catch (err) {
    return jsonResponse({ error: errorMessage(err) }, 500);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const accion = payload.accion;

    if (accion === "registrar_movimiento") return registrarMovimiento(payload);
    if (accion === "registrar_trayecto") return registrarTrayecto(payload);
    if (accion === "donar_motorizado") return donarMotorizado(payload);
    if (accion === "registrar_motorizado") return registrarMotorizado(payload);

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

// -- CENTROS / DONACIONES ---------------------------------------------------
function listarCentros() {
  const centros = construirCentros();
  return jsonResponse({ centros, lugares: centros });
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
    } else {
      centroMap[key].necesita.push(insumo);
    }

    if (row[10]) centroMap[key].actualizado = fechaISO(row[10]);
  }

  return Object.keys(centroMap).map(function (key) { return centroMap[key]; });
}

function registrarMovimiento(payload) {
  if (!payload.nombreLugar || !payload.insumo || !payload.tipoMovimiento) {
    throw new Error("Faltan campos obligatorios: nombreLugar, insumo, tipoMovimiento");
  }

  const cantidad = numero(payload.cantidad, 0);
  if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0");

  const ss = abrirSpreadsheet();
  const centroSheet = ss.getSheetByName(CENTROS_SHEET);
  const histSheet = ss.getSheetByName(HISTORIAL_SHEET);
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

      centroSheet.getRange(i + 1, 8).setValue(nuevaCantidad); // H: CantidadRecibida
      centroSheet.getRange(i + 1, 11).setValue(new Date());   // K: Actualizado

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
  const sheet = obtenerHoja(HISTORIAL_SHEET);
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

  motorSheet.getRange(filaMotorizado, 9).setValue(totalTrayectos); // I: TotalTrayectos
  motorSheet.getRange(filaMotorizado, 10).setValue(totalKm);       // J: TotalKm
  motorSheet.getRange(filaMotorizado, 13).setValue(ahora);         // M: UltimoTrayecto

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

  motorSheet.getRange(filaMotorizado, 11).setValue(nuevoAporte); // K: AporteDonado

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
