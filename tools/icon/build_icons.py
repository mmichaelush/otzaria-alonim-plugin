# -*- coding: utf-8 -*-
"""בונה את plugin/js/alonim-icons.js מתוך הגופן של FluentUI System Icons.

אותו גופן שאוצריא מציירת ממנו, ולכן האייקונים זהים לאלה שבממשק שלה. כדי להוסיף
אייקון: מוסיפים את שמו ל-ICONS ומריצים

    py -3 tools/icon/build_icons.py

דורש את חבילת Flutter `fluentui_system_icons` ב-pub cache (PUB_CACHE, ברירת
מחדל C:\\pubcache) ואת fontTools. הרישיון של האייקונים: MIT.

כלל ההכרעה של אוצריא (ICONS.md): שם שקיים גם בספריית `otzaria_icons` נפתר לגרסה
שלה. לכן, כשהמאגר המקומי של otzaria_icons זמין (OTZARIA_ICONS, ברירת מחדל
`../otzaria_icons`), האייקון נלקח משם (GPL-3.0, כמו מאגר התוסף), והדף נראה כמו
האפליקציה שבה הוא מוצג. אחרת — פלואנט.
"""
import os
import re
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

# `_filled` נטען מגופן אחר מ-`_regular`; מי שצריך מצב "פעיל" מבקש את שניהם.
ICONS = [
    'add_24_regular',
    'alert_24_regular',
    'alert_off_24_regular',
    'alert_24_filled',
    'arrow_clockwise_24_regular',
    'arrow_download_24_regular',
    'arrow_left_24_regular',
    'arrow_right_24_regular',
    'arrow_sort_24_regular',
    'arrow_sync_24_regular',
    'arrow_undo_24_regular',
    'arrow_export_24_regular',
    'arrow_import_24_regular',
    'book_open_24_regular',
    'bug_24_regular',
    'calendar_ltr_24_regular',
    'calendar_star_24_regular',
    'checkmark_24_regular',
    'checkmark_circle_24_regular',
    'checkmark_circle_24_filled',
    'chevron_down_24_regular',
    'chevron_left_24_regular',
    'chevron_right_24_regular',
    'chevron_up_24_regular',
    'circle_24_regular',
    'clock_24_regular',
    'copy_24_regular',
    'delete_24_regular',
    'dismiss_24_regular',
    'dismiss_circle_24_regular',
    'document_24_regular',
    'document_pdf_24_regular',
    'eye_24_regular',
    'eye_off_24_regular',
    'filter_24_regular',
    'folder_24_regular',
    'folder_open_24_regular',
    'globe_24_regular',
    'grid_24_regular',
    'history_24_regular',
    'info_24_regular',
    'keyboard_24_regular',
    'library_24_regular',
    'more_horizontal_24_regular',
    'news_24_regular',
    'open_24_regular',
    'pin_24_regular',
    'pin_24_filled',
    'prohibited_24_regular',
    'search_24_regular',
    'settings_24_regular',
    'shield_checkmark_24_regular',
    'star_24_regular',
    'star_24_filled',
    'tag_24_regular',
    'text_bullet_list_24_regular',
    'warning_24_regular',
    'wifi_off_24_regular',
    'bookmark_multiple_24_regular',
    'cloud_arrow_down_24_regular',
]

ROOT = Path(__file__).resolve().parents[2]
OTZARIA_SVG = Path(os.environ.get('OTZARIA_ICONS', ROOT.parents[3] / 'otzaria_icons')) / 'assets_src' / 'svg'
OUTPUT = ROOT / 'plugin' / 'js' / 'alonim-icons.js'
FONTS = {'regular': 'FluentSystemIcons-Regular.ttf', 'filled': 'FluentSystemIcons-Filled.ttf'}


def package_dir():
    cache = Path(os.environ.get('PUB_CACHE', r'C:\pubcache')) / 'hosted' / 'pub.dev'
    found = sorted(cache.glob('fluentui_system_icons-*'))
    if not found:
        sys.exit('fluentui_system_icons לא נמצאה ב-' + str(cache))
    return found[-1]


def codepoints(package):
    source = (package / 'lib' / 'src' / 'fluent_icons.dart').read_text(encoding='utf-8')
    pattern = re.compile(r'static const IconData (\w+) = IconData\((\d+)')
    return {name: int(code) for name, code in pattern.findall(source)}


def main():
    package = package_dir()
    fonts = {}
    for style, file in FONTS.items():
        font = TTFont(package / 'lib' / 'fonts' / file)
        fonts[style] = (font, font.getGlyphSet(), font.getBestCmap(), 24 / font['head'].unitsPerEm)
    codes = codepoints(package)

    entries = []
    for name in sorted(set(ICONS)):
        if name not in codes:
            sys.exit('אייקון לא קיים בגופן: ' + name)
        style = name.rsplit('_', 1)[1]
        _, glyphs, cmap, scale = fonts[style]
        pen = SVGPathPen(glyphs, ntos=lambda value: ('%.2f' % value).rstrip('0').rstrip('.'))
        glyphs[cmap[codes[name]]].draw(pen)
        own = OTZARIA_SVG / (name + '.svg')
        if own.exists():
            # האייקון של אוצריא עצמה: path בודד במערכת 24x24, בלי היפוך.
            d = re.search(r'<path[^>]*\sd="([^"]+)"', own.read_text(encoding='utf-8')).group(1)
            d = ' '.join(d.split())
            entries.append("    %s: { path: '%s', transform: '' }," % (name, d))
            continue
        entries.append(
            "    %s: { path: '%s', transform: 'translate(0 24) scale(%s -%s)' },"
            % (name, pen.getCommands(), round(scale, 6), round(scale, 6))
        )

    OUTPUT.write_text(
        TEMPLATE.replace('__SHAPES__', '\n'.join(entries)), encoding='utf-8', newline='\n'
    )
    print('%d icons -> %s' % (len(entries), OUTPUT))


TEMPLATE = """// נוצר מתוך FluentUI System Icons (רישיון MIT), באותה צורה שבה אוצריא
// מציירת אותם. כל אייקון הוא path במערכת 24×24. אין לערוך ידנית: להוספת
// אייקון — tools/icon/build_icons.py.
(function (root) {
  'use strict';
  const shapes = {
__SHAPES__
  };

  const SVG = 'http://www.w3.org/2000/svg';

  /** אלמנט SVG דקורטיבי (aria-hidden); הצבע בא מ-`currentColor`. */
  function icon(name, className) {
    const shape = shapes[name];
    if (!shape) throw new Error('unknown icon: ' + name);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', shape.path);
    if (shape.transform) path.setAttribute('transform', shape.transform);
    svg.appendChild(path);
    return svg;
  }

  const api = { icon, names: Object.keys(shapes) };
  const A = (root.Alonim = root.Alonim || {});
  A.Icons = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
"""

if __name__ == '__main__':
    main()
