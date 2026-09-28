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
 *   · si `resume.js` y `routes.js` dejan de coincidir, la app instalada cae en la landing
 *     y se queda ahí;
 *   · si la key del token no es la misma, el que tiene sesión ve la página de venta;
 *   · si el cartel de «Cargando…» se desincroniza entre los dos HTML y `App.jsx`, se ve un
 *     parpadeo al montar y nadie lo relaciona con esto.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LOGIN, COLLECTION, pathFor } from '../src/routes.js'

const rootUrl = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, rootUrl), 'utf8')

const landing = read('index.html')
const login = read('login.html')
const collection = read('collection.html')
const resume = read('public/resume.js')
const app = read('src/App.jsx')
const storageSrc = read('src/almacenamiento.js')
const reinstall = read('src/Reinstall.jsx')
const manifest = JSON.parse(read('public/manifest.webmanifest'))

const root = (html) => html.match(/<div id="root">.*?<\/div><\/div>/s)?.[0]

// ------------------------------------------------------- el cartel de «Cargando…»

test('los dos cascarones de la app dicen exactamente lo mismo en #root', () => {
  assert.ok(root(login), 'login.html no tiene el div #root en una línea')
  assert.equal(root(login), root(collection))
})

test('y eso es lo mismo que dibuja App.jsx mientras no sabe si hay sesión', () => {
  /* El estado `cuenta === undefined`. Si esto cambia en App.jsx y no en los HTML, al montar
     React reemplaza un cartel por otro distinto y se ve un salto. */
  assert.match(app, /cuenta === undefined\) return <div className="hoja"><p className="cargando">Cargando…<\/p><\/div>/)
  for (const html of [login, collection])
    assert.equal(root(html), '<div id="root"><div class="hoja"><p class="cargando">Cargando…</p></div></div>')
})

// --------------------------------------------------------------- la landing

test('la landing NO carga el bundle de la app', () => {
  /* Es la razón de que sea un documento aparte: un solo pedido y un solo pintado. El día
     que alguien le meta el bundle, la landing deja de tener sentido y además se lleva
     puesto el arranque de la única página que ve un desconocido. */
  assert.ok(!landing.includes('src/main.jsx'), 'la landing terminó cargando el bundle')
  for (const html of [login, collection]) assert.ok(html.includes('/src/main.jsx'))
})

test('resume.js va PRIMERO y SIN async ni defer', () => {
  /* Es toda la propiedad: con `async` o `defer` se pinta la landing antes de decidir, así
     que el que tiene sesión —o la app instalada— ve un flash de página de venta. */
  const tag = landing.match(/<script[^>]*resume\.js[^>]*>/)
  assert.ok(tag, 'la landing no carga resume.js')
  assert.ok(!/\basync\b|\bdefer\b/.test(tag[0]), `resume.js no puede ser diferido: ${tag[0]}`)
  /* Y antes que cualquier otro script, porque lo que sigue ya pinta. */
  const primero = landing.match(/<script[^>]*>/)
  assert.equal(primero[0], tag[0])
})

test('la landing lleva <base href="/">, porque además es el 404 del sitio', () => {
  /* Pages sirve `index.html` con 200 en cualquier route que no exista. Sin el `<base>`, desde
     `/a/b/c` los relativos resuelven contra `/a/b/` y la landing se queda sin logo y —lo
     grave— sin `resume.js`, así que a esa persona ya no la redirige nadie. */
  assert.match(landing, /<base href="\/" ?\/?>/)
  const pos = landing.indexOf('<base')
  assert.ok(pos > 0 && pos < landing.indexOf('resume.js'), 'el <base> tiene que ir antes del primer relativo')
})

test('los botones de la landing llevan a /login, que es lo que dice routes.js', () => {
  assert.ok(landing.includes(`href="${LOGIN}?new=1"`), 'falta el botón de crear cuenta')
  assert.ok(landing.includes(`href="${LOGIN}"`), 'falta el de ya tengo cuenta')
})

test('el parámetro que pone la landing es el que lee Entrar.jsx', () => {
  /* Otro contrato entre un HTML y un módulo, o sea otro que no se puede verificar
     importando. Y falló de verdad: al pasar el nombre a inglés se cambió el `?crear=1` del
     enlace y NO el `get('crear')` del componente, así que el botón «Anotá tus faltantes»
     seguía abriendo el formulario en modo «Entrar». No lo agarró ningún test —el de arriba
     sólo mira el enlace— sino la prueba con clicks. */
  const enLaLanding = landing.match(new RegExp(`href="${LOGIN}\\?([a-z]+)=1"`))?.[1]
  const enElFormulario = read('src/Entrar.jsx').match(/location\.search\)\.get\('([^']+)'\)/)?.[1]
  assert.ok(enLaLanding, 'la landing no lleva ningún parámetro')
  assert.equal(enElFormulario, enLaLanding)
})

// ------------------------------------------- los contratos entre archivos sueltos

test('resume.js redirige a las MISMAS rutas que declara routes.js', () => {
  for (const route of [LOGIN, COLLECTION])
    assert.ok(resume.includes(`'${route}'`), `resume.js no menciona ${route}`)
})

test('resume.js usa la MISMA key de token que almacenamiento.js', () => {
  const key = storageSrc.match(/CLAVE_TOKEN = '([^']+)'/)?.[1]
  assert.ok(key, 'no se encontró CLAVE_TOKEN en almacenamiento.js')
  assert.ok(resume.includes(`'${key}'`), `resume.js no usa ${key}`)
})

test('la marca que deja resume.js es la que lee Reinstall.jsx', () => {
  const written = resume.match(/FROM_ROOT = '([^']+)'/)?.[1]
  const gotten = reinstall.match(/MARK = '([^']+)'/)?.[1]
  assert.ok(written, 'resume.js no define la marca')
  assert.equal(gotten, written)
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

// --------------------------------------------- la dirección que sale del sitio

test('el footer del texto exportado lleva https://, que es lo que lo hace tocable', () => {
  /* Ese texto se pega en un grupo de WhatsApp, y es la única vía por la que alguien que no
     conoce la app llega a ella. Medido por Angel el 2026-09-28 mandándoselo a sí mismo: con
     la dirección pelada NO ANDUVO — sin el esquema el cliente no arma el enlace ni la
     tarjeta, o la resuelve como `http://` y se come un 301 (comprobado contra producción).
     `Exportar.jsx` tiene JSX adentro, así que no se puede importar desde acá; se lee. */
  const exportSrc = read('src/Exportar.jsx')
  const footer = exportSrc.match(/const PIE = '([^']+)'/)?.[1]
  assert.ok(footer, 'no se encontró el footer del texto exportado')
  assert.ok(footer.startsWith('https://'), `el footer tiene que llevar el esquema: ${footer}`)
})

// ------------------------------------------------------------------ pathFor

test('pathFor no toca la dirección mientras no se sabe si hay sesión', () => {
  /* `undefined` es «todavía no sé». Devolver una route acá haría parpadear /login en cada
     carga de alguien que sí tiene sesión. */
  assert.equal(pathFor(undefined), null)
  assert.equal(pathFor(null), LOGIN)
  assert.equal(pathFor({ usuario: 'angel' }), COLLECTION)
})
