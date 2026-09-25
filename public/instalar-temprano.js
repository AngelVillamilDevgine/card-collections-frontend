/* Lo único que hace este archivo es no llegar tarde.
 *
 * Chrome avisa con `beforeinstallprompt` que la app se puede instalar, lo dispara UNA
 * sola vez por carga, y si nadie lo está escuchando en ese instante se pierde para
 * siempre. Ese evento es la única forma de tener un botón "Instalar" en Android.
 *
 * Medido contra producción, con un Android emulado:
 *
 *     el evento se dispara a los         182 ms
 *     el bundle recién se PIDE a los     691 ms
 *     el listener del componente         1510 ms
 *
 * O sea que no alcanzaba con moverlo al principio del módulo: para cuando el JavaScript
 * de la app empieza a existir, el evento ya pasó. El cartel de instalar de Android no
 * apareció nunca desde que se hizo.
 *
 * Por eso esto va acá, en un archivo suelto y clásico (sin `type="module"`, que se
 * difiere), cargado como lo primero del <head>. Guarda el evento en `window` y avisa por
 * uno propio, para que el componente pueda llegar cuando llegue.
 *
 * No hace nada más. Si algún día hace falta que haga otra cosa, casi seguro que va en
 * otro lado.
 */
(function () {
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
