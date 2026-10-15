/* LA HOJA DEL PANEL NO PUEDE PISAR CLASES DE LA APP.
 *
 * `dashboard.css` se carga al abrir el panel y queda cargada: una regla suelta ahí con un
 * nombre que la app ya usa sigue pegándole a la app después de cerrar el panel. Pasó dos
 * veces, y ninguna la avisó el build:
 *
 *   · `.barra` del panel pisó la barrita de progreso de cada expansión;
 *   · `.pie` de la torta de aparatos (2026-09-30) le achicó el pie de página de la app a
 *     una caja de 180×180 — medido: 1265×202 antes de abrir el panel, 180×180 después.
 *   (Los nombres son los de entonces: desde el 2026-09-30 la hoja va en inglés, y esas dos
 *   clases de la app son `.bar` y `.footer`.)
 *
 * La regla: cada selector de `dashboard.css` va colgado de algo del panel (`.stats`,
 * `.panel-page`, `.panel-*`, `.periods`, `.devices-*`, `body:has(...)`), o su primera
 * clase no puede existir en `styles.css`. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/* Todas las clases que la app usa en su hoja. */
const appClasses = new Set(
  [...withoutComments(read('styles.css')).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
)

/* Los selectores de nivel superior de la hoja del panel (los de adentro de un @media
   también: el `{` del @media se saltea porque su «selector» empieza con @). */
function selectors(css) {
  const out = []
  for (const m of withoutComments(css).matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim()
    if (!head || head.startsWith('@') || /^(from|to|\d+%)/.test(head)) continue
    for (const s of head.split(',')) out.push(s.trim())
  }
  return out
}

const SCOPED = /^(\.stats\b|\.panel-page\b|\.panel-|\.periods\b|\.devices-|body:has\()/

test('ninguna regla suelta de dashboard.css reusa una clase de la app', () => {
  const clashes = selectors(read('dashboard.css'))
    .filter((s) => !SCOPED.test(s))
    .map((s) => [s, s.match(/^\.([a-zA-Z][\w-]*)/)?.[1]])
    .filter(([, first]) => first && appClasses.has(first))
  assert.deepEqual(clashes, [], `estas reglas del panel pisan clases de la app: ${clashes.map(([s]) => s).join(' | ')}`)
})

/* Y LA MISMA COLISIÓN AL REVÉS, que es la que faltaba y pasó el 2026-10-15: el selector
   de álbum de la app se llamó `.collections` un rato, que es la clase del bloque «Las
   cartas» del panel (`.stats .group.collections`). `styles.css` la carga todo el mundo y
   el panel vive en el mismo documento, así que esa regla suelta le pegó adentro: apareció
   una pastilla blanca gigante sobre las barras de colección. La regla del panel no lo
   impide — es más específica, pero sólo gana en las propiedades que redefine, y no
   redefinía `display`, `background` ni `border-radius`.
 *
 * Así que una regla SUELTA de la app no puede llamarse como ninguna clase que el panel
 * nombre en sus selectores. Hoy la intersección es cero, así que el test exige cero. */
const panelClasses = new Set(
  [...withoutComments(read('dashboard.css')).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
)

test('ninguna regla suelta de styles.css pisa una clase del panel', () => {
  const clashes = selectors(read('styles.css'))
    .map((s) => [s, s.match(/^\.([a-zA-Z][\w-]*)/)?.[1]])
    .filter(([, first]) => first && panelClasses.has(first))
  assert.deepEqual(clashes, [],
    `estas reglas de la app pisan clases del panel: ${clashes.map(([s]) => s).join(' | ')}`)
})

test('y el lector de selectores ve las reglas de verdad (si no, el test de arriba no mira nada)', () => {
  const found = selectors(read('dashboard.css'))
  assert.ok(found.includes('.devices-pie'), 'no encontró .devices-pie')
  assert.ok(found.some((s) => s.startsWith('.stats ')), 'no encontró las reglas de .stats')
  assert.ok(appClasses.has('footer') && appClasses.has('bar'), 'no leyó las clases de la app')
})
