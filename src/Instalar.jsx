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
import { useEffect, useState } from 'react'

const CLAVE = 'dbz-cromeros-instalar'
const DESCANSO = 5 * 24 * 60 * 60 * 1000 // si lo cierra, se va cinco días
const VECES = 4                          // y después no molesta más

const ua = () => navigator.userAgent ?? ''

export const comoApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

const esTelefono = () =>
  navigator.userAgentData?.mobile ??
  (window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth <= 900)

const esIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) ||
  // El iPad hace años se declara Mac; lo delata que la pantalla sea táctil.
  (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1)

const enOtraApp = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/i.test(ua())

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

  useEffect(() => {
    if (comoApp()) return anotarSiEsApp()
    if (!esTelefono()) return

    const { tiene, visto = 0, veces = 0 } = leer()
    if (tiene || veces >= VECES || Date.now() - visto < DESCANSO) return

    // Chrome avisa que se puede instalar; se le pide que no muestre su propio cartel
    // para ofrecerlo acá, con una frase que diga para qué sirve.
    const alPoder = (e) => { e.preventDefault(); setInstalador(e) }
    window.addEventListener('beforeinstallprompt', alPoder)

    // Un rato después de entrar, no encima de la carga.
    const reloj = setTimeout(() => setVisible(true), 4000)
    return () => { clearTimeout(reloj); window.removeEventListener('beforeinstallprompt', alPoder) }
  }, [])

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
    <aside className="instalar" role="note">
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
