#!/usr/bin/env node
// Prueba de la consola de datos del admin.
// Uso: ANON=... ADMINKEY=... node scripts/verificar-admin-datos.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, ADMINKEY } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

async function api(payload) {
  const r = await fetch(`${BASE}/functions/v1/api`, {
    method: 'POST', headers: H, body: JSON.stringify(payload) });
  return await r.json().catch(() => null);
}
const adm = (payload) => api({ ...payload, adminKey: ADMINKEY });

const fallos = [];
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? ' — ' + String(extra).slice(0, 90) : ''}`);
  if (!cond) fallos.push(nombre);
};

// ---------- Permisos ----------
const sinClave = await api({ accion: 'admin_datos_listar', entidad: 'voluntarios' });
ok('1. Sin clave de admin es rechazado', sinClave?.success === false, sinClave?.error);

const claveMala = await api({ accion: 'admin_datos_listar', entidad: 'voluntarios', adminKey: 'no-es-la-clave' });
ok('2. Con clave incorrecta es rechazado', claveMala?.success === false, claveMala?.error);

// ---------- Lista blanca de entidades ----------
const fuera = await adm({ accion: 'admin_datos_listar', entidad: 'config' });
ok('3. Una entidad fuera del registro es rechazada', fuera?.success === false, fuera?.error);

const inventada = await adm({ accion: 'admin_datos_listar', entidad: 'no_existe' });
ok('4. Una entidad inventada es rechazada', inventada?.success === false, inventada?.error);

// ---------- Listar ----------
const lista = await adm({ accion: 'admin_datos_listar', entidad: 'lugares' });
ok('5. Lista lugares', Array.isArray(lista?.filas) && lista.filas.length > 0,
   `${lista?.filas?.length} filas, total ${lista?.total}`);
ok('6. La lista trae el total para paginar', Number.isFinite(lista?.total), lista?.total);

const buscada = await adm({ accion: 'admin_datos_listar', entidad: 'lugares', busca: 'hatillo' });
ok('7. El buscador filtra en el servidor',
   Array.isArray(buscada?.filas) && buscada.filas.length < (lista?.filas?.length || 99),
   `${buscada?.filas?.length} de ${lista?.filas?.length}`);

// ---------- Ficha ----------
const idLugar = lista?.filas?.[0]?.id;
const ficha = await adm({ accion: 'admin_datos_ficha', entidad: 'lugares', id: idLugar });
ok('8. La ficha trae la fila', !!ficha?.fila && String(ficha.fila.id) === String(idLugar));
ok('9. La ficha dice qué arrastra al borrar', Array.isArray(ficha?.dependientes),
   JSON.stringify(ficha?.dependientes));

// ---------- Catálogo de entidades ----------
const cat = await adm({ accion: 'admin_datos_entidades' });
ok('10. El catálogo lista las entidades y sus columnas',
   Array.isArray(cat?.entidades) && cat.entidades.length >= 8,
   `${cat?.entidades?.length} entidades`);

// ---------- Crear ----------
const nuevo = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana@example.com',
            telefono: '04120000001', ciudad: 'Chacao', profesion: 'Médica' } });
ok('11. Crea un voluntario', !!nuevo?.fila?.id, nuevo?.error || nuevo?.fila?.id);
const idVol = nuevo?.fila?.id;

// ---------- Columna fuera de la lista blanca ----------
const colProhibida = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { foto_cedula: 'ruta/falsa.jpg' } });
ok('12. Una columna fuera de la lista blanca es rechazada',
   colProhibida?.success === false, colProhibida?.error);

// Se usa un acceso REAL: con un id inventado la prueba pasaría por el motivo
// equivocado («no se encontró») en vez de por la lista blanca.
const accesos = await adm({ accion: 'admin_datos_listar', entidad: 'centros_panel' });
const idAcceso = accesos?.filas?.[0]?.id;
const pinProhibido = await adm({ accion: 'admin_datos_editar', entidad: 'centros_panel',
  id: idAcceso, campos: { pin_hash: 'x' } });
ok('13. pin_hash no se puede editar',
   pinProhibido?.success === false && /no se puede editar/i.test(pinProhibido?.error || ''),
   pinProhibido?.error);

// ---------- Validación ----------
const correoMalo = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { email: 'esto-no-es-un-correo' } });
ok('14. Rechaza un correo con formato inválido', correoMalo?.success === false, correoMalo?.error);

const sinNombre = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: '', telefono: '04120000009' } });
ok('15. Rechaza un obligatorio vacío', sinNombre?.success === false, sinNombre?.error);

// ---------- Duplicados ----------
const dup = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios',
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana@example.com' } });
ok('16. Avisa del duplicado en vez de crearlo',
   Array.isArray(dup?.duplicados) && dup.duplicados.length > 0 && !dup?.fila,
   JSON.stringify(dup?.duplicados));

const forzado = await adm({ accion: 'admin_datos_crear', entidad: 'voluntarios', forzar: true,
  campos: { nombre: 'ZZTEST Ana', apellido: 'Prueba', email: 'zztest.ana2@example.com',
            telefono: '04120000002' } });
ok('17. Con forzar:true lo crea igualmente', !!forzado?.fila?.id, forzado?.error);
const idVol2 = forzado?.fila?.id;

const grupos = await adm({ accion: 'admin_datos_duplicados', entidad: 'voluntarios' });
ok('18. El panel de duplicados los agrupa',
   Array.isArray(grupos?.grupos) && grupos.grupos.some((g) => g.filas.length > 1),
   `${grupos?.grupos?.length} grupos`);

// ---------- Editar ----------
const editado = await adm({ accion: 'admin_datos_editar', entidad: 'voluntarios',
  id: idVol, campos: { ciudad: 'Petare' } });
ok('19. Edita y dice qué cambió', editado?.fila?.ciudad === 'Petare',
   JSON.stringify(editado?.cambiados));

// ---------- Bitácora ----------
const bit = await adm({ accion: 'admin_bitacora', entidad: 'voluntarios' });
const cambioEdicion = (bit?.cambios || []).find(
  (c) => c.accion === 'editar' && String(c.fila_id) === String(idVol));
ok('20. La bitácora guarda antes y después',
   !!cambioEdicion && cambioEdicion.antes?.ciudad === 'Chacao' && cambioEdicion.despues?.ciudad === 'Petare',
   cambioEdicion ? `${cambioEdicion.antes?.ciudad} → ${cambioEdicion.despues?.ciudad}` : 'sin fila');

// ---------- Deshacer ----------
const deshecho = await adm({ accion: 'admin_datos_deshacer', auditoriaId: cambioEdicion?.id });
ok('21. Deshacer devuelve el valor anterior', deshecho?.fila?.ciudad === 'Chacao',
   deshecho?.error || deshecho?.fila?.ciudad);

// ---------- Borrar ----------
const sinConfirmar = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios', id: idVol2 });
ok('22. Borrar sin escribir el nombre es rechazado', sinConfirmar?.success === false, sinConfirmar?.error);

const malConfirmado = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios',
  id: idVol2, confirmar: 'otro nombre' });
ok('23. Borrar con el nombre equivocado es rechazado', malConfirmado?.success === false, malConfirmado?.error);

const borrado = await adm({ accion: 'admin_datos_borrar', entidad: 'voluntarios',
  id: idVol2, confirmar: 'ZZTEST Ana' });
ok('24. Borra al escribir el nombre', borrado?.borrado === true, borrado?.error);

const yaNoEsta = await adm({ accion: 'admin_datos_ficha', entidad: 'voluntarios', id: idVol2 });
ok('25. El borrado ya no aparece', yaNoEsta?.success === false, yaNoEsta?.error);

// ---------- Aviso de cascada ----------
const cre = await adm({ accion: 'admin_datos_crear', entidad: 'lugares',
  campos: { tipo: 'Centro', nombre: 'ZZTEST Centro Cascada', ubicacion: 'Av prueba',
            telefono: '04120000003', lat: 10.48, lng: -66.9 } });
const idLug = cre?.fila?.id;
ok('26. Crea un centro de prueba', !!idLug, cre?.error);

await adm({ accion: 'admin_datos_crear', entidad: 'insumos',
  campos: { lugar_id: idLug, nombre: 'ZZTEST Gasas', categoria: 'General', estado: 'Necesita',
            cantidad_necesaria: 10, cantidad_recibida: 0, urgencia: 'Normal', unidad: 'cajas' } });

const fichaLug = await adm({ accion: 'admin_datos_ficha', entidad: 'lugares', id: idLug });
const avisoInsumos = (fichaLug?.dependientes || []).find((d) => d.etiqueta === 'insumos');
ok('27. La ficha avisa de los insumos que arrastra',
   !!avisoInsumos && avisoInsumos.cuantos === 1 && avisoInsumos.modo === 'cascade',
   JSON.stringify(fichaLug?.dependientes));

const borrLug = await adm({ accion: 'admin_datos_borrar', entidad: 'lugares',
  id: idLug, confirmar: 'ZZTEST Centro Cascada' });
ok('28. Borra el centro y devuelve lo que arrastró', borrLug?.borrado === true,
   JSON.stringify(borrLug?.dependientes));

const insumosHuerfanos = await adm({ accion: 'admin_datos_listar', entidad: 'insumos', busca: 'ZZTEST Gasas' });
ok('29. La cascada se llevó el insumo', (insumosHuerfanos?.filas || []).length === 0,
   `${insumosHuerfanos?.filas?.length} insumos`);

// ---------- La bitácora registró el borrado ----------
const bitBorra = await adm({ accion: 'admin_bitacora', entidad: 'lugares' });
const filaBorrado = (bitBorra?.cambios || []).find(
  (c) => c.accion === 'borrar' && String(c.fila_id) === String(idLug));
ok('30. La bitácora guarda la fila borrada entera',
   !!filaBorrado && filaBorrado.antes?.fila?.nombre === 'ZZTEST Centro Cascada',
   filaBorrado ? JSON.stringify(filaBorrado.antes?.dependientes) : 'sin fila');

console.log(`ZZTEST_LUGAR=${idLug}`);

console.log(`\nZZTEST_VOLUNTARIOS=${idVol},${idVol2}`);

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
