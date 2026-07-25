#!/usr/bin/env node
// Prueba V01: solo el dueño de la reserva viva puede mover el insumo.
// El presupuesto ZZTEST se monta por SQL (no hace falta la ADMIN_KEY); este script
// recibe su token ya en estado "Comprada".
// Uso: ANON=... TOKEN=DV-... EMAIL_A=... PASS_A=... EMAIL_B=... PASS_B=... \
//        node scripts/verificar-v01-reserva.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, TOKEN, EMAIL_A, PASS_A, EMAIL_B, PASS_B } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

async function api(payload) {
  const r = await fetch(`${BASE}/functions/v1/api`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}
async function login(email, password) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falló para ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

// JPEG 1x1 válido, rellenado con un segmento COM hasta superar el mínimo de
// 1000 bytes que exige guardarFoto() en el backend.
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/aAAgBAQAAPwA/8H//2Q==',
  'base64');
const RELLENO = Buffer.from('ZZTEST'.repeat(300));
const COM = Buffer.concat([Buffer.from([0xff, 0xfe]),
  Buffer.from([(RELLENO.length + 2) >> 8, (RELLENO.length + 2) & 0xff]), RELLENO]);
const FOTO = 'data:image/jpeg;base64,' +
  Buffer.concat([JPEG_1X1.subarray(0, 2), COM, JPEG_1X1.subarray(2)]).toString('base64');

const fallos = [];
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? ' — ' + extra : ''}`);
  if (!cond) fallos.push(nombre);
};

const tokenA = await login(EMAIL_A, PASS_A);
const tokenB = await login(EMAIL_B, PASS_B);
const tk = TOKEN;

// 1) Reservar SIN sesión debe fallar
const sinSesion = await api({ accion: 'viaje_iniciar', token: tk, nombreTransportista: 'Intruso',
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('1. viaje_iniciar sin sesión es rechazado', sinSesion.body?.success === false, sinSesion.body?.error);

// 2) A reserva con sesión
const reservaA = await api({ accion: 'viaje_iniciar', token: tk, accessToken: tokenA,
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('2. A reserva con sesión', reservaA.body?.success !== false, reservaA.body?.error);

// 3) B no puede reservar lo ya reservado
const reservaB = await api({ accion: 'viaje_iniciar', token: tk, accessToken: tokenB,
  etaMinutos: 60, gps: { lat: 10.48, lng: -66.90 } });
ok('3. B no puede reservar lo de A', reservaB.body?.success === false, reservaB.body?.error);

// 4) B no puede avanzar el trabajo de A
const recogeB = await api({ accion: 'registrar_recogida', token: tk, accessToken: tokenB,
  fotoSitio: FOTO, fotoInsumo: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('4. B no puede recoger el trabajo de A', recogeB.body?.success === false, recogeB.body?.error);

// 5) A sí puede avanzar el suyo
const recogeA = await api({ accion: 'registrar_recogida', token: tk, accessToken: tokenA,
  fotoSitio: FOTO, fotoInsumo: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('5. A sí puede recoger el suyo', recogeA.body?.success !== false, recogeA.body?.error);

// 6) B no puede cerrar la entrega de A
const entregaB = await api({ accion: 'registrar_entrega_final', token: tk, accessToken: tokenB,
  nombreReceptor: 'ZZTEST receptor', fotoCentro: FOTO, gps: { lat: 10.48, lng: -66.90 } });
ok('6. B no puede entregar el trabajo de A', entregaB.body?.success === false, entregaB.body?.error);

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
