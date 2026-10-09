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
import { readFileSync, existsSync } from 'node:fs'
import { LOGIN, COLLECTION, pathFor } from '../src/routes.js'
import { WHATSAPP } from '../src/contact.js'

const rootUrl = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, rootUrl), 'utf8')

const landing = read('index.html')
const login = read('login.html')
const collection = read('collection.html')
const resume = read('public/resume.js')
const app = read('src/App.jsx')
const apiSrc = read('src/api.js')
const reinstall = read('src/Reinstall.jsx')
const manifest = JSON.parse(read('public/manifest.webmanifest'))

const root = (html) => html.match(/<div id="root">.*?<\/div><\/div>/s)?.[0]

// ------------------------------------------------------- el cartel de «Cargando…»

test('los dos cascarones de la app dicen exactamente lo mismo en #root', () => {
  assert.ok(root(login), 'login.html no tiene el div #root en una línea')
  assert.equal(root(login), root(collection))
})

test('y eso es lo mismo que dibuja App.jsx mientras no sabe si hay sesión', () => {
  /* El estado `account === undefined`. Si esto cambia en App.jsx y no en los HTML, al montar
     React reemplaza un cartel por otro distinto y se ve un salto. */
  assert.match(app, /account === undefined\) return <div className="sheet"><p className="loading">Cargando…<\/p><\/div>/)
  for (const html of [login, collection])
    assert.equal(root(html), '<div id="root"><div class="sheet"><p class="loading">Cargando…</p></div></div>')
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
  const firstScript = landing.match(/<script[^>]*>/)
  assert.equal(firstScript[0], tag[0])
})

test('los tres HTML llevan la tarjeta de vista previa (og)', () => {
  /* Quien comparte la app copia la URL desde la barra: adentro de la app dice /collection
     o /login, no la landing. Sin og la tarjeta de WhatsApp sale sin imagen ni texto. El
     noindex de los cascarones gobierna indexación, no tarjetas: conviven. */
  for (const [name, html] of [['index.html', landing], ['login.html', login], ['collection.html', collection]]) {
    assert.ok(html.includes('property="og:title"'), name + ' sin og:title')
    assert.ok(html.includes('content="https://cromeros.com.ar/icono-512.png"'), name + ' sin la og:image absoluta')
    assert.ok(html.includes('name="twitter:card"'), name + ' sin twitter:card')
  }
})

test('la landing carga early.js, que es lo que le apaga a Chrome su cartel de instalar', () => {
  /* La landing linkea el manifest —obligatorio: hay instalaciones viejas con `start_url=/`—
     y con el manifest a la vista Chrome en Android puede ofrecer instalar por su cuenta,
     encima de la página de venta. Lo único que lo apaga es el `preventDefault` de
     `early.js` sobre `beforeinstallprompt`. Acá nadie usa el evento guardado (no hay
     bundle): está sólo para suprimir el cartel. Y va `async` porque no puede frenar el
     primer pintado de la única página que ve un desconocido. */
  assert.ok(landing.includes('manifest.webmanifest'), 'si el manifest se fue, este test ya no aplica: leé el comentario')
  const tag = landing.match(/<script[^>]*early\.js[^>]*>/)
  assert.ok(tag, 'la landing no carga early.js: Chrome puede ofrecer instalar sobre la página de venta')
  assert.ok(/\basync\b/.test(tag[0]), `early.js va async para no frenar el pintado: ${tag[0]}`)
})

test('cada asset que la landing referencia existe en public/', () => {
  /* En Pages un asset que falta NI SIQUIERA da 404: el fallback de SPA contesta el
     index.html con 200 y text/html, así que un webp renombrado es una imagen rota sin
     una sola señal en la pestaña de red. Se juntan todos los src/srcset/href de archivos
     propios (webp, png, svg, woff2) y se mira que cada uno esté en public/. */
  const urls = [...landing.matchAll(/(?:src|srcset|href)="\.?(\/[^"]+\.(?:webp|png|svg|woff2))"/g)].map((m) => m[1])
  assert.ok(urls.length >= 18, `se esperaban al menos 18 assets referenciados y hay ${urls.length}`)
  for (const u of new Set(urls)) {
    assert.ok(existsSync(new URL(`public${u}`, rootUrl)), `la landing referencia ${u} y no existe en public/`)
  }
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
  /* Cuatro botones, cada uno con su marcador de pasarela: los dos CTA con `new=1` y su
     `f`, los dos «Ya tengo cuenta» sólo con la `f`. */
  for (const href of [
    `${LOGIN}?new=1&f=hero`, `${LOGIN}?f=hero-acct`,
    `${LOGIN}?new=1&f=closing`, `${LOGIN}?f=closing-acct`,
  ]) assert.ok(landing.includes(`href="${href}"`), `falta el enlace a ${href}`)
})

test('la pasarela: los marcadores f= de la landing son los que lee el formulario', () => {
  /* El tercer contrato de este archivo entre la landing y Login.jsx. Si divergen, el
     contador pierde EN SILENCIO: una `f` que Login no lista cuenta como «directo» y
     nadie se entera de que el botón dejó de medirse. */
  const markers = [...landing.matchAll(/[?&]f=([a-z-]+)"/g)].map((m) => m[1])
  assert.equal(new Set(markers).size, 4, `se esperaban 4 marcadores distintos y hay: ${markers.join(', ')}`)
  const allowedMarkers = read('src/Login.jsx').match(/const FROM = new Set\(\[([^\]]+)\]\)/)?.[1] ?? ''
  for (const f of markers) assert.ok(allowedMarkers.includes(`'${f}'`), `la landing manda f=${f} y Login no lo lista`)
  /* Y el beacon del visitante vive en RESUME.JS, no en early: al que tiene sesión,
     resume lo redirige antes de que un script async llegue a correr — en early, el
     beacon del que ya entró no salía nunca. Se mira que mande el `v1|` con el vid y que
     dispare ANTES del replace, porque después ya no hay página. */
  const resumeSrc = read('public/resume.js')
  assert.ok(resumeSrc.includes("'/api/pulse'"), 'resume.js perdió el endpoint del pulso')
  assert.ok(resumeSrc.includes("'v1|'"), 'resume.js perdió el formato v1 del visitante')
  assert.ok(resumeSrc.includes('dbz-cromeros-vid'), 'resume.js perdió la clave del vid')
  assert.ok(
    resumeSrc.indexOf('sendBeacon') < resumeSrc.indexOf('location.replace'),
    'el beacon tiene que dispararse ANTES del replace'
  )
  assert.ok(!read('public/early.js').includes('sendBeacon'), 'el beacon volvió a early.js, donde pierde la carrera')
})

test('el parámetro que pone la landing es el que lee Login.jsx', () => {
  /* Otro contrato entre un HTML y un módulo, o sea otro que no se puede verificar
     importando. Y falló de verdad: al pasar el nombre a inglés se cambió el `?crear=1` del
     enlace y NO el `get('crear')` del componente, así que el botón «Anotá tus faltantes»
     seguía abriendo el formulario en modo «Entrar». No lo agarró ningún test —el de arriba
     sólo mira el enlace— sino la prueba con clicks. */
  const landingParam = landing.match(new RegExp(`href="${LOGIN}\\?([a-z]+)=1&`))?.[1]
  const formParam = read('src/Login.jsx').match(/location\.search\)\.get\('([^']+)'\)/)?.[1]
  assert.ok(landingParam, 'la landing no lleva ningún parámetro')
  assert.equal(formParam, landingParam)
})

// ------------------------------------------- los contratos entre archivos sueltos

test('resume.js redirige a las MISMAS rutas que declara routes.js', () => {
  for (const route of [LOGIN, COLLECTION])
    assert.ok(resume.includes(`'${route}'`), `resume.js no menciona ${route}`)
})

test('resume.js guarda el visitante con la MISMA clave que api.js lee para el pulso', () => {
  /* Si se separan, el pulso de la página de entrada sale sin visitante y los clicks
     vuelven a contarse por carga, en silencio. */
  const key = apiSrc.match(/VISITOR_STORAGE_KEY = '([^']+)'/)?.[1]
  assert.ok(key, 'no se encontró VISITOR_STORAGE_KEY en api.js')
  assert.ok(resume.includes(`'${key}'`), `resume.js no usa ${key}`)
})

test('resume.js usa la MISMA key de token que api.js', () => {
  const key = apiSrc.match(/TOKEN_STORAGE_KEY = '([^']+)'/)?.[1]
  assert.ok(key, 'no se encontró TOKEN_STORAGE_KEY en api.js')
  assert.ok(resume.includes(`'${key}'`), `resume.js no usa ${key}`)
})

test('la marca que deja resume.js es la que lee Reinstall.jsx', () => {
  const written = resume.match(/FROM_ROOT = '([^']+)'/)?.[1]
  const gotten = reinstall.match(/MARK = '([^']+)'/)?.[1]
  assert.ok(written, 'resume.js no define la marca')
  assert.equal(gotten, written)
})

test('resume.js y platform.js detectan la app instalada de la MISMA forma', () => {
  /* `resume.js` es un script clásico de `public/`: no puede importar `isStandalone`, así que la
     detección está duplicada. Si divergen, la app instalada se reconoce de un lado y del
     otro no: `resume.js` dejaría de redirigir desde la raíz, o `isStandalone()` dejaría de mandar
     el `?app=1` y el cuarto escalón del embudo se desalinea. Ninguna de las dos avisa. */
  const platformSrc = read('src/platform.js')
  for (const signal of ['display-mode: standalone', 'navigator.standalone']) {
    assert.ok(platformSrc.includes(signal), `platform.js dejó de mirar ${signal}`)
    assert.ok(resume.includes(signal), `resume.js dejó de mirar ${signal}`)
  }
})

test('los archivos que nombra el manifest existen', () => {
  /* El manifest lleva comentarios en claves `//` que citan archivos del repo, y una quedó
     apuntando a `public/reanudar.js` después de renombrarlo: una referencia muerta que
     ningún build mira, porque es un JSON. */
  for (const [key, value] of Object.entries(manifest)) {
    if (typeof value !== 'string') continue
    for (const filePath of value.match(/\b(?:public|src|test)\/[\w.-]+\.\w+/g) ?? [])
      assert.ok(existsSync(new URL(filePath, rootUrl)), `${key} nombra ${filePath}, que no existe`)
  }
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
     `ExportDialog.jsx` tiene JSX adentro, así que no se puede importar desde acá; se lee. */
  const exportSrc = read('src/ExportDialog.jsx')
  const footer = exportSrc.match(/const FOOTER_URL = '([^']+)'/)?.[1]
  assert.ok(footer, 'no se encontró el footer del texto exportado')
  assert.ok(footer.startsWith('https://'), `el footer tiene que llevar el esquema: ${footer}`)
})

// ------------------------------------------------------------------ pathFor

test('pathFor no toca la dirección mientras no se sabe si hay sesión', () => {
  /* `undefined` es «todavía no sé». Devolver una route acá haría parpadear /login en cada
     carga de alguien que sí tiene sesión. */
  assert.equal(pathFor(undefined), null)
  assert.equal(pathFor(null), LOGIN)
  assert.equal(pathFor({ username: 'angel' }), COLLECTION)
})

/* El WhatsApp del pie de la landing es un literal en el HTML, porque la landing no carga el
   bundle. Si el número cambia en contact.js y no acá, la landing manda a la gente a otro
   lado y nada lo avisa. */
test('el WhatsApp del pie de la landing es el mismo que el de la app', () => {
  const links = [...landing.matchAll(/https:\/\/wa\.me\/(\d+)/g)].map((m) => m[1])
  assert.ok(links.length > 0, 'la landing no tiene ningún enlace a WhatsApp')
  for (const n of links) assert.equal(n, WHATSAPP)
})
