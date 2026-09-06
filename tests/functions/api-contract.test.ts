import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ESTADOS_INSUMO,
  TOKEN_ALFABETO,
  TOKEN_PATRON,
  claveDocumento,
  coordsAproximadas,
  emailNorm,
  geoValida,
  kmEntre,
  mov,
  n,
  normalizar,
  numeroFactura,
  objetivoNecesidad,
  opcion,
  s,
  soloDigitos,
  tokenAlfa,
} from '../../functions/src/api/contract.js';

describe('helpers de entrada', () => {
  it('s recorta, trunca y nunca devuelve null', () => {
    expect(s('  hola  ')).toBe('hola');
    expect(s(null)).toBe('');
    expect(s(undefined)).toBe('');
    expect(s(12)).toBe('12');
    expect(s('x'.repeat(400))).toHaveLength(300);
    expect(s('abcdef', 3)).toBe('abc');
  });

  it('n devuelve numero finito o 0', () => {
    expect(n('12.5')).toBe(12.5);
    expect(n('abc')).toBe(0);
    expect(n(Infinity)).toBe(0);
    expect(n(null)).toBe(0);
  });

  it('emailNorm normaliza a minusculas y rechaza invalidos', () => {
    expect(emailNorm(' Ana@Ejemplo.COM ')).toBe('ana@ejemplo.com');
    expect(emailNorm('sin-arroba')).toBe('');
    expect(emailNorm('a@b.c')).toBe('');
    expect(emailNorm('a b@c.de')).toBe('');
  });

  it('normalizar quita acentos y mayusculas como norm_insumo', () => {
    expect(normalizar('  Guantes Quirúrgicos ')).toBe('guantes quirurgicos');
    expect(normalizar('ÁGUA')).toBe('agua');
    expect(normalizar(null)).toBe('');
  });

  it('claveDocumento produce ids seguros sin barras', () => {
    expect(claveDocumento('PRUEBA · Hospital Vargas / La Guaira')).toBe('prueba-hospital-vargas-la-guaira');
    expect(claveDocumento('---')).toBe('');
    expect(claveDocumento('x'.repeat(200))).toHaveLength(120);
  });

  it('soloDigitos deja solo numeros', () => {
    expect(soloDigitos('+58 (212) 000-0001')).toBe('582120000001');
  });
});

describe('tokens y numeracion', () => {
  it('tokenAlfa usa el alfabeto sin 0/O/1/I y el formato PREFIJO-XXXX-XXXX-XXXX', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = tokenAlfa('DV');
      expect(token).toMatch(TOKEN_PATRON.DV);
      for (const ch of token.replace('DV-', '').replace(/-/g, '')) {
        expect(TOKEN_ALFABETO).toContain(ch);
      }
    }
    expect(TOKEN_ALFABETO).not.toMatch(/[0O1I]/);
  });

  it('tokenAlfa es determinista con un generador inyectado', () => {
    const fijo = (length: number) => new Uint8Array(length);
    expect(tokenAlfa('CTR', fijo)).toBe('CTR-AAAA-AAAA-AAAA');
  });

  it('numeroFactura formatea FAC-YYYY-NNNNNN y rechaza secuencias invalidas', () => {
    expect(numeroFactura(2026, 7)).toBe('FAC-2026-000007');
    expect(numeroFactura(2026, 1234567)).toBe('FAC-2026-1234567');
    expect(() => numeroFactura(2026, 0)).toThrow('numero-factura-invalido');
    expect(() => numeroFactura(2026.5, 1)).toThrow('numero-factura-invalido');
  });

  it('mov serializa codigo + datos y objetivoNecesidad usa la flecha del legado', () => {
    expect(JSON.parse(mov('dineroRecibido', { referencia: 'REF-1' })))
      .toEqual({ k: 'mov', c: 'dineroRecibido', referencia: 'REF-1' });
    expect(objetivoNecesidad('Agua potable', 'Hospital Vargas')).toBe('Agua potable → Hospital Vargas');
  });
});

describe('geografia', () => {
  it('geoValida acepta solo coordenadas dentro de Venezuela', () => {
    expect(geoValida({ lat: 10.48, lng: -66.9 })).toEqual({ lat: 10.48, lng: -66.9 });
    expect(geoValida({ lat: '10.48', lng: '-66.9' })).toEqual({ lat: 10.48, lng: -66.9 });
    expect(geoValida({ lat: 40.4, lng: -3.7 })).toEqual({ lat: null, lng: null });
    expect(geoValida({ lat: 'x', lng: -66.9 })).toEqual({ lat: null, lng: null });
    expect(geoValida({})).toEqual({ lat: null, lng: null });
  });

  it('kmEntre calcula haversine con un decimal', () => {
    expect(kmEntre(10.4806, -66.9036, 10.4806, -66.9036)).toBe(0);
    const caracasLaGuaira = kmEntre(10.4806, -66.9036, 10.6008, -66.933);
    expect(Math.abs(caracasLaGuaira - 13.7)).toBeLessThan(0.6);
    expect(String(caracasLaGuaira)).toMatch(/^\d+(\.\d)?$/);
  });

  it('coordsAproximadas redondea a 2 decimales', () => {
    expect(coordsAproximadas(10.48061, -66.90362)).toEqual({ lat: 10.48, lng: -66.9 });
  });
});

describe('estados y errores', () => {
  it('opcion devuelve el valor permitido o el defecto', () => {
    expect(opcion('Disponible', ESTADOS_INSUMO, 'Necesita')).toBe('Disponible');
    expect(opcion('otro', ESTADOS_INSUMO, 'Necesita')).toBe('Necesita');
    expect(opcion(undefined, ESTADOS_INSUMO, 'Necesita')).toBe('Necesita');
  });

  it('ApiError lleva status publico y 400 por defecto', () => {
    const e = new ApiError('nombre requerido');
    expect(e.status).toBe(400);
    expect(e.message).toBe('nombre requerido');
    expect(new ApiError('Factura no encontrada', 404).status).toBe(404);
    expect(e).toBeInstanceOf(Error);
  });
});
