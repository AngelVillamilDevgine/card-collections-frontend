// "Instalala en tu teléfono". El ícono en la pantalla de inicio es lo que hace que
// alguien vuelva: deja de tener que acordarse de la dirección.
//
// Tres caminos distintos, porque los sistemas no dan lo mismo:
//
//   · Android / Chrome — el navegador avisa con `beforeinstallprompt` que se puede
//     instalar. Se guarda ese evento y el botón lo dispara: un toque y listo.
//   · iPhone — Apple no expone ninguna API. No hay botón posible: hay que explicarle
//     Compartir → "Añadir a pantalla de inicio", y nada más.
//   · Navegador adentro de otra app (Instagram, Facebook, WhatsApp) — no se puede
//     instalar de ninguna forma. Si no se detectara, el botón no haría nada y sería
//     peor que no mostrar nada. Ahí se le pide que la abra en el navegador.
//
// Es el único lugar del código donde se mira el user agent. No hay alternativa: no
// existe una API que diga "estás adentro de Instagram".
import { useEffect, useRef, useState } from 'react'
import { comoApp, esTelefono, esIOS, enOtraApp } from './donde-corre.js'

const CLAVE = 'dbz-cromeros-instalar'
const DESCANSO = 5 * 24 * 60 * 60 * 1000 // si lo cierra, se va cinco días
const VECES = 4                          // y después no molesta más


function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) ?? {} } catch { return {} }
}
function guardar(datos) {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)) } catch { /* modo privado */ }
}

/* Que ya la tenga instalada se sabe una sola vez: cuando entra como app. Desde ese
   momento no se le vuelve a ofrecer nunca, entre otra cosa porque no hay forma de
   preguntarlo desde el navegador. */
export function anotarSiEsApp() {
  if (comoApp()) guardar({ ...leer(), tiene: true })
}

const Cruz = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/* El ícono de Compartir de iOS, que es la única forma de explicar el paso. */
const Compartir = () => (
  <svg className="glifo" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V3" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
  </svg>
)

export default function Instalar() {
  const [visible, setVisible] = useState(false)
  const [instalador, setInstalador] = useState(null)
  const caja = useRef(null)

  useEffect(() => {
    if (comoApp()) return anotarSiEsApp()
    if (!esTelefono()) return

    const { tiene, visto = 0, veces = 0 } = leer()
    if (tiene || veces >= VECES || Date.now() - visto < DESCANSO) return

    /* El evento de instalación NO se escucha desde acá: para cuando este efecto corre
       —después de que quienSoy() resolvió y la app se dibujó— hace más de un segundo
       que pasó. Lo agarra `public/temprano.js`, que corre antes que todo, y
       acá se recoge lo que haya guardado.

       Medido contra producción con un Android emulado: el evento a los 182 ms, este
       efecto a los 1510. Chrome lo dispara una sola vez, así que el cartel de Android
       no aparecía nunca.

       De paso esto deja sin efecto al doble montaje de StrictMode: el listener de
       verdad se registra una vez, en el otro archivo, y el evento queda guardado —
       antes, si caía justo en el desmontaje y montaje del modo estricto, se perdía. */
    if (window.__dbzInstalador) setInstalador(window.__dbzInstalador)
    const alPoder = () => setInstalador(window.__dbzInstalador)
    window.addEventListener('dbz-instalable', alPoder)

    // Un rato después de entrar, no encima de la carga.
    const reloj = setTimeout(() => setVisible(true), 4000)
    return () => { clearTimeout(reloj); window.removeEventListener('dbz-instalable', alPoder) }
  }, [])

  /* La barra es fija abajo, así que tapaba el final del pie: a 320 px mide 134 px y se
     comía "Restaurar una copia", la dirección del sitio y el botón del alias — con la
     página ya en el fondo, o sea sin forma de alcanzarlos. Se le agrega al body ese
     mismo alto de relleno, medido y no adivinado, para que el pie quede accesible. */
  useEffect(() => {
    if (!visible || !caja.current) return
    const alto = caja.current.offsetHeight + 20
    document.body.style.setProperty('--alto-instalar', alto + 'px')
    document.body.classList.add('con-instalar')
    return () => {
      document.body.classList.remove('con-instalar')
      document.body.style.removeProperty('--alto-instalar')
    }
  }, [visible, instalador])

  function cerrar() {
    const { veces = 0 } = leer()
    guardar({ ...leer(), visto: Date.now(), veces: veces + 1 })
    setVisible(false)
  }

  async function instalar() {
    if (!instalador) return
    instalador.prompt()
    const { outcome } = await instalador.userChoice.catch(() => ({ outcome: 'dismissed' }))
    // Si aceptó, no hay nada más que ofrecerle nunca.
    guardar(outcome === 'accepted' ? { ...leer(), tiene: true } : { ...leer(), visto: Date.now(), veces: (leer().veces ?? 0) + 1 })
    setVisible(false)
  }

  const enOtra = enOtraApp()
  const ios = esIOS()

  /* En Android la barra sólo sirve si el navegador avisó que se puede instalar: sin
     ese evento no hay botón, y una barra que dice "instalala" sin decir cómo es peor
     que nada. En iPhone y en el navegador de otra app no hay evento nunca, pero sí
     hay algo para explicar. */
  if (!visible || (!ios && !enOtra && !instalador)) return null

  return (
    <aside className="instalar" role="note" ref={caja}>
      <img src="./icono-192.png" alt="" width="38" height="38" />
      <div className="instalar-texto">
        {enOtra ? (
          <>
            <b>Tenela como app</b>
            <span>Abrila en {ios ? 'Safari' : 'Chrome'} y vas a poder instalarla en tu teléfono.</span>
          </>
        ) : ios ? (
          <>
            <b>Tenela como app</b>
            <span>Tocá <Compartir /> abajo y después «Añadir a pantalla de inicio».</span>
          </>
        ) : (
          <>
            <b>Instalala en tu teléfono</b>
            <span>Se abre como una app, sin tener que buscar la página.</span>
          </>
        )}
      </div>
      {!enOtra && !ios && instalador && (
        <button className="instalar-si" onClick={instalar}>Instalar</button>
      )}
      <button className="instalar-no" onClick={cerrar} aria-label="Ahora no"><Cruz /></button>
    </aside>
  )
}
