import { useEffect, useRef } from 'react'
import { whatsappTo, outageText } from './contact'

/* Cada cuánto vuelve a intentar sola. Treinta segundos: lo bastante seguido para que
   quien deja la app abierta entre apenas vuelve el servidor, y lo bastante espaciado para
   no sumarle pedidos a un servidor que ya está en problemas. */
export const AUTO_RETRY_SECONDS = 30

/* LA PANTALLA DE «NO HAY CONEXIÓN», que es lo primero que ve alguien cuando algo salió
 * mal, y por eso está escrita para bajar la tensión antes que para explicar.
 *
 * Lo que la persona necesita saber, en ese orden: que lo que ya marcó está guardado, que
 * no tiene que hacer nada, y cómo avisar si sigue. El detalle técnico (el código HTTP, el
 * mensaje del servidor) NO se muestra: viaja adentro del WhatsApp, que es donde sirve.
 *
 * Tres decisiones que salieron de la caída del 2026-10-24, cuando Angel la vio de verdad:
 *
 * - NO DESAPARECE AL REINTENTAR. Antes, «Reintentar» cambiaba a «Cargando…» medio segundo
 *   y volvía la misma pantalla idéntica: en el teléfono era indistinguible de un botón
 *   muerto. Ahora el botón dice «Probando…» y la hora del último intento se actualiza.
 * - REINTENTA SOLA, cada AUTO_RETRY_SECONDS y apenas vuelve internet. Es el mismo criterio
 *   que los guardados que fallan: reintentar solo es más fiel al «cero ceremonia» que
 *   pedirle a la persona que toque un botón cada tanto.
 * - SIN INTERNET NO OFRECE ESCRIBIR POR WHATSAPP: no podría mandarse, y la culpa no es del
 *   servidor. `navigator.onLine` miente sólo en un sentido (dice que sí en un wifi sin
 *   salida), así que cuando dice que no, es que no.
 *
 * Va en el bundle principal y no aparte, a propósito: es la pantalla de cuando la red
 * anda mal, y no puede depender de bajar un pedazo más. */
export default function ConnectionTrouble({ offline, retrying, lastAttemptAt, detail, username, onRetry, onLogout }) {
  const titleRef = useRef(null)
  /* El foco al título al entrar, para que un lector de pantalla anuncie el cambio de
     vista — lo mismo que hace el panel. Una sola vez: reintentar no remonta la pantalla. */
  useEffect(() => { titleRef.current?.focus() }, [])

  /* `hour12: false` a mano: el es-AR de Chrome da «11:21 a. m.», que acá no se usa y
     además pegado al punto final de la frase quedaba «a. m..». */
  const time = lastAttemptAt?.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  /* En dos líneas fijas y no en una que envuelve donde puede: en el teléfono dejaba
     «intento 11:23.» huérfano en el segundo renglón. Y no cambia mientras prueba: eso ya
     lo dice el botón, y repetirlo abajo era leer «Probando» dos veces. */
  const status = offline
    ? 'La app vuelve a intentar sola apenas vuelva la conexión.'
    : (
      <>
        La app vuelve a intentar sola cada {AUTO_RETRY_SECONDS} segundos.
        {time && <span className="trouble-last">Último intento: {time}</span>}
      </>
    )

  return (
    <div className="sheet">
      <section className="trouble" aria-labelledby="trouble-title">
        <img className="trouble-logo" src="./logo.png" alt="Dragon Ball Z" width="660" height="168" />
        <div className="trouble-card">
          <svg className="trouble-icon" width="30" height="30" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
               aria-hidden="true">
            {offline ? (
              <>
                <path d="M1 1l22 22" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <path d="M12 20h.01" />
              </>
            ) : (
              <>
                <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6" />
                <path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
                <path d="M1 1l22 22" />
              </>
            )}
          </svg>
          <h1 id="trouble-title" ref={titleRef} tabIndex={-1}>
            {offline ? 'Estás sin conexión a internet' : 'No hay conexión con el servidor'}
          </h1>
          <p className="trouble-calm">
            Lo que ya marcaste está guardado en tu cuenta y tu sesión sigue abierta. No hace
            falta hacer nada: apenas vuelva, la app entra sola.
          </p>
          <button className="primary trouble-retry" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
            {retrying && <span className="trouble-spinner" aria-hidden="true" />}
            {retrying ? 'Probando…' : 'Reintentar ahora'}
          </button>
          {/* Siempre en el DOM: una región viva tiene que estar puesta ANTES de que cambie
              lo que hay que leer, o el lector no la anuncia. */}
          <p className="trouble-status" aria-live="polite">{status}</p>
          {/* El camino de ayuda va separado y abajo: la acción de la pantalla es esperar o
              reintentar, y avisar es para cuando eso no alcanza. La pregunta queda afuera
              del botón para que el botón entre en un renglón aun a 320 px. */}
          {!offline && (
            <div className="trouble-help">
              <p>¿Sigue sin andar?</p>
              <a className="trouble-contact" href={whatsappTo(outageText(username, time, detail))}
                 target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                Avisame por WhatsApp
              </a>
            </div>
          )}
        </div>
        {/* Salir queda, pero callado y afuera de la caja: con el servidor caído, salir de
            la cuenta no arregla nada y encima no te deja volver a entrar hasta que vuelva. */}
        {onLogout && <button className="secondary trouble-logout" onClick={onLogout}>Salir de la cuenta</button>}
      </section>
    </div>
  )
}
