// «Tu acceso directo abre la portada». La red de seguridad de que la app se haya mudado
// de `/` a `/collection`.
//
// QUÉ PASÓ, EXACTAMENTE: hay instalaciones cuyo `start_url` quedó apuntando a `/`, que
// ahora es la landing. No se rompe nada —`public/resume.js` las manda a sus cartas antes
// de pintar un pixel— pero se paga un documento de más en cada apertura, y en un teléfono
// con data eso se nota.
//
// Y NO SE ARREGLA IGUAL EN LOS DOS SISTEMAS, que es lo que hace falta saber para escribir
// el cartel:
//
//   · Android — Chrome compara el manifest servido contra el horneado en el WebAPK en un
//     chequeo del orden del día y, si difiere, pide un APK nuevo. O sea que SE ARREGLA
//     SOLO, sin que la persona haga nada; el cartel es por si ese chequeo se demora.
//   · iPhone — Safari congela el manifest en el momento de «Añadir a pantalla de inicio» y
//     NO LO VUELVE A LEER NUNCA. Ahí no hay arreglo automático posible: el único camino es
//     borrar el ícono y volver a agregarlo.
//
// La marca la deja `resume.js` en `sessionStorage`, y eso significa que el cartel
// desaparece solo el día que la instalación se actualiza: si `start_url` ya apunta a
// `/collection`, ese archivo no corre nunca y acá no llega nada. No hay que acordarse de
// sacar nada — es lo mismo que hace el aviso de los guardados fallidos, donde el aviso es
// la ausencia.
import { useEffect, useRef, useState } from 'react'
import { comoApp, esIOS } from './donde-corre.js'

const MARK = 'dbz-cromeros-from-root'
const KEY = 'dbz-cromeros-reinstall'
/* Se pide una vez por semana y a lo sumo tres times. En Android lo más probable es que
   para la segunda ya se haya arreglado solo y el cartel no vuelva a aparecer. */
const SNOOZE = 7 * 24 * 60 * 60 * 1000
const MAX_TIMES = 3

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {} } catch { return {} }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* modo privado */ }
}

const Cross = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

const Share = () => (
  <svg className="glyph" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V3" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
  </svg>
)

export default function Reinstall() {
  const [visible, setVisible] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    /* Las dos condiciones, y las dos hacen falta: la marca sola no alcanza porque
       `sessionStorage` es del origen y podría quedar de una pestaña normal. */
    if (!comoApp()) return
    let cameFromRoot = false
    try { cameFromRoot = sessionStorage.getItem(MARK) === '1' } catch { /* modo privado */ }
    if (!cameFromRoot) return

    const { seen = 0, times = 0 } = read()
    if (times >= MAX_TIMES || Date.now() - seen < SNOOZE) return

    /* Después de la carga, no encima: esto no es urgente y la app ya anda. */
    const timer = setTimeout(() => setVisible(true), 6000)
    return () => clearTimeout(timer)
  }, [])

  /* La barra es fija abajo y taparía el final del pie. Mismo mecanismo que `Instalar`:
     se mide a sí misma y le pasa el height al body como relleno. */
  useEffect(() => {
    if (!visible || !box.current) return
    const height = box.current.offsetHeight + 20
    document.body.style.setProperty('--install-height', height + 'px')
    document.body.classList.add('with-install-bar')
    return () => {
      document.body.classList.remove('with-install-bar')
      document.body.style.removeProperty('--install-height')
    }
  }, [visible])

  function dismiss() {
    const { times = 0 } = read()
    save({ seen: Date.now(), times: times + 1 })
    setVisible(false)
  }

  if (!visible) return null
  const ios = esIOS()

  return (
    <aside className="install" role="note" ref={box}>
      <img src="./icono-192.png" alt="" width="38" height="38" />
      <div className="install-text">
        <b>Tu acceso directo da una vuelta de más</b>
        {ios ? (
          <span>
            Borralo de la pantalla de inicio y volvé a agregarlo con <Share /> «Añadir a
            pantalla de inicio»: va a abrir directo en tus cartas.
          </span>
        ) : (
          <span>
            Se arregla solo en un día. Si querés que sea ya, borrá el acceso directo y
            volvé a instalarla desde el menú de Chrome.
          </span>
        )}
      </div>
      <button className="install-no" onClick={dismiss} aria-label="Entendido"><Cross /></button>
    </aside>
  )
}
