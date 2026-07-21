-- ============================================================================
-- Semilla de datos de PRUEBA para donaciones-venezuela (plan 07 T6, decisión D1)
-- ----------------------------------------------------------------------------
-- Datos ficticios realistas para demostrar/simular la app sin tocar datos reales.
-- SE EJECUTA A MANO contra Supabase (SQL Editor o psql) — NUNCA desde el loop.
--
-- Todo lo sembrado lleva marcas reconocibles para poder limpiarlo:
--   · lugares/facturas   → nombre/objetivo con prefijo 'PRUEBA · '
--   · facturas           → token_publico 'DV-SEED-*', numero_factura 'FAC-SEED-*'
--   · motorizados/personas → email/contacto '%@prueba.local'
--
-- Idempotente: reejecutarlo NO duplica (insert ... where not exists / on conflict).
-- Coordenadas reales de Caracas / La Guaira.
--
-- LIMPIEZA: ver el bloque del final (borra SOLO lo marcado, en orden por FK).
-- ============================================================================

-- ---- 3 centros con coords reales -------------------------------------------
insert into lugares (tipo, nombre, ubicacion, telefono, lat, lng, actualizado)
select 'Hospital', 'PRUEBA · Hospital Vargas', 'La Guaira', '+58 212 000 0001', 10.60090, -66.93300, now()
where not exists (select 1 from lugares where nombre = 'PRUEBA · Hospital Vargas');

insert into lugares (tipo, nombre, ubicacion, telefono, lat, lng, actualizado)
select 'Ambulatorio', 'PRUEBA · Ambulatorio Centro', 'Caracas', '+58 212 000 0002', 10.50610, -66.91460, now()
where not exists (select 1 from lugares where nombre = 'PRUEBA · Ambulatorio Centro');

insert into lugares (tipo, nombre, ubicacion, telefono, lat, lng, actualizado)
select 'Refugio', 'PRUEBA · Refugio Catia', 'Catia, Caracas', '+58 212 000 0003', 10.52000, -66.95000, now()
where not exists (select 1 from lugares where nombre = 'PRUEBA · Refugio Catia');

-- ---- Necesidades (insumos) de esos centros ---------------------------------
-- La tabla insumos tiene índice único (lugar_id, nombre) → on conflict real.
insert into insumos (lugar_id, nombre, categoria, estado, cantidad_necesaria, cantidad_recibida, urgencia, unidad, actualizado)
select l.id, v.nombre, v.categoria, 'Necesita', v.cant, 0, v.urg, v.unidad, now()
from (values
  ('PRUEBA · Hospital Vargas',   'Agua potable',      'Alimentos', 500, 'Alta',  'litros'),
  ('PRUEBA · Hospital Vargas',   'Guantes quirúrgicos','Salud',     200, 'Alta',  'cajas'),
  ('PRUEBA · Ambulatorio Centro','Analgésicos',       'Salud',     100, 'Media', 'cajas'),
  ('PRUEBA · Refugio Catia',     'Colchonetas',       'Refugio',    80, 'Media', 'unidades')
) as v(centro, nombre, categoria, cant, urg, unidad)
join lugares l on l.nombre = v.centro
on conflict (lugar_id, nombre) do nothing;

-- ---- 2 presupuestos PAGADOS (Comprada) → listos para «iniciar viaje» -------
insert into facturas (numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado)
select 'FAC-SEED-0001', 'DV-SEED-C1',
  'PRUEBA · Agua potable → Hospital Vargas',
  json_build_object('k','pres','centro','PRUEBA · Hospital Vargas','insumo','Agua potable',
    'tienda','Farmatodo La Guaira','direccion','Av. Soublette','cantidad',500,'presentacion','botellas 1 L')::text,
  850, 850, 'Comprada'
where not exists (select 1 from facturas where token_publico = 'DV-SEED-C1');

insert into facturas (numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado)
select 'FAC-SEED-0002', 'DV-SEED-C2',
  'PRUEBA · Analgésicos → Ambulatorio Centro',
  json_build_object('k','pres','centro','PRUEBA · Ambulatorio Centro','insumo','Analgésicos',
    'tienda','Locatel Sabana Grande','direccion','Blvd. de Sabana Grande','cantidad',100,'presentacion','cajas x20')::text,
  420, 420, 'Comprada'
where not exists (select 1 from facturas where token_publico = 'DV-SEED-C2');

-- ---- 3 OFERTAS (Ofrecida) con coords de recogida + centro destino ----------
insert into facturas (numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado)
select 'FAC-SEED-0003', 'DV-SEED-O1',
  'PRUEBA · Oferta: Agua potable (portón azul)',
  json_build_object('k','oferta','insumo','Agua potable','cantidad',120,'unidad','litros',
    'ubicacion','Portón azul, El Paraíso','telefono','+58 414 000 0001','nombreDonante','PRUEBA · Ana Donante',
    'coords', json_build_object('lat',10.49500,'lng',-66.93500),'centro','PRUEBA · Hospital Vargas')::text,
  120, 0, 'Ofrecida'
where not exists (select 1 from facturas where token_publico = 'DV-SEED-O1');

insert into facturas (numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado)
select 'FAC-SEED-0004', 'DV-SEED-O2',
  'PRUEBA · Oferta: Colchonetas (casa 12)',
  json_build_object('k','oferta','insumo','Colchonetas','cantidad',30,'unidad','unidades',
    'ubicacion','Casa 12, La Vega','telefono','+58 414 000 0002','nombreDonante','PRUEBA · Beto Donante',
    'coords', json_build_object('lat',10.47800,'lng',-66.94500),'centro','PRUEBA · Refugio Catia')::text,
  30, 0, 'Ofrecida'
where not exists (select 1 from facturas where token_publico = 'DV-SEED-O2');

insert into facturas (numero_factura, token_publico, objetivo, descripcion, monto_requerido, monto_recaudado, estado)
select 'FAC-SEED-0005', 'DV-SEED-O3',
  'PRUEBA · Oferta: Analgésicos (local comercial)',
  json_build_object('k','oferta','insumo','Analgésicos','cantidad',40,'unidad','cajas',
    'ubicacion','Local 3, Chacao','telefono','+58 414 000 0003','nombreDonante','PRUEBA · Carla Donante',
    'coords', json_build_object('lat',10.49700,'lng',-66.85300),'centro','PRUEBA · Ambulatorio Centro')::text,
  40, 0, 'Ofrecida'
where not exists (select 1 from facturas where token_publico = 'DV-SEED-O3');

-- ---- 2 transportistas ------------------------------------------------------
insert into motorizados (id, email, nombre, tipo_vehiculo, telefono, zona_operacion, placa)
select 'MOT-SEED-1', 'ana.moto@prueba.local', 'PRUEBA · Ana Motorizada', 'Moto', '+58 424 000 0001', 'Caracas Oeste', 'AB123CD'
where not exists (select 1 from motorizados where email = 'ana.moto@prueba.local');

insert into motorizados (id, email, nombre, tipo_vehiculo, telefono, zona_operacion, placa)
select 'MOT-SEED-2', 'luis.moto@prueba.local', 'PRUEBA · Luis Motorizado', 'Camioneta', '+58 424 000 0002', 'La Guaira', 'EF456GH'
where not exists (select 1 from motorizados where email = 'luis.moto@prueba.local');

-- ---- 1 voluntario (persona reportada) --------------------------------------
insert into personas (nombre, cedula, estado, ubicacion, contacto, fuente, reportado_por, verificada)
select 'PRUEBA · Voluntaria Dora', 'V-00000001', 'Disponible para logística', 'Caracas',
       'dora.vol@prueba.local', 'Semilla', 'Semilla', false
where not exists (select 1 from personas where contacto = 'dora.vol@prueba.local');

-- ============================================================================
-- LIMPIEZA — ejecuta este bloque para borrar TODO lo sembrado (orden por FK):
-- ============================================================================
-- delete from movimientos_factura where factura_id in (select id from facturas where token_publico like 'DV-SEED-%');
-- delete from viajes              where factura_id in (select id from facturas where token_publico like 'DV-SEED-%');
-- delete from facturas            where token_publico like 'DV-SEED-%';
-- delete from insumos             where lugar_id in (select id from lugares where nombre like 'PRUEBA · %');
-- delete from lugares             where nombre like 'PRUEBA · %';
-- delete from motorizados         where email like '%@prueba.local';
-- delete from personas            where contacto like '%@prueba.local';
