/* LO PRIMERO QUE CORRE EN LA LANDING, Y BLOQUEANTE A PROPÓSITO.
 *
 * `/` es la landing, o sea una página para alguien que todavía no tiene cuenta. Pero a `/`
 * también llega gente que SÍ la tiene, y sobre todo llega la app instalada: hay
 * instalaciones cuyo `start_url` quedó apuntando acá y en iPhone eso NO SE PUEDE CAMBIAR
 * NUNCA — Safari congela el manifest en el momento de «Añadir a pantalla de inicio» y no lo
 * vuelve a leer. Así que la regla es que `/` no puede ser un callejón sin salida para nadie
 * que ya entró alguna vez, y esa regla tiene que valer para siempre.
 *
 * Por eso es un `<script src>` sin `async` ni `defer`, lo primero del `<head>`: frena el
 * parseo, decide, y redirige ANTES de que se pinte un pixel. Con `async` el que tiene
 * sesión vería un flash de página de venta antes de sus cartas cada vez que abre la app.
 *
 * Es al revés que `temprano.js`, que va `async` justamente para no frenar nada — y no es
 * una contradicción: ahí lo que importa es no demorar el primer pintado, y acá lo que
 * importa es que el primer pintado no sea el equivocado.
 *
 * Y va en un archivo y no en línea porque la CSP es `script-src 'self'` sin
 * `'unsafe-inline'`. Se podría poner el hash del script en la cabecera, pero entonces
 * cualquiera que toque este archivo sin acordarse de actualizar `_headers` rompe la
 * redirección EN SILENCIO: el que abre la app instalada cae en la landing y nadie se
 * entera. Un pedido chiquito es más barato que esa clase de falla. */
;(function () {
  'use strict'

  var TOKEN = 'dbz-cromeros-token'
  /* La marca la lee `Reinstall.jsx` para ofrecer el arreglo. Va en `sessionStorage` y no
     en la dirección: es de esta apertura de la app y no algo que convenga que alguien pegue
     en un chat. */
  var FROM_ROOT = 'dbz-cromeros-from-root'

  var runningAsApp = false
  try {
    runningAsApp =
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true
  } catch (e) { /* un navegador viejo sin matchMedia no es una app instalada */ }

  var hasToken = false
  try { hasToken = !!localStorage.getItem(TOKEN) } catch (e) { /* modo privado */ }

  /* Llegar acá corriendo como app quiere decir una sola cosa: esa instalación todavía
     apunta a `/`. No rompe nada —abajo se redirige igual— pero se puede mejorar, así que
     se deja anotado y la app ofrece reinstalar. Si el `start_url` ya se actualizó, este
     archivo no corre nunca y el cartel no aparece jamás. */
  if (runningAsApp) { try { sessionStorage.setItem(FROM_ROOT, '1') } catch (e) {} }

  var rest = location.search + location.hash

  /* Con sesión, a las cartas. Sin sesión pero corriendo como app, al formulario: a alguien
     que ya se tomó el trabajo de instalarla no hay nada que venderle. */
  if (hasToken) location.replace('/collection' + rest)
  else if (runningAsApp) location.replace('/login' + rest)
})()
