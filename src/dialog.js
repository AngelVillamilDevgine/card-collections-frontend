import { useEffect, useRef } from 'react'

/* ATRÁS TIENE QUE CERRAR EL DIÁLOGO, NO LA APP.
 *
 * En un teléfono, el botón de volver es lo primero que aprieta cualquiera para cerrar
 * algo que ocupa la pantalla. Con los diálogos no había nada escuchando, así que ese
 * gesto se iba del sitio: *«cuando estoy en un pop up y toco el botón de volver, me
 * cierra la app o se va atrás en el navegador»*. Perdías la página, el scroll de las 1936
 * cartas y, si estabas eligiendo, lo que hubieras elegido.
 *
 * Es el mismo argumento por el que el panel vive en el hash, y acá la solución es la
 * misma idea sin tocar la dirección: al abrirse, el diálogo empuja una entrada al
 * historial; Atrás se la come y lo cierra. Si en cambio lo cerrás con el botón o con
 * Escape, la entrada se saca sola — si no, quedarían entradas invisibles y el Atrás
 * siguiente no haría nada en pantalla, que es justo lo que se quiere evitar.
 *
 * NO cambia el hash a propósito: `#panel` es una vista y se puede compartir; un diálogo a
 * medio llenar no. Y así un diálogo abierto sobre el panel no se lleva puesto su hash.
 *
 * `ownsHistoryEntry` distingue las dos formas de cerrar: si la entrada ya se la comió el navegador
 * no hay que pedir otro `back()`, o se saltaría una entrada de más. */
export function useCloseOnBack(isOpen, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const ownsHistoryEntry = useRef(false)

  useEffect(() => {
    if (!isOpen) return undefined
    history.pushState({ dbzDialog: true }, '')
    ownsHistoryEntry.current = true
    const onPopState = () => {
      ownsHistoryEntry.current = false
      onCloseRef.current?.()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (ownsHistoryEntry.current) {
        ownsHistoryEntry.current = false
        history.back()
      }
    }
  }, [isOpen])
}

// Atrapar el foco adentro de un diálogo, y devolverlo al cerrar.
//
// Sin esto pasaban dos cosas: con un diálogo abierto, los 1936 botones de atrás seguían
// alcanzables con Tab; y al cerrarlo el foco volvía al principio de la página, así que
// marcar la carta 1500 con el teclado significaba tabular 1500 veces de nuevo.
//
// No se usa el <dialog> nativo —que haría esto solo— porque cambiaría el telón y los
// estilos de los tres diálogos que ya existen. Son veinte líneas y no toca el aspecto.

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/* `returnFocusTo` tiene que venir capturado EN EL RENDER del diálogo, no acá adentro: React
   aplica el autoFocus del botón durante el commit, que corre antes que los efectos, así
   que si lo leyéramos acá ya sería un botón de este mismo diálogo. Al cerrar, ese botón
   ya no está en el DOM, la guarda de isConnected lo descartaba, y el foco no volvía a
   ningún lado. Era exactamente lo que este archivo decía arreglar. */
export function trapFocus(container, returnFocusTo) {
  if (!container) return () => {}

  // Se pregunta en cada Tab y no una vez al abrir: ExportDialog cambia de botones entre
  // sus tres pasos sin volver a montarse.
  const getFocusables = () => [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((e) => !e.disabled)

  // Si nadie quedó enfocado adentro —el diálogo de los números no tiene autoFocus—
  // se enfoca el primero: si no, con el teclado no hay por dónde empezar.
  if (!container.contains(document.activeElement)) getFocusables()[0]?.focus()

  const onTabKey = (e) => {
    if (e.key !== 'Tab') return
    const focusables = getFocusables()
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (!container.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  document.addEventListener('keydown', onTabKey, true)

  return () => {
    document.removeEventListener('keydown', onTabKey, true)
    // isConnected: el botón desde el que se abrió puede haberse ido del DOM mientras tanto.
    if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected) returnFocusTo.focus()
  }
}

/* Escape cierra. Va acá y no copiado en cada diálogo por dos razones: eran cuatro copias
   iguales, y las cuatro colgaban de `onClose`, que es una flecha inline recreada en cada
   render — o sea un removeEventListener más un addEventListener por render, para siempre,
   en una app que vuelve a dibujar con cada toque de carta.

   El ref guarda la versión fresca y el efecto se registra UNA vez. */
export function useCloseOnEscape(onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
}
