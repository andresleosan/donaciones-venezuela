# Prueba E2E de idioma

Comprueba que la app funciona igual en español y en inglés: recorre las 14
vistas en los dos idiomas y busca texto del otro idioma, desbordes horizontales
y áreas táctiles por debajo de 44px. Hace cumplir las reglas R1.3 y R4.3 de
[`REGLAS.md`](../REGLAS.md).

Es una prueba de **lectura**: no escribe nada en la base de datos.

## Cuándo correrla

Antes de dar por bueno cualquier cambio que toque textos, vistas o el motor de
idioma. La otra guardia, `verificar-idioma.py`, revisa el **código**; esta revisa
la **app ya pintada**, que es donde aparecen los fallos que el código no delata.

## Cómo correrla

1. Abre la app en el navegador (producción o `python3 -m http.server`).
2. Ponla en tamaño **móvil** (390px de ancho). En Chrome: F12 → icono de móvil.
3. Abre la consola (F12 → Console) y pega **todo** el contenido de
   [`e2e-idioma.js`](e2e-idioma.js).
4. Ejecuta:

```js
await pruebaIdioma()
```

Tarda ~40 segundos (recorre 14 vistas × 2 idiomas, esperando a que cada una
cargue).

## Cómo se lee el resultado

```js
{ ok: true, ancho: 390, claves: { es: 1089, en: 1089 }, ingles: {}, espanol: {}, cambioEnCaliente: {...} }
```

- **`ok: true`** → nada que reportar. Es el único resultado aceptable.
- **`ingles` / `espanol`**: vistas con hallazgos. Por cada una:
  - `textoDelOtroIdioma`: cadenas que salieron en el idioma equivocado. Casi
    siempre significa que algo se pintó con `innerHTML` y no se re-renderiza al
    cambiar de idioma (regla R1.3).
  - `desbordeHorizontal`: la vista se sale de la pantalla.
  - `tactilesPequenos`: controles con menos de 44px de alto útil.
- **`cambioEnCaliente`**: el caso que más duele y que no se ve leyendo el código:
  cambiar de idioma **con la pantalla ya abierta**. Si aquí aparece texto del
  otro idioma, hay una vista dinámica sin enganchar al cambio de idioma.

## Falsos positivos ya descartados

No hace falta volver a investigarlos, el guion ya los filtra:

- **Textos de ejemplo** (claves que acaban en `Ph`/`Placeholder`, o `*.mock.*`):
  "Hospital Central de San Cristóbal" es a la vez un placeholder en español y el
  nombre real de un centro en la base. Verlo en la página en inglés no es fallo.
- **Casillas de verificación**: el área que se toca es la etiqueta que las
  envuelve (46px), no el cuadradito de 13px. El guion mide la etiqueta.

## Último resultado

2026-07-13, contra producción (v57) a 390px: **`ok: true`**. 1089 claves
paralelas en los dos idiomas, cero texto cruzado, cero desbordes, cero controles
pequeños, y el cambio de idioma en caliente sobre `#ofrecer` limpio.
