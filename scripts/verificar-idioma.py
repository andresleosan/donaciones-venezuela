#!/usr/bin/env python3
"""Guardia de idioma: falla si es.json y en.json se desincronizan, o si alguien
deja texto visible en español dentro del JavaScript.

Uso (desde la raíz del repo):
    python3 scripts/verificar-idioma.py

Sale con 0 si todo está bien, con 1 si hay algo que arreglar.
Reglas que hace cumplir: R1.1 y R1.2 de REGLAS.md.
"""
import glob
import json
import re
import sys

# Valores canónicos: se guardan en español en la base de datos a propósito y se
# traducen al mostrarlos (regla R1.5). No son texto cableado, son datos.
CANONICOS = {
    'Anónimo', 'Crítico', 'Centro de acopio', 'Punto de ayuda', 'Hospital',
    'Refugio', 'Zona de derrumbe', 'Insumos médicos', 'Material médico',
    'Kits de higiene', 'Plantas eléctricas', 'Analgésicos', 'Gasas estériles',
    'Sueros fisiológicos', 'Oxímetros', 'Pañales', 'Camión', 'Médico',
    'Psicólogo', 'Logística', 'Paramédico', 'Protección Civil',
    'Rescate Acuático', 'Transporte público', 'Ambulancia o unidad médica',
    'Unidad médica', 'Unidad de rescate pesado', 'Más de 10 personas',
    'Localizado con vida', 'Sin información reciente',
    # Denuncias (plan 01): tipo y estado canónicos, se traducen con tValue.
    'Retención de insumos', 'En revisión',
}

# El asistente interno de edición (?dev=1) es herramienta de trabajo, no
# producto: su texto se queda en español y no cuenta como fallo. La marca de
# inicio es la DEFINICIÓN, no el nombre suelto: si no, la línea que lo invoca
# vuelve a abrir el rango y el resto del archivo se queda sin revisar.
RANGO_WIDGET = ('function initEditAssistant', 'function editAssistantDisponible')


def aplanar(d, prefijo=''):
    plano = {}
    for clave, valor in d.items():
        if isinstance(valor, dict):
            plano.update(aplanar(valor, prefijo + clave + '.'))
        else:
            plano[prefijo + clave] = valor
    return plano


def revisar_locales(fallos):
    es = aplanar(json.load(open('locales/es.json', encoding='utf-8')))
    en = aplanar(json.load(open('locales/en.json', encoding='utf-8')))
    for clave in sorted(set(es) - set(en)):
        fallos.append(f'locales/en.json: falta la clave «{clave}» (existe en español)')
    for clave in sorted(set(en) - set(es)):
        fallos.append(f'locales/es.json: falta la clave «{clave}» (existe en inglés)')
    return len(es)


def revisar_js(fallos):
    acento = re.compile(r'[áéíóúñÁÉÍÓÚÑ¿¡]')
    for archivo in sorted(glob.glob('js/*.js') + glob.glob('services/*.js')):
        dentro_widget = False
        for n, linea in enumerate(open(archivo, encoding='utf-8'), 1):
            if RANGO_WIDGET[0] in linea:
                dentro_widget = True
            elif RANGO_WIDGET[1] in linea:
                dentro_widget = False
            if dentro_widget or linea.lstrip().startswith(('//', '*')):
                continue
            # tx()/traducir() llevan un texto de respaldo que solo se usa si t()
            # aún no cargó; su clave sí entra en la revisión de paridad.
            limpia = re.sub(r"(?:tx|traducir)\(\s*'[^']*'\s*,\s*'[^']*'", 'tx(', linea)
            limpia = re.sub(r'(?:tx|traducir)\(\s*"[^"]*"\s*,\s*"[^"]*"', 'tx(', limpia)
            # Ignora las claves que van dentro de t('...'): son identificadores.
            limpia = re.sub(r"t\(\s*'[^']*'", 't(', limpia)
            limpia = re.sub(r't\(\s*"[^"]*"', 't(', limpia)
            for m in re.finditer(r"'([^'\\\n]{6,})'|\"([^\"\\\n]{6,})\"", limpia):
                texto = m.group(1) or m.group(2)
                if texto in CANONICOS or not acento.search(texto):
                    continue
                # Trozos de HTML dentro de una plantilla (`>${…}</option>`) no son
                # literales de texto: el idioma lo pone la interpolación.
                if any(marca in texto for marca in ('${', '</', '><')):
                    continue
                # El nombre de cada idioma se escribe en su propio idioma.
                if texto in ('Español',):
                    continue
                fallos.append(f'{archivo}:{n}: texto en español fuera de t(): «{texto}»')


def main():
    fallos = []
    n_claves = revisar_locales(fallos)
    revisar_js(fallos)
    if fallos:
        print('\n'.join(fallos))
        print(f'\n{len(fallos)} problema(s) de idioma. Arréglalos antes de comitear.')
        return 1
    print(f'Idioma OK: {n_claves} claves paralelas en es/en, sin texto cableado en el JS.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
