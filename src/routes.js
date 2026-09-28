/* EL RUTEO ENTERO. Son treinta líneas y no una biblioteca a propósito: la app es un solo
   bundle, así que una ruta acá no es un archivo que bajar — es nada más qué dice la
   dirección sobre lo que estás mirando.
 *
 * Hay tres, y cada una es un archivo HTML de verdad en `dist/`:
 *
 *   /             index.html      la landing. NO carga el bundle: es un documento suelto.
 *   /login        login.html      el formulario de entrada.
 *   /collection   collection.html las cartas.
 *
 * Son archivos planos y no carpetas, y eso está medido: Cloudflare Pages sirve
 * `collection.html` en `/collection`, redirige `/collection.html` ahí con un 308, y a una
 * carpeta le AGREGA la barra final con otro 308. Con archivos planos no hay ninguna
 * redirección, y además `./assets/…` resuelve desde `/collection` a `/assets/…`, que es
 * justo donde Vite los pone — o sea que el `base: './'` sigue andando sin tocar nada.
 *
 * LA URL SIGUE AL ESTADO, NO AL REVÉS, y es la decisión que hace que esto no pueda romper
 * nada. `App.jsx` decide qué dibujar exactamente igual que antes —por `cuenta`, no por la
 * dirección— y lo único que hace este módulo es dejar la barra de direcciones diciendo la
 * verdad. Al revés habría que reescribir el árbol de decisión de la app, que es donde
 * viven los tres estados de carga que costaron sus bugs.
 *
 * Y SIEMPRE `replaceState`, NUNCA `pushState`. Con push, entrar dejaba `/login` en el
 * historial: el Atrás siguiente volvía ahí, el efecto veía que hay sesión y te empujaba de
 * vuelta a `/collection` — el botón Atrás preso, que es el mismo bug que el `#panel`
 * existe para evitar. Reemplazando, después de entrar el Atrás te lleva a la landing, que
 * es de donde viniste. */

export const LOGIN = '/login'
export const COLLECTION = '/collection'
export const LANDING = '/'

/* La dirección que le corresponde a un estado. `undefined` es «todavía no sé si hay
   sesión» y ahí no se toca nada: mover la URL antes de saberlo haría parpadear `/login`
   en cada carga de alguien que sí tiene sesión. */
export function pathFor(cuenta) {
  if (cuenta === undefined) return null
  return cuenta ? COLLECTION : LOGIN
}

/* Deja la dirección en `path`.
 *
 * EL HASH SE CONSERVA Y LA QUERY NO, y las dos mitades tienen su motivo.
 *
 * El hash importa: `#panel` vive ahí, así que arrastrarlo es lo que impide que cambiar de
 * pantalla cierre el panel solo.
 *
 * La query se tira porque la única que existe es `?new=1`, que la landing usa para abrir
 * el formulario en modo «crear cuenta» y que `Entrar` consume una sola vez al montarse.
 * Conservándola —que es lo que hacía la primera versión— quedaba pegada para siempre: al
 * entrar te dejaba en `/collection?new=1`, y sobre todo al SALIR te devolvía a
 * `/login?new=1`, o sea al formulario de crear una cuenta nueva a alguien que acaba de
 * cerrar la suya. Lo agarró la prueba con clicks, no el compilador. */
export function syncPath(path) {
  if (!path) return
  const actual = location.pathname.replace(/\.html$/, '')
  if (actual === path) return
  history.replaceState(history.state, '', path + location.hash)
}
