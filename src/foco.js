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
 * `nuestra` distingue las dos formas de cerrar: si la entrada ya se la comió el navegador
 * no hay que pedir otro `back()`, o se saltaría una entrada de más. */
export function usarAtras(abierto, cerrar) {
  const alCerrar = useRef(cerrar)
  alCerrar.current = cerrar
  const nuestra = useRef(false)

  useEffect(() => {
    if (!abierto) return undefined
    history.pushState({ dbzDialogo: true }, '')
    nuestra.current = true
    const volvio = () => {
      nuestra.current = false
      alCerrar.current?.()
    }
    window.addEventListener('popstate', volvio)
    return () => {
      window.removeEventListener('popstate', volvio)
      if (nuestra.current) {
        nuestra.current = false
        history.back()
      }
    }
  }, [abierto])
}

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
