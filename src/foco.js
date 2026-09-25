import { useEffect, useRef } from 'react'

// Atrapar el foco adentro de un diálogo, y devolverlo al cerrar.
//
// Sin esto pasaban dos cosas: con un diálogo abierto, los 1936 botones de atrás seguían
// alcanzables con Tab; y al cerrarlo el foco volvía al principio de la página, así que
// marcar la carta 1500 con el teclado significaba tabular 1500 veces de nuevo.
//
// No se usa el <dialog> nativo —que haría esto solo— porque cambiaría el telón y los
// estilos de los tres diálogos que ya existen. Son veinte líneas y no toca el aspecto.

const ENFOCABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/* `antes` tiene que venir capturado EN EL RENDER del diálogo, no acá adentro: React
   aplica el autoFocus del botón durante el commit, que corre antes que los efectos, así
   que si lo leyéramos acá ya sería un botón de este mismo diálogo. Al cerrar, ese botón
   ya no está en el DOM, la guarda de isConnected lo descartaba, y el foco no volvía a
   ningún lado. Era exactamente lo que este archivo decía arreglar. */
export function atraparFoco(caja, antes) {
  if (!caja) return () => {}

  // Se pregunta en cada Tab y no una vez al abrir: Exportar cambia de botones entre
  // sus tres pasos sin volver a montarse.
  const dentro = () => [...caja.querySelectorAll(ENFOCABLES)].filter((e) => !e.disabled)

  // Si nadie quedó enfocado adentro —el diálogo de los números no tiene autoFocus—
  // se enfoca el primero: si no, con el teclado no hay por dónde empezar.
  if (!caja.contains(document.activeElement)) dentro()[0]?.focus()

  const alTabular = (e) => {
    if (e.key !== 'Tab') return
    const lista = dentro()
    if (!lista.length) return
    const primero = lista[0]
    const ultimo = lista[lista.length - 1]
    const foco = document.activeElement
    if (!caja.contains(foco)) { e.preventDefault(); (e.shiftKey ? ultimo : primero).focus() }
    else if (e.shiftKey && foco === primero) { e.preventDefault(); ultimo.focus() }
    else if (!e.shiftKey && foco === ultimo) { e.preventDefault(); primero.focus() }
  }

  document.addEventListener('keydown', alTabular, true)

  return () => {
    document.removeEventListener('keydown', alTabular, true)
    // isConnected: el botón desde el que se abrió puede haberse ido del DOM mientras tanto.
    if (antes instanceof HTMLElement && antes.isConnected) antes.focus()
  }
}

/* Escape cierra. Va acá y no copiado en cada diálogo por dos razones: eran cuatro copias
   iguales, y las cuatro colgaban de `onCerrar`, que es una flecha inline recreada en cada
   render — o sea un removeEventListener más un addEventListener por render, para siempre,
   en una app que vuelve a dibujar con cada toque de carta.

   El ref guarda la versión fresca y el efecto se registra UNA vez. */
export function usarEscape(alCerrar) {
  const ultimo = useRef(alCerrar)
  ultimo.current = alCerrar
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') ultimo.current() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
}
