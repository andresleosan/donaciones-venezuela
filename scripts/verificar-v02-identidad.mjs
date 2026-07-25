#!/usr/bin/env node
// Prueba V02: acceso_perfil NO debe entregar el token del panel de un centro.
// Uso: ANON=... EMAIL_C=... PASS_C=... node scripts/verificar-v02-identidad.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON, EMAIL_C, PASS_C } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL_C, password: PASS_C }) });
const sesion = await r.json();
if (!sesion.access_token) throw new Error('login falló');

const perfil = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ accion: 'acceso_perfil', accessToken: sesion.access_token }) })).json();

const roles = perfil.roles || [];
const centro = roles.find((x) => x.tipo === 'centro');
const fallos = [];
const ok = (n, c, extra = '') => { console.log(`${c ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); if (!c) fallos.push(n); };

ok('1. Sigue reconociendo el rol de centro', !!centro, centro ? centro.nombre : 'sin rol centro');
ok('2. NO devuelve el token del panel', !!centro && !centro.token,
   centro && centro.token ? `FUGA: ${centro.token}` : 'sin token');

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
