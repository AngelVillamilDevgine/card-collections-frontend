/* Todo lo que tiene que correr ANTES de que exista el JavaScript de la app.
 *
 * Son dos cosas sin ninguna relación entre sí salvo esa, y aun así van en UN archivo, que
 * es la parte contraintuitiva. Medido en 3G con la CPU 6 veces más lenta: separadas en dos
 * archivos, el primer pintado se iba de 996 a 1304 ms. No son los bytes —entre las dos son
 * menos de 3 KB comprimidas— y tampoco son los pedidos que larga la segunda, que ya van en
 * prioridad baja: es el PEDIDO DEL ARCHIVO. Un `<script src>` en el <head> sale en
 * prioridad alta, la misma que la hoja de estilos, y la hoja de estilos es la que frena el
 * pintado. Dos scripts son dos competidores; uno es uno.
 *
 * Por eso también son `async`. Sin `async` un script clásico frena el parseo del HTML, y
 * el bundle es un módulo que sólo ejecuta cuando el parseo termina: cada script sin async
 * le agrega un viaje entero al camino crítico. Medido: costaba 251 ms.
 *
 * Y son clásicos y no `type="module"` porque los módulos se difieren hasta después del
 * parseo, que es exactamente lo que hay que evitar acá.
 *
 * OJO: esto vive en `public/`, así que Vite lo copia TAL CUAL. No se minifica y estos
 * comentarios viajan al teléfono de todos. Valen los ~1,5 KB que pesan comprimidos, pero
 * si esto creciera mucho hay que pensarlo de nuevo.
 */

/* ------------------------------------------------------------------ 1. instalar ------
 * Chrome avisa con `beforeinstallprompt` que la app se puede instalar, lo dispara UNA sola
 * vez por carga, y si nadie lo está escuchando en ese instante se pierde para siempre. Ese
 * evento es la única forma de tener un botón "Instalar" en Android.
 *
 * Medido contra producción con un Android emulado: el evento se dispara a los 182 ms, el
 * bundle recién se PIDE a los 691, y el listener del componente llegaba a los 1510. O sea
 * que no alcanzaba con moverlo al principio del módulo: para cuando el JavaScript de la app
 * empieza a existir, el evento ya pasó. El cartel de instalar de Android no apareció nunca
 * desde que se hizo la app hasta que esto existió.
 */
;(function () {
  window.__dbzInstalador = null
  window.addEventListener('beforeinstallprompt', function (e) {
    // Que no salga el cartel del navegador: lo ofrecemos nosotros, con una frase que
    // explica para qué sirve. Quien ya lo cerró cuatro veces puede instalarla igual
    // desde el menú de Chrome.
    e.preventDefault()
    window.__dbzInstalador = e
    window.dispatchEvent(new Event('dbz-instalable'))
  })
  // Si la instalan, el evento guardado ya no sirve para nada.
  window.addEventListener('appinstalled', function () {
    window.__dbzInstalador = null
  })
})()

/* ------------------------------------------------------- 2. adelantar los pedidos ------
 * La app se dibuja del lado del navegador, así que sin esto la secuencia era estrictamente
 * en fila india: bajar el bundle, ejecutarlo, recién ahí pedir /api/yo, esperar, pedir
 * /api/coleccion, esperar. Con 300 ms de ida y vuelta cada uno, son dos viajes que
 * arrancaban tardísimo. Acá salen apenas se parsea el <head>.
 *
 * LOS TRES VAN EN PRIORIDAD BAJA, y es lo que hace que esto no salga caro. En alta —que es
 * lo que hace `fetch()` por omisión— se reparten la tubería con el bundle y el pintado se
 * iba 372 ms. En baja el bundle se lleva la tubería entera y estos tres entran en los
 * huecos, que es lo que corresponde: todavía no hay nadie esperándolos.
 *
 * OJO, LA DIRECCIÓN DE LA API ESTÁ ACÁ REPETIDA. Vive también en src/almacenamiento.js y en
 * public/_headers (la CSP). Son tres lugares y no hay forma de compartir una constante,
 * porque este archivo no pasa por el empaquetador. Si cambia el dominio, son tres.
 */
/* El punto y coma de adelante NO es opcional. Sin él, `})()` seguido de `(function`
   en el renglón siguiente se lee como llamar al resultado de la IIFE anterior: no hay
   inserción automática de punto y coma ahí. Con las dos en archivos separados esto no
   podía pasar; al unirlas, sí. */
;(function () {
  var API = 'https://api.cromeros.com.ar'
  var TOKEN_KEY = 'dbz-cromeros-token'

  window.__dbzWarm = { catalog: null, me: null, collection: null }

  /* En desarrollo la API entra por el proxy de Vite sobre el mismo origen, así que esta
     dirección sería la equivocada. Y adelantar pedidos ahí no sirve de nada: es todo local
     y tarda milisegundos. */
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return

  var low = { priority: 'low' }

  // El catálogo no necesita sesión, así que sale siempre.
  window.__dbzWarm.catalog = fetch(new URL('data/expansiones.json', document.baseURI), low)
    .then(function (r) { return r.ok ? r.json() : null })
    .catch(function () { return null })

  var token = null
  try { token = localStorage.getItem(TOKEN_KEY) } catch (e) { /* modo privado */ }
  if (!token) return

  /* El mismo `?app=1` que manda la app cuando corre instalada. Se calcula acá igual que en
     donde-corre.js: si no, el pedido adelantado no contaría la visita como de la app y el
     panel diría que nadie la tiene instalada. */
  var standalone = false
  try {
    standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true
  } catch (e) { /* algún navegador viejo */ }
  var mark = standalone ? '?app=1' : ''
  var options = { headers: { Authorization: 'Bearer ' + token }, priority: 'low' }

  /* No se llama a .json() acá: la app necesita la Response entera para mirarle el estado
     —un 401 es «entrá de nuevo» y no un error cualquiera— y para eso usa el mismo camino de
     siempre. Acá sólo se adelanta el viaje.

     El .catch() va puesto ya, y no cuando la app la levante, porque una promesa rechazada
     sin nadie escuchando dispara `unhandledrejection` y ensucia la consola. */
  window.__dbzWarm.me = fetch(API + '/api/yo' + mark, options).catch(function () { return null })
  window.__dbzWarm.collection = fetch(API + '/api/coleccion', options).catch(function () { return null })
})()
