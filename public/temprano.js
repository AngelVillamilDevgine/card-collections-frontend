/* Lo único que hace este archivo es no llegar tarde.
 *
 * Chrome avisa con `beforeinstallprompt` que la app se puede instalar, lo dispara UNA sola
 * vez por carga, y si nadie lo está escuchando en ese instante se pierde para siempre. Ese
 * evento es la única forma de tener un botón "Instalar" en Android.
 *
 * Medido contra producción con un Android emulado: el evento se dispara a los 182 ms, el
 * bundle recién se PIDE a los 691, y el listener del componente llegaba a los 1510. O sea
 * que no alcanzaba con moverlo al principio del módulo: para cuando el JavaScript de la app
 * empieza a existir, el evento ya pasó. El cartel de instalar de Android no apareció nunca
 * desde que se hizo la app hasta que esto existió.
 *
 * Va `async`: sin eso un script clásico en el <head> frena el parseo del HTML, y el bundle
 * es un módulo que sólo ejecuta cuando el parseo termina, así que le agrega un viaje entero
 * al camino crítico. Son 251 ms medidos. Y es clásico y no `type="module"` porque los
 * módulos se difieren hasta después del parseo, que es justo lo que hay que evitar.
 *
 * ACÁ ADENTRO ESTUVO Y SE FUE UN ADELANTO DE LOS PEDIDOS DE LA API, y conviene saber por
 * qué antes de volver a intentarlo. La idea era largar /api/yo y /api/coleccion desde acá
 * para no esperarlos después de bajar el bundle. Medido en 3G con la CPU 6x, 13 corridas
 * por rama y los relojes adentro de la página:
 *
 *     el primer pintado se iba de 952 a 1276 ms, siempre (U = 13 de 169)
 *     el tiempo hasta las cartas: +161 ms en un experimento, -42 ms en el siguiente
 *
 * O sea: el costo es reproducible y la ganancia no. Y trazando recurso por recurso se ve
 * por qué: la hoja de estilos, que es la que frena el pintado, llega igual en las dos ramas
 * (964 contra 977 ms), y el pintado se va 300 ms DESPUÉS de que ya llegó. Eso no es red:
 * es el hilo principal. Lo caro es leer `localStorage`, que la app paga igual — sólo que
 * después de pintar. Adelantar los pedidos no acelera: mueve trabajo a antes del pintado.
 *
 * Si alguna vez se reintenta, la prueba es esa: que el tiempo hasta las CARTAS mejore en
 * dos experimentos seguidos, no en uno.
 *
 * No hace nada más. Si algún día hace falta que haga otra cosa, casi seguro que va en otro
 * lado — y si igual va acá, ojo: `})()` seguido de `(function` en el renglón siguiente no
 * recibe punto y coma automático y la segunda IIFE se lee como una llamada al resultado de
 * la primera.
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
