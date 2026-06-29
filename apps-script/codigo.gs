/**
 * Donaciones Venezuela — Backend (Google Apps Script)
 * --------------------------------------------------------------------------
 * Lee la hoja `lugares`, agrupa las filas por lugar, calcula el matching
 * automático de insumos entre lugares y devuelve el JSON que consume index.html.
 *
 * Deploy: Extensiones > Apps Script  →  Implementar > Nueva implementación >
 *         Aplicación web  →  Ejecutar como: Yo  /  Acceso: Cualquier usuario.
 * Copia la URL .../exec resultante en index.html (constante APPS_SCRIPT_URL).
 */

// ── CONFIGURACIÓN (editar estas dos líneas) ───────────────────────────────
var SHEET_ID   = 'YOUR_SHEET_ID';   // <-- ID del Google Sheet (va entre /d/ y /edit en la URL)
var SHEET_NAME = 'lugares';         // <-- nombre de la pestaña/hoja

// ── PUNTO DE ENTRADA ──────────────────────────────────────────────────────
function doGet(e) {
  try {
    return responder({ lugares: leerLugares() });
  } catch (err) {
    return responder({ error: String(err && err.message ? err.message : err) });
  }
}

// Google Apps Script habilita CORS automáticamente para las web apps /exec.
function responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── NORMALIZACIÓN ─────────────────────────────────────────────────────────
// minúsculas + sin tildes/acentos + sin espacios sobrantes (para comparar insumos).
function normalizar(texto) {
  return String(texto == null ? '' : texto)
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

// ── LECTURA + AGRUPADO + MATCHING ─────────────────────────────────────────
function leerLugares() {
  var hoja = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!hoja) throw new Error('No existe la hoja "' + SHEET_NAME + '" en el Sheet indicado');

  var filas = hoja.getDataRange().getValues();
  if (filas.length < 2) return [];   // solo cabecera o vacía

  // Columnas A..H: Tipo, Nombre, Ubicacion, Telefono, Insumo, Categoria, Estado, Actualizado
  var lugares = {};       // clave (nombre normalizado) -> objeto lugar
  var disponibles = [];   // { insumo: normalizado, lugarClave }

  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    var nombre = String(f[1] || '').trim();
    if (!nombre) continue;

    var clave = normalizar(nombre);
    if (!lugares[clave]) {
      lugares[clave] = {
        tipo: String(f[0] || '').trim(),
        nombre: nombre,
        ubicacion: String(f[2] || '').trim(),
        telefono: String(f[3] || '').trim(),
        necesita: [],
        tiene_disponible: [],
        actualizado: f[7] ? new Date(f[7]).toISOString() : ''
      };
    }

    var insumo = String(f[4] || '').trim();
    if (!insumo) continue;
    var categoria = String(f[5] || '').trim();

    if (esTiene(f[6])) {
      lugares[clave].tiene_disponible.push({ nombre: insumo, categoria: categoria });
      disponibles.push({ insumo: normalizar(insumo), lugarClave: clave });
    } else if (esNecesita(f[6])) {
      lugares[clave].necesita.push({ nombre: insumo, categoria: categoria, coincidencias: [] });
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
