/* Arrancar los pedidos ANTES de que exista el JavaScript de la app.
 *
 * Medido contra producción con la caché vacía, en un teléfono con 3G y el procesador seis
 * veces más lento:
 *
 *     primer pintado            2220 ms
 *     cartas en pantalla        3324 ms
 *
 * Ese segundo de diferencia no es trabajo: es esperar. La app es de las que se dibujan del
 * lado del navegador, así que la secuencia era estrictamente en fila india —bajar el
 * bundle, ejecutarlo, recién ahí pedir /api/yo, esperar, pedir /api/coleccion, esperar—
 * y con 300 ms de ida y vuelta cada uno, eso son dos viajes que arrancan tardísimo.
 *
 * Este archivo los larga apenas se parsea el <head>, que es más o menos un segundo antes.
 * Cuando la app arranca, o ya están listos o están a mitad de camino, y en vez de pedirlos
 * de nuevo levanta lo que hay. El catálogo va también, que no necesita sesión.
 *
 * Es clásico y no `type="module"` a propósito: los módulos se difieren hasta después del
 * parseo del HTML, que es justo lo que hay que evitar. Ver instalar-temprano.js, que está
 * separado porque hace otra cosa y por la misma razón tiene que correr temprano.
 *
 * OJO, LA DIRECCIÓN DE LA API ESTÁ ACÁ REPETIDA. Vive también en src/almacenamiento.js y
 * en public/_headers (la CSP). Son tres lugares y no hay forma de compartir una constante,
 * porque este archivo no pasa por el empaquetador. Si alguna vez cambia el dominio, son
 * tres.
 */
(function () {
  var API = 'https://api.cromeros.com.ar'
  var TOKEN_KEY = 'dbz-cromeros-token'

  window.__dbzWarm = { catalog: null, me: null, collection: null }

  /* En desarrollo la API entra por el proxy de Vite sobre el mismo origen, así que esta
     dirección sería la equivocada. Adelantar pedidos ahí tampoco sirve de nada: es todo
     local y tarda milisegundos. */
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  if (local) return

  // El catálogo no necesita sesión, así que sale siempre.
  window.__dbzWarm.catalog = fetch(new URL('data/expansiones.json', document.baseURI))
    .then(function (r) { return r.ok ? r.json() : null })
    .catch(function () { return null })

  var token = null
  try { token = localStorage.getItem(TOKEN_KEY) } catch (e) { /* modo privado */ }
  if (!token) return

  /* El mismo `?app=1` que manda la app cuando corre instalada. Se calcula acá igual que en
     donde-corre.js: si no, el pedido adelantado no contaría la visita como de la app y el
     panel de números diría que nadie la tiene instalada. */
  var standalone = false
  try {
    standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true
  } catch (e) { /* algún navegador viejo */ }
  var mark = standalone ? '?app=1' : ''
  var options = { headers: { Authorization: 'Bearer ' + token } }

  /* No se llama a .json() acá: la app necesita la Response entera para mirarle el estado
     —un 401 es «entrá de nuevo» y no un error cualquiera— y para eso usa el mismo camino
     de siempre. Acá sólo se adelanta el viaje.

     El .catch() va puesto ya, y no cuando la app la levante, porque una promesa rechazada
     sin nadie escuchando dispara `unhandledrejection` y ensucia la consola. */
  window.__dbzWarm.me = fetch(API + '/api/yo' + mark, options).catch(function () { return null })
  window.__dbzWarm.collection = fetch(API + '/api/coleccion', options).catch(function () { return null })
})()
