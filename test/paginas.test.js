/* LAS TRES PÁGINAS, Y LOS CONTRATOS QUE NO PUEDEN VERIFICARSE IMPORTANDO.
 *
 * Desde que la app se partió en `/`, `/login` y `/collection` hay cosas que tienen que
 * coincidir entre archivos que NO se pueden importar unos a otros: dos HTML, un script
 * clásico de `public/` que corre antes que cualquier módulo, y un JSON.
 *
 * Ahí no sirve el truco de siempre —importar la función en vez de copiarla— así que lo
 * único que queda es esto. Y hace falta de verdad, porque las tres formas de romperlo
 * fallan EN SILENCIO:
 *
 *   · si `reanudar.js` y `routes.js` dejan de coincidir, la app instalada cae en la landing
 *     y se queda ahí;
 *   · si la clave del token no es la misma, el que tiene sesión ve la página de venta;
 *   · si el cartel de «Cargando…» se desincroniza entre los dos HTML y `App.jsx`, se ve un
 *     parpadeo al montar y nadie lo relaciona con esto.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LOGIN, COLLECTION, pathFor } from '../src/routes.js'

const raiz = new URL('../', import.meta.url)
const leer = (p) => readFileSync(new URL(p, raiz), 'utf8')

const landing = leer('index.html')
const login = leer('login.html')
const coleccion = leer('collection.html')
const reanudar = leer('public/reanudar.js')
const app = leer('src/App.jsx')
const almacenamiento = leer('src/almacenamiento.js')
const reinstalar = leer('src/Reinstalar.jsx')
const manifest = JSON.parse(leer('public/manifest.webmanifest'))

const root = (html) => html.match(/<div id="root">.*?<\/div><\/div>/s)?.[0]

// ------------------------------------------------------- el cartel de «Cargando…»

test('los dos cascarones de la app dicen exactamente lo mismo en #root', () => {
  assert.ok(root(login), 'login.html no tiene el div #root en una línea')
  assert.equal(root(login), root(coleccion))
})

test('y eso es lo mismo que dibuja App.jsx mientras no sabe si hay sesión', () => {
  /* El estado `cuenta === undefined`. Si esto cambia en App.jsx y no en los HTML, al montar
     React reemplaza un cartel por otro distinto y se ve un salto. */
  assert.match(app, /cuenta === undefined\) return <div className="hoja"><p className="cargando">Cargando…<\/p><\/div>/)
  for (const html of [login, coleccion])
    assert.equal(root(html), '<div id="root"><div class="hoja"><p class="cargando">Cargando…</p></div></div>')
})

// --------------------------------------------------------------- la landing

test('la landing NO carga el bundle de la app', () => {
  /* Es la razón de que sea un documento aparte: un solo pedido y un solo pintado. El día
     que alguien le meta el bundle, la landing deja de tener sentido y además se lleva
     puesto el arranque de la única página que ve un desconocido. */
  assert.ok(!landing.includes('src/main.jsx'), 'la landing terminó cargando el bundle')
  for (const html of [login, coleccion]) assert.ok(html.includes('/src/main.jsx'))
})

test('reanudar.js va PRIMERO y SIN async ni defer', () => {
  /* Es toda la propiedad: con `async` o `defer` se pinta la landing antes de decidir, así
     que el que tiene sesión —o la app instalada— ve un flash de página de venta. */
  const etiqueta = landing.match(/<script[^>]*reanudar\.js[^>]*>/)
  assert.ok(etiqueta, 'la landing no carga reanudar.js')
  assert.ok(!/\basync\b|\bdefer\b/.test(etiqueta[0]), `reanudar.js no puede ser diferido: ${etiqueta[0]}`)
  /* Y antes que cualquier otro script, porque lo que sigue ya pinta. */
  const primero = landing.match(/<script[^>]*>/)
  assert.equal(primero[0], etiqueta[0])
})

test('la landing lleva <base href="/">, porque además es el 404 del sitio', () => {
  /* Pages sirve `index.html` con 200 en cualquier ruta que no exista. Sin el `<base>`, desde
     `/a/b/c` los relativos resuelven contra `/a/b/` y la landing se queda sin logo y —lo
     grave— sin `reanudar.js`, así que a esa persona ya no la redirige nadie. */
  assert.match(landing, /<base href="\/" ?\/?>/)
  const pos = landing.indexOf('<base')
  assert.ok(pos > 0 && pos < landing.indexOf('reanudar.js'), 'el <base> tiene que ir antes del primer relativo')
})

test('los botones de la landing llevan a /login, que es lo que dice routes.js', () => {
  assert.ok(landing.includes(`href="${LOGIN}?crear=1"`), 'falta el botón de crear cuenta')
  assert.ok(landing.includes(`href="${LOGIN}"`), 'falta el de ya tengo cuenta')
})

// ------------------------------------------- los contratos entre archivos sueltos

test('reanudar.js redirige a las MISMAS rutas que declara routes.js', () => {
  for (const ruta of [LOGIN, COLLECTION])
    assert.ok(reanudar.includes(`'${ruta}'`), `reanudar.js no menciona ${ruta}`)
})

test('reanudar.js usa la MISMA clave de token que almacenamiento.js', () => {
  const clave = almacenamiento.match(/CLAVE_TOKEN = '([^']+)'/)?.[1]
  assert.ok(clave, 'no se encontró CLAVE_TOKEN en almacenamiento.js')
  assert.ok(reanudar.includes(`'${clave}'`), `reanudar.js no usa ${clave}`)
})

test('la marca que deja reanudar.js es la que lee Reinstalar.jsx', () => {
  const puesta = reanudar.match(/DESDE_LA_RAIZ = '([^']+)'/)?.[1]
  const leida = reinstalar.match(/MARCA = '([^']+)'/)?.[1]
  assert.ok(puesta, 'reanudar.js no define la marca')
  assert.equal(leida, puesta)
})

// ------------------------------------------------------------------ el manifest

test('el manifest declara `id`, sin el cual mover start_url deja huérfanas las instalaciones', () => {
  assert.equal(manifest.id, '/')
})

test('start_url abre las cartas y cae adentro del scope', () => {
  assert.equal(manifest.start_url, COLLECTION)
  assert.equal(manifest.scope, '/')
  assert.ok(manifest.start_url.startsWith(manifest.scope),
    'un start_url fuera del scope abre la app en una pestaña con barra de direcciones')
})

// ------------------------------------------------------------------ pathFor

test('pathFor no toca la dirección mientras no se sabe si hay sesión', () => {
  /* `undefined` es «todavía no sé». Devolver una ruta acá haría parpadear /login en cada
     carga de alguien que sí tiene sesión. */
  assert.equal(pathFor(undefined), null)
  assert.equal(pathFor(null), LOGIN)
  assert.equal(pathFor({ usuario: 'angel' }), COLLECTION)
})
