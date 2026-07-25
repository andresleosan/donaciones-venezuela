#!/usr/bin/env node
// Prueba V03: la lista pública de ofertas no puede exponer PII del donante.
// Uso: ANON=... node scripts/verificar-v03-contacto.mjs
const BASE = 'https://zryfwbjvlacorryzdaod.supabase.co';
const { ANON } = process.env;
const H = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

const res = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H, body: JSON.stringify({ accion: 'listar_ofertas' }) })).json();
const ofertas = res.ofertas || [];

const fallos = [];
const ok = (n, c, extra = '') => { console.log(`${c ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); if (!c) fallos.push(n); };

ok('0. Hay al menos una oferta para revisar', ofertas.length > 0, `${ofertas.length} ofertas`);
const conTel   = ofertas.filter((o) => o.telefono);
const conNom   = ofertas.filter((o) => o.nombreDonante);
const conCoord = ofertas.filter((o) => o.coords);
const conDir   = ofertas.filter((o) => o.ubicacion);

ok('1. Ninguna oferta expone teléfono', conTel.length === 0, `${conTel.length} con teléfono`);
ok('2. Ninguna oferta expone el nombre del donante', conNom.length === 0, `${conNom.length} con nombre`);
ok('3. Ninguna oferta expone coordenadas exactas', conCoord.length === 0, `${conCoord.length} con coords`);
ok('3b. Ninguna oferta expone la referencia exacta del sitio', conDir.length === 0, `${conDir.length} con ubicacion`);

// Las coords aproximadas sí deben venir, con 2 decimales como máximo.
const aprox = ofertas.filter((o) => o.coordsAprox);
const bienRedondeadas = aprox.every((o) =>
  Math.abs(o.coordsAprox.lat * 100 - Math.round(o.coordsAprox.lat * 100)) < 1e-9 &&
  Math.abs(o.coordsAprox.lng * 100 - Math.round(o.coordsAprox.lng * 100)) < 1e-9);
ok('4. coordsAprox viene redondeada a 2 decimales', aprox.length > 0 && bienRedondeadas,
   `${aprox.length} con coordsAprox`);

// reserva_detalle sin sesión debe rechazar.
const sinSesion = await (await fetch(`${BASE}/functions/v1/api`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ accion: 'reserva_detalle', token: ofertas[0]?.token || 'DV-XXXX-XXXX-XXXX' }) })).json();
ok('5. reserva_detalle sin sesión es rechazado', sinSesion?.success === false, sinSesion?.error);

console.log(fallos.length ? `\n❌ ${fallos.length} prueba(s) fallaron` : '\n✅ Todas las pruebas pasaron');
process.exit(fallos.length ? 1 : 0);
