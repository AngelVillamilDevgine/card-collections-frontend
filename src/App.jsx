import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONDITIONS, conditionLabel, conditionClass } from './conditions'
import { trapFocus, useCloseOnEscape, useCloseOnBack, useLockScroll } from './dialog'
import { textColorOn, tintOf, inkOn } from './color'
import Login from './Login'
import ExportDialog from './ExportDialog'
import Celebration from './Celebration'
/* El panel del administrador se baja aparte y recién cuando se abre.

   Lo ven 1 de 40 cuentas, y estaba en el chunk principal: las otras 39 se bajaban el
   componente y sus 26 reglas de CSS en cada visita para no abrirlos nunca. Hoy son 1,1 KB
   comprimidos de los 59 del bundle — poco, y no es por eso que se hace. Es porque el
   panel va a crecer, y con el corte puesto puede crecer sin que nadie tenga que discutir
   cuántos kilobytes le cuesta al que sólo marca cartas. */
const Dashboard = lazy(() => import('./Dashboard'))

/* LAS VISTAS DEL PANEL VIVEN EN EL HASH, cada una con el suyo, por el mismo motivo por el
   que el panel entero vive ahí: Atrás tiene que volver a la anterior y no sacarte de la
   app. De paso sobreviven a un F5 y el link se puede pasar.
 *
 * Es un MAPA y no un `startsWith('#panel')`: así un `#panel/loquesea` no abre media
 * pantalla con la vista en blanco — cae en `null`, que es «no hay panel», igual que
 * `#cartas`, el hash del enlace de saltar.
 *
 * No son rutas de verdad (`/panel/users`) y eso está medido: Cloudflare Pages sirve el
 * `index.html` —o sea LA LANDING— con 200 en cualquier ruta que no exista como archivo,
 * y la landing con sesión te redirige a `/collection`. O sea que un F5 en `/panel/users`
 * te sacaba de la pantalla. Tenerlas de verdad pide un HTML anidado nuevo, arreglar el
 * `base: './'` de Vite —desde dos niveles `./assets/…` resuelve a `/panel/assets/…` y la
 * app no arranca— y sumar los contratos a `pages.test.js`. */
const PANEL_HASH = { numbers: '#panel', users: '#panel/users' }
const VIEW_BY_HASH = Object.fromEntries(Object.entries(PANEL_HASH).map(([view, hash]) => [hash, view]))
const panelViewFromHash = () =>
  (typeof location === 'undefined' ? null : VIEW_BY_HASH[location.hash] ?? null)

import InstallPrompt from './InstallPrompt'
import Reinstall from './Reinstall'
import { pathFor, syncPath } from './routes'
import { whatIsStale, staleText } from './health'
import { ErrorBoundary } from './ErrorBoundary'
import { whatsappTo, suggestionText } from './contact'
import { COLLECTIONS, DEFAULT_COLLECTION, readCollection, rememberCollection, loadCatalogs, slotKey, slotsOf, variantsFor, missingVariantsOf, drawableVariants, pointsToASlot, cardLabel, cardDetail, albumPercent, albumTally, closestToComplete, slotOf, slotName, orphanName, completionBy, countsInTally, expansionForNumber, plainNumberRun } from './collections'
import ConnectionTrouble, { AUTO_RETRY_SECONDS } from './ConnectionTrouble'
import {
  ApiError,
  downloadJson, readBackupFile, fetchAccount, logout,
  fetchCollection, saveCard, replaceCollection,
  changePassword, token, TOKEN_STORAGE_KEY,
} from './api'

/* Los tres listados que un coleccionista realmente necesita: qué buscar,
   qué puede cambiar y qué le conviene reemplazar. */
/* `shortLabel` es el rótulo para la barra de abajo del teléfono, donde cada lugar mide unos
   82 px y «Para reemplazar» no entra. Los dos textos se dibujan siempre y el CSS muestra
   el que corresponde: así el layout lo decide una media query y no un `if` sobre el
   ancho, que parpadearía al cargar y habría que volver a calcular al rotar. */
/* Son CINCO declarados y se muestran CUATRO: «Para reemplazar» filtra por condición, y en
   una colección sin condición (Leyenda) es un cero permanente — Angel, 2026-10-15: «los
   filtros de Estado no me sirven, porque se coleccionan con variantes, no con estado».
   Su lugar lo ocupa «Faltan variantes», que es la MISMA cuenta que la lista homónima del
   exportar (`missingVariantsOf`). Es un reemplazo uno a uno y no un filtro de más ni de
   menos a propósito: la barra de abajo del teléfono está calculada para cinco lugares de
   ancho igual, y recortar a tres los desbalancea.

   `matches` decide por CASILLERO (cantidad y condición); `matchesHole` decide por HUECO,
   porque «te falta una variante» no es una propiedad de ningún casillero que exista — el
   casillero que falta justamente no está. Un filtro declara una de las dos. */
export const FILTERS = [
  { id: 'all',        label: 'Todas',           shortLabel: 'Colección',  matches: () => true, css: 'all' },
  { id: 'missing',    label: 'Me faltan',       shortLabel: 'Faltan',     matches: (quantity) => quantity === 0, css: 'missing' },
  { id: 'duplicates', label: 'Repetidas',       shortLabel: 'Repetidas',  matches: (quantity) => quantity > 1, css: 'dupes' },
  { id: 'replace',    label: 'Para reemplazar', shortLabel: 'Reemplazar', matches: (quantity, condition) => quantity > 0 && condition === 'reemplazar', css: 'replace' },
  { id: 'variants',   label: 'Faltan variantes', shortLabel: 'Variantes',
    matchesHole: (exp, n, quantities, drawable) => missingVariantsOf(exp, n, quantities, drawable).length > 0, css: 'variants' },
]

/* Los íconos de esa barra. Trazo de 2, sin relleno y con `currentColor`, igual que los
   tres que ya había (exportar, plegar, completa): así heredan solos el color del filtro
   elegido y no hace falta ninguna regla aparte. Son líneas, no emojis — un emoji se ve
   distinto en cada teléfono y encima es justo lo que hacía que la primera versión de la
   app gritara «hecho con IA».

   En un teléfono el ícono no es decoración: con cinco lugares de 82 px, es lo que se
   reconoce de un vistazo antes de leer. */
const FILTER_ICONS = {
  // Cuatro cartas: la colección entera.
  all: <><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.5" /></>,
  // Un hueco: el lugar vacío del álbum.
  missing: <rect x="4.5" y="3.5" width="15" height="17" rx="2" strokeDasharray="3.2 3" />,
  // Una carta encima de otra.
  duplicates: <><rect x="8.5" y="3.5" width="12" height="14" rx="2" /><path d="M15.5 20.5H5.5a2 2 0 0 1-2-2v-11" /></>,
  // Dos flechas que se cruzan: cambiarla por otra.
  replace: <><path d="M3.5 8.5h13l-3.5-3.5" /><path d="M20.5 15.5h-13l3.5 3.5" /></>,
  // Una carta con el brillo cruzado: la misma carta en otro acabado.
  variants: <><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><path d="M8 15.5 15.5 8" /><path d="M11.5 18 17.5 12" /></>,
}

/* Las cuentas de color (textColorOn, tintOf, inkOn) viven en color.js desde que la
   planilla de variantes tiñe sus columnas: ExportDialog no puede importarlas de acá
   sin un ciclo. */

/* ---------------------------------- carta --------------------------------- */

const HOLD_MS = 420 // ms a partir de los cuales deja de ser un toque

/* Píxeles de movimiento a partir de los cuales el gesto deja de ser un mantenido y pasa
   a ser el arranque de un scroll. Diez es poco a propósito: el dedo tiembla, pero si se
   desplaza ya no está "apretando ahí". */
const MOVE_TOLERANCE_PX = 10

/* memo: sin esto, cada toque volvía a renderizar las 1936 cartas — 10 ms en la compu y
   125 ms en un teléfono de gama baja, cuando lo que el DOM necesita de verdad son tres
   mutaciones sobre un solo elemento.

   Para que el memo sirva, `onTap` y `onHold` tienen que ser los mismos objetos en
   cada render. Por eso la carta les pasa su clave al llamarlos, en vez de recibir dos
   flechas que ya la tengan adentro: una flecha nueva por carta es una prop nueva por
   carta, y el memo no ahorraría nada. */
const Card = memo(function Card({ cardKey, number, label, detail, variant, condition, quantity, unsaved, onTap, onHold }) {
  const holdTimer = useRef(null)
  const wasLongPress = useRef(false)  // ya pasaron los 420 ms: el click que venga no cuenta
  const decrementArmed = useRef(false)  // ...y además todavía se puede cobrar al soltar
  const pressOrigin = useRef(null)
  /* EL AVISO VISUAL SE ADELANTA AL COBRO, y es todo lo que este estado hace.
     Lo reportó Angel: «uno se queda apretando una casilla esperando que se descuente un
     número de repetida y nunca pasa, pasa recién cuando uno suelta». Tenía razón y el gesto
     igual no se puede mover — cobrar al soltar es lo que impide que un scroll reste una
     carta, y eso está medido—. Lo que faltaba era decirlo: a los 420 ms la carta muestra
     CÓMO VA A QUEDAR, y si el gesto se cancela se deshace sin haber tocado nada. */
  const [subtracting, setSubtracting] = useState(false)

  function handlePointerDown(e) {
    wasLongPress.current = false
    decrementArmed.current = false
    pressOrigin.current = { x: e.clientX, y: e.clientY }
    holdTimer.current = setTimeout(() => {
      wasLongPress.current = true
      decrementArmed.current = true
      /* Sólo si hay algo que restar. Con cantidad 0 el mantenido no hace nada —la guarda
         está en `decrement`— así que anunciar una resta que no va a pasar es peor que no
         anunciar nada. */
      if (quantity > 0) setSubtracting(true)
    }, HOLD_MS)
  }

  /* Si el dedo se corre, no era un mantenido: era el arranque de un scroll. */
  function handlePointerMove(e) {
    if (!pressOrigin.current) return
    const distance = Math.abs(e.clientX - pressOrigin.current.x) + Math.abs(e.clientY - pressOrigin.current.y)
    if (distance > MOVE_TOLERANCE_PX) cancelHold()
  }

  /* El mantenido se cobra al SOLTAR, no al cumplirse los 420 ms.

     Medido con toques reales: apoyar el dedo sobre la grilla mientras mirás el álbum y
     después arrastrar para seguir bajando restaba una carta —de 7 a 6— y se guardaba.
     El navegador avisa que se quedó con el gesto (`pointercancel`) recién DESPUÉS del
     disparo, así que cancelar por movimiento llega tarde: a los 420 ms ya estaba hecho.

     Cobrando al soltar, un scroll no resta nunca, porque termina en `pointercancel` y
     no en `pointerup`. El gesto sigue siendo el mismo para quien lo hace a propósito. */
  function handlePointerUp() {
    clearTimeout(holdTimer.current)
    pressOrigin.current = null
    setSubtracting(false)
    if (!decrementArmed.current) return
    decrementArmed.current = false
    onHold(cardKey)
  }

  /* El gesto se fue a otro lado: ni resta ni cuenta como toque. Y el aviso se deshace, que
     es justamente lo que lo hace honesto: si al final no se cobra, no se vio una mentira
     sino lo que HABRÍA pasado. */
  function cancelHold() {
    clearTimeout(holdTimer.current)
    pressOrigin.current = null
    decrementArmed.current = false
    setSubtracting(false)
  }

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  /* Con el teclado, Enter y Espacio suman. Para restar no había ningún camino — el
     único era mantener apretado con el dedo o el mouse —, y como cambiar el estado
     exige bajar hasta cero, quien se equivocaba de estado quedaba encerrado. */
  function handleKeyDown(e) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return
    // Con Ctrl, Alt o Meta son atajos del sistema —borrar palabra, volver atrás—, y no
    // tienen que sacar una carta.
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    const grid = e.currentTarget.parentElement
    onHold(cardKey) // si está en cero, `decrement` no hace nada

    /* Si la carta sale del filtro puesto —restar la última repetida con «Repetidas»
       elegido— el botón se desmonta y el foco cae en `body`, así que el Backspace
       siguiente no hace nada y parece que la app se colgó. Se mueve el foco a la carta
       que ocupó su lugar, o a la barra de filtros si la grilla entera desapareció.

       setTimeout y no rAF: tiene que correr DESPUÉS de que React aplique el cambio. */
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const neighbor = grid?.isConnected && grid.querySelector('.card')
      if (neighbor) neighbor.focus()
      else document.querySelector('.filter.active')?.focus()
    }, 0)
  }

  /* Lo que se DIBUJA mientras el mantenido está armado: cómo va a quedar la carta si soltás
     ahora. Bajar de 1 a 0 se lleva también la condición, igual que hace `decrement`, así que la
     carta entera cambia de color — que es exactamente la respuesta que se estaba esperando.

     El `aria-label` NO usa estos valores, y es a propósito: la etiqueta dice lo que la carta
     ES, no lo que va a ser. Esto es un aviso visual de un gesto en curso, y un `aria-label`
     que se mueve y vuelve durante un mantenido sólo confunde a quien lo lee al enfocar. */
  const shownQuantity = subtracting ? quantity - 1 : quantity
  const shownCondition = subtracting && quantity === 1 ? null : condition

  const statusText = quantity
    ? `${conditionLabel(condition, quantity)} · tenés ${quantity}`
    : 'Me falta'
  /* El nombre de la variante va en la etiqueta hablada y el rótulo corto en la esquina.
     Con lector de pantalla, «Carta 551» dos veces seguidas no distingue nada.

     Y el número va con el prefijo de su expansión (`label`), no pelado: mirando la
     pantalla la banda de arriba dice de qué expansión es, pero hablado no hay banda, y
     en Leyenda hay 19 huecos donde el mismo número es dos cartas distintas. En la CARA de
     la carta sigue yendo pelado: ahí la banda está a la vista y «Leyenda 1» no entra. */
  /* Y si el catálogo sabe cómo se llama esa carta, se dice: en las «Cartas únicas» el
     número es una etiqueta nuestra —esas nueve no llevan número impreso— y lo que la
     identifica de verdad es el personaje. */
  /* La tirada va también en la etiqueta hablada, no sólo pintada: es la mitad del dato
     —lo que separa a Shenron de las otras ocho— y sin esto quien usa lector de pantalla
     oye el personaje y no se entera de que una es de 500. */
  /* Un detalle puede venir SIN nombre (los manuales, que van «Manual 1» a secas —
     Angel sacó los títulos de las tapas: «esos títulos no me gusta»): ahí el rótulo es
     todo lo que hay que decir. */
  const displayName = detail?.nombre
    ? `${label}, ${detail.nombre}${detail.copias > 0 ? `, ${detail.copias} copias` : ''}`
    : label
  const accessibleName = variant ? `Carta ${displayName}, ${variant.nombre}` : `Carta ${displayName}`

  /* Sin `title`: decía lo mismo que el aria-label, y varios lectores de pantalla leen la
     etiqueta y después la descripción, o sea «Carta 5. Me falta. Me falta» — 1936 veces.
     Lo que el title aportaba a la vista ya está pintado en la carta: el color es el
     estado y el número chico de la esquina es la cantidad. */
  return (
    <button
      className={`card ${conditionClass(shownCondition, shownQuantity)}${unsaved ? ' unsaved' : ''}${variant ? ' variant' : ''}${subtracting ? ' subtracting' : ''}${detail?.imagen ? ' with-photo' : ''}`}
      aria-label={`${accessibleName}. ${statusText}${unsaved ? '. Sin guardar' : ''}`}
      /* La forma estándar de anunciar un atajo de teclado. Restar con Backspace no
         estaba dicho en ningún lado: ni en la ayuda, ni en la etiqueta. Para quien usa
         el teclado, el camino era invisible. */
      aria-keyshortcuts="Backspace" 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
      onClick={() => { if (!wasLongPress.current) onTap(cardKey, number) }}
    >
      {/* Con detalle la carta muestra tres cosas y no una: el rótulo chico arriba —que
          acá es «Leyenda 3» y no un número pelado—, el personaje, que es lo que de verdad
          la identifica, y la tirada, que es lo que separa a Shenron (500) de las otras
          ocho (1500). Sin detalle no cambia nada: el número solo, como siempre.

          Y si el catálogo sabe la FOTO (los manuales), va a la izquierda del texto, con
          el marco de las cajas. Decorativa (alt vacío): el rótulo y el nombre ya la
          dicen. El envoltorio de los textos existe sólo en esta rama: el estado sigue
          siendo el fondo de la ficha entera, como en todas. */}
      {/* Sin nombre en el detalle, el rótulo chico no va: sería «MANUAL 1» arriba de
          «Manual 1». Queda el rótulo solo, en el tamaño del nombre. */}
      {detail?.imagen ? (
        <>
          <img className="detail-photo" src={detail.imagen} alt="" loading="lazy" />
          <span className="detail-texts">
            {detail.nombre && <span className="detail-label">{label}</span>}
            <span className="detail-name">{detail.nombre ?? label}</span>
            {detail.copias > 0 && <span className="backup-detail">{detail.copias.toLocaleString('es-AR')} copias</span>}
          </span>
        </>
      ) : detail ? (
        <>
          {detail.nombre && <span className="detail-label">{label}</span>}
          <span className="detail-name">{detail.nombre ?? label}</span>
          {detail.copias > 0 && <span className="backup-detail">{detail.copias.toLocaleString('es-AR')} copias</span>}
        </>
      ) : number}
      {variant && <b className="variant-mark">{variant.corto ?? variant.id.toUpperCase()}</b>}
      {shownQuantity > 1 && <b className="dupes">{shownQuantity}</b>}
    </button>
  )
})

/* -------------------------------- diálogo --------------------------------- */

function AskCondition({ label, onPick, onClose }) {
  const box = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const prevFocus = useRef(document.activeElement)

  useCloseOnEscape(onClose)

  /* Una sola vez, al abrir. Si dependiera de `onClose` —que es una flecha nueva en
     cada render— volvería a capturar el "foco de antes" en cada vuelta, y al cerrar lo
     devolvería a un botón de este mismo diálogo, que para entonces ya no existe. */
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Carta ${label}`} ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {label}</h3>
        <p>¿En qué estado está?</p>
        {CONDITIONS.map((e) => (
          <button key={e.id} className={`option ${e.css}`} onClick={() => onPick(e.id)} autoFocus={e.id === 'bien'}>
            {e.label}
          </button>
        ))}
        <button className="cancel" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  )
}

/* Restaurar reemplaza TODA la colección, aunque el archivo esté bien. Es el único camino
   de la app que borra en masa, y era el que menos avisaba: se hacía solo, sin preguntar y
   sin decir qué se perdía — un archivo equivocado te dejaba en cero con el pie diciendo
   "Guardando en tu cuenta, a cada cambio".

   Ahora muestra los dos números antes de tocar nada. Los números importan más que el
   cartel: "vas a perder 861 cartas" se entiende; "¿estás seguro?" no dice nada. */
/* «¿Cuál tenés?» — la variante EN VEZ de la condición, que es lo que pidió Angel para
   Leyenda. Es el mismo diálogo que en Cromeros pregunta el estado, con otra pregunta
   adentro, y NO un cuarto gesto: la regla de la app es que se pregunta cuando hay más de
   una respuesta posible.

   Las opciones salen del catálogo, así que agregar una variante es editar un json y no
   redeployar nada.

   OFRECE EXACTAMENTE LO QUE DICE LA PLANILLA, SIN NINGUNA FILA AGREGADA. Hubo una primera
   que decía «sin clasificar» y después «común», y Angel la mandó sacar: *«la 824
   pregunta si es común, en la planilla no te pasé común (...) no inventes nada adicional»*.
   La planilla de una carta lista los acabados en que esa carta salió; que no haya columna
   «común» es un dato, no un olvido, y la app no está para completarlo.

   Dónde queda entonces la común: **una carta que no está en ninguna planilla no abre este
   diálogo**. Se marca de un toque y cae en el casillero base, que es justo lo que Angel
   venía haciendo — «te voy dejando en la base las que en realidad son comunes»—. Las 25
   filas que tenía cargadas el 2026-09-26 se parten exactamente así: las 10 de variante son
   todas de cartas que están en una planilla, y las 15 de base son todas de cartas que no.

   Cada opción muestra cuántas tenés de esa: sin eso, con tres fondos parecidos, no hay
   forma de acordarse de cuál ya cargaste. */
function AskVariant({ label, variants, counts, onPick, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)

  useCloseOnEscape(onClose)
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  const renderOption = (id, optionLabel, autoFocus) => (
    <button key={id ?? 'base'} className="option simple" onClick={() => onPick(id)} autoFocus={autoFocus}>
      {optionLabel}
      {(counts[id ?? ''] ?? 0) > 0 && <b>{counts[id ?? '']}</b>}
    </button>
  )

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Carta ${label}`}
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {label}</h3>
        <p>¿Cuál tenés?</p>
        {variants.map((v, i) => renderOption(v.id, v.nombre, i === 0))}
        <p className="exits">
          <button className="cancel" onClick={onClose}>Cancelar</button>
        </p>
      </div>
    </div>
  )
}

/* «AGREGAR POR NÚMERO», lo pidió Angel: escribís el número de la carta que tenés en la
   mano y pasa EXACTAMENTE lo que pasaría tocándola — si no la tenés, pregunta el estado;
   si ya la tenés, suma una repetida. No es un marcado masivo (eso se sacó y no vuelve):
   es UN número por vez, que desemboca en el mismo gesto de siempre. Sirve porque con 1936
   casilleros encontrar la carta 1204 a ojo es scrollear media pantalla de números.

   La diferencia con el toque es que acá la carta no está a la vista, así que lo que el
   click muestra en el casillero lo tiene que decir el diálogo: la repetida sumada se
   anuncia en la nota —que es viva, el mismo patrón de «Cambiar mi clave»— y el campo se
   limpia para el siguiente número, que es el flujo de cargar un mazo recién comprado.
   Cuando lo que sigue es una pregunta (el estado, o la variante), este diálogo se cierra
   y la pregunta se abre en el mismo render, heredando la entrada del historial — igual
   que el festejo hereda la del diálogo de condición.

   `onSubmit` devuelve null si la pregunta quedó abierta (acá ya no hay nada que decir),
   o `{ error }` / `{ added }` para decirlo sin cerrar. */
function AddByNumber({ run, example, onSubmit, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(null)
  const inputRef = useRef(null)

  useCloseOnEscape(onClose)
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  function handleSubmit(ev) {
    ev.preventDefault()
    const result = onSubmit(value.trim())
    if (!result) return
    if (result.error) { setError(result.error); setAdded(null); return }
    setError(null)
    setAdded(result.added)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Agregar por número"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Agregar por número</h3>
        {/* La nota SIEMPRE está y lo que cambia es el texto: una región viva se anuncia
            cuando cambia, no cuando nace escrita. Arranca diciendo el rango —que sale del
            catálogo, no escrito a mano— y pasa a decir la repetida que se acaba de sumar. */}
        <p className="dialog-note" role="status">
          {added ?? `Del ${run.min} al ${run.max}${example ? `; las especiales, con su letra (${example})` : ''}.`}
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Número de la carta
            {/* inputMode y no type="number": el teclado numérico del teléfono, sin las
                flechitas de spinner, y deja escribir la E de las especiales. */}
            <input ref={inputRef} type="text" inputMode="numeric" autoComplete="off"
                   value={value} onChange={(e) => { setValue(e.target.value); setError(null) }}
                   autoFocus />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="primary">Agregar</button>
          <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
        </form>
      </div>
    </div>
  )
}

/* Sacar las huérfanas es el SEGUNDO camino que borra en masa, y hasta hoy era un
   botón-enlace que borraba N cartas de un click: sin preguntar, sin decir cuáles y sin
   bajar una copia — las tres cosas que restaurar sí hace, en la misma pantalla.

   Y el disparador no es un ataque ni un archivo raro: es editar el catálogo, que es el
   flujo que el proyecto documenta como normal («podés editar este archivo para corregir
   rangos o agregar sets sin recompilar»). Un `"hasta": 129` tipeado como `19` convierte
   129 cartas en huérfanas, y un click las borra para siempre — cuando el arreglo de
   verdad, deshacer el tipeo, las habría devuelto intactas.

   Muestra los NÚMEROS y no sólo la cantidad: es lo que deja ver de un vistazo que son
   «las 129 de la Expansión 1» y no cartas sueltas, o sea que el problema está en el
   catálogo y no en la colección. */
function OrphansDialog({ keys, catalogs, onConfirm, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)

  useCloseOnEscape(onClose)
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  /* El `corto` de la expansión y no el número pelado: con dos colecciones, «551» no dice
     de cuál álbum es, y el diálogo existe justamente para que se vea de un vistazo que el
     problema es el catálogo y no la colección.

     Va por `orphanName` y no partiendo la clave por los dos puntos: con un sufijo de
     variante, `ley-6-dor:99999` no encontraba rótulo —la tabla sólo tenía ids de
     expansión— y se imprimía la clave cruda. Acá eso pesa más que en el pie, porque **este
     es el diálogo que borra**: la lista es con lo que se decide. */
  const labels = keys.map((c) => orphanName(c, catalogs))
  const MAX_LISTED = 24
  const listedText = labels.slice(0, MAX_LISTED).join(', ')

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Sacar las que no están en el catálogo"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Sacar {keys.length} carta{keys.length === 1 ? '' : 's'}</h3>
        <p>
          Estas cartas están marcadas en tu colección pero no están en el catálogo:
          <br />
          <b>{listedText}</b>{labels.length > MAX_LISTED && <> y {labels.length - MAX_LISTED} más</>}.
        </p>
        <p className="eye">
          Si son muchas y seguidas, capaz que lo que está mal es el catálogo y no tu
          colección. Antes se baja sola una copia de lo que tenés ahora, por las dudas.
        </p>
        <button className="option replace" onClick={onConfirm} autoFocus>
          Sacarlas igual
        </button>
        <p className="exits">
          <button className="cancel" onClick={onClose}>Cancelar</button>
        </p>
      </div>
    </div>
  )
}

function RestoreDialog({ currentQuantities, backupQuantities, onConfirm, onClose }) {
  /* Se cuentan CARTAS y no claves, igual que `validateReplacement` del servidor: una clave
     con cantidad 0 no es una carta, y una copia armada a mano puede traerlas. */
  const ownedKeysOf = (m) => Object.keys(m).filter((c) => Number(m[c]) > 0)
  const ownedKeys = ownedKeysOf(currentQuantities)
  const incomingKeys = new Set(ownedKeysOf(backupQuantities))
  const ownedCount = ownedKeys.length
  const incomingCount = incomingKeys.size
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)

  useCloseOnEscape(onClose)

  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  /* CUÁNTAS DE LAS TUYAS NO ESTÁN EN LA COPIA, que no es lo mismo que restar totales.
     Con `ownedCount - incomingCount`, un respaldo viejo de 600 cartas que sólo comparte 480 con tus 546
     daba -54: la frase no se dibujaba y el diálogo se leía como que ganabas, cuando en
     realidad perdías 66. Justo el caso típico de restaurar desde otro aparato. */
  const lostCount = ownedKeys.filter((c) => !incomingKeys.has(c)).length

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Restaurar una copia"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Restaurar una copia</h3>
        <p>
          Ahora tenés <b>{ownedCount}</b> carta{ownedCount === 1 ? '' : 's'} marcada{ownedCount === 1 ? '' : 's'}.
          Esta copia trae <b>{incomingCount}</b>.
        </p>
        <p className="eye">
          Se reemplaza <b>toda</b> tu colección por la del archivo.
          {lostCount > 0 && <> Vas a perder <b>{lostCount}</b>.</>}{' '}
          Antes se baja sola una copia de lo que tenés ahora, por las dudas.
        </p>
        <button className="option replace" onClick={onConfirm} autoFocus>
          Reemplazar por la copia
        </button>
        <button className="cancel" onClick={onClose}>Cancelar, dejar todo como está</button>
      </div>
    </div>
  )
}

/* ----------------------------------- app ---------------------------------- */

/* Cambiar la clave, que además echa a todas las otras sesiones de la cuenta.

   Las dos cosas van juntas y no son dos botones: cambiar la clave dejando vivas las
   sesiones abiertas no echa a nadie —el token no sabe nada de la clave— y cerrar
   sesiones sin cambiarla deja entrar de nuevo al que la sabe. Por separado, cada mitad
   da una falsa sensación de haber resuelto algo. */
/* «MI PERFIL» vive en Profile.jsx y baja recién al tocar el ícono: su campo de WhatsApp
   trae la librería de teléfonos, que no tiene por qué bajar todo el que entra a marcar
   cartas. Mientras llega se ve la misma caja diciendo «Cargando…», que es lo primero que
   muestra el diálogo de verdad, así que al montar no salta nada.

   Si el pedazo no baja —una pestaña abierta de antes de un deploy pide un archivo que ya
   no existe— queda la misma caja con el motivo, y no la pantalla en blanco. */
const ProfileDialog = lazy(() => import('./Profile').catch(() => ({ default: ProfileUnavailable })))

/* Escape la cierra, como al diálogo de verdad. El foco NO se mueve mientras carga: el
   diálogo guarda al montarse de dónde vino el foco para devolverlo al cerrar, y si lo
   tuviera esta caja, que para entonces ya no existe, se perdería. La de «no se pudo» sí
   lo atrapa, porque no viene nada después. */
function ProfileShell({ onClose, trap = false, children }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  useCloseOnEscape(onClose)
  useEffect(() => (trap ? trapFocus(box.current, prevFocus.current) : undefined), [trap])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Mi perfil"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Mi perfil</h3>
        {children}
      </div>
    </div>
  )
}

function ProfileUnavailable({ onClose }) {
  return (
    <ProfileShell onClose={onClose} trap>
      {/* role="alert" y no "status": la caja aparece con el texto ya adentro, y un status
          que nace lleno muchas veces no se lee. */}
      <p className="dialog-note" role="alert">No se pudo abrir tu perfil. Recargá la página y probá de nuevo.</p>
      <button className="primary" onClick={() => location.reload()}>Recargar</button>
      <button className="secondary" onClick={onClose}>Cerrar</button>
    </ProfileShell>
  )
}

const closedSessionsText = (n) =>
  n === 0 ? 'No había ninguna otra sesión abierta.'
    : n === 1 ? 'Se cerró la sesión que había en otro aparato.'
      : `Se cerraron las ${n} sesiones que había en otros aparatos.`

/* `forced`: entró con una clave provisoria (`bin/reset-password.js` del backend) y no
   puede seguir hasta elegir la suya. Es el mismo diálogo —la ruta es la misma y ya cierra
   las otras sesiones— pero sin salida: ni «Mejor no», ni Escape, ni el telón, y tampoco
   Atrás (no entra en `isDialogOpen`). La marca vive en el SERVIDOR y viaja en /api/yo, así
   que recargar o cerrar la app lo vuelve a traer acá. */
function ChangePasswordDialog({ onClose, onSessionExpired, forced = false }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState(null)
  const [closedSessions, setClosedSessions] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  /* Obligatorio: antes de elegir la clave no hay forma de cerrar. Después sí — el
     «Listo» es lo que le avisa a la app que ya está. */
  const closable = !forced || closedSessions !== null

  useCloseOnEscape(() => { if (closable) onClose() })
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  async function handleSubmit(ev) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { echadas: closedCount } = await changePassword(currentPassword, newPassword)
      setClosedSessions(closedCount)
    } catch (e) {
      if (e?.sessionExpired) return onSessionExpired()
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay" onClick={() => { if (closable) onClose() }}>
      <div className="dialog" role="dialog" aria-modal="true"
           aria-label={forced ? 'Elegí una clave nueva' : 'Cambiar mi clave'}
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>{forced ? 'Elegí una clave nueva' : 'Cambiar mi clave'}</h3>
        {/* UNA SOLA nota, siempre en el DOM, y lo que cambia es el texto de adentro. Es el
            mismo patrón que el pie, y por el mismo motivo: un `role="status"` que NACE con
            su texto no se anuncia. Una región viva se anuncia cuando CAMBIA, y para eso
            tiene que estar puesta de antes; un nodo que aparece ya escrito muchas veces no
            se lee. Acá eso importaba: el aviso de que la clave cambió y cuántas sesiones se
            cerraron —el resultado de una acción de seguridad— aparecía junto con el botón
            «Listo», que es lo único que se llevaba el foco y lo único que se leía. */}
        <p className="dialog-note" role="status">
          {closedSessions === null
            ? forced
              ? 'Entraste con una clave provisoria. Elegí la tuya para seguir; tus cartas están todas.'
              : 'Al cambiarla se cierran las sesiones abiertas en otros aparatos. En éste seguís adentro.'
            : `Listo, ya es la nueva. ${closedSessionsText(closedSessions)}`}
        </p>
        {closedSessions === null ? (
          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              {forced ? 'La clave provisoria que te pasaron' : 'Tu clave de ahora'}
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                     autoComplete="current-password" autoFocus required />
            </label>
            <label>
              La nueva
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                     autoComplete="new-password" required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Un segundo…' : forced ? 'Guardar mi clave' : 'Cambiarla'}
            </button>
            {!forced && <button type="button" className="secondary" onClick={onClose}>Mejor no</button>}
          </form>
        ) : (
          <button className="primary" onClick={onClose} autoFocus>Listo</button>
        )}
      </div>
    </div>
  )
}

const EMPTY_COLLECTION = { estados: {}, cantidades: {} }

/* Lo técnico de un error de carga, para el WhatsApp de la pantalla de «no hay conexión»:
   el mensaje y, si hubo respuesta, el código HTTP — que es lo que dice dónde se cortó
   (521: Cloudflare no llega al servidor; 500: la app). */
const loadErrorDetail = (e) =>
  (e?.status ? `${e.message} (HTTP ${e.status})` : e?.message) || 'Sin respuesta del servidor.'

/* Para el pie: de dónde es la app y cómo apoyar al que la hizo. */
const SITE_URL = 'www.cromeros.com.ar'
const ALIAS = 'angel.villamil'

/* Cuántas veces se reintenta un guardado que falló, y cuánto se espera entre intentos
   (crece: 900 ms, 1800 ms). Dos alcanzan para tapar un bache de red sin que el usuario
   note nada; más que eso ya es que no hay internet, y ahí sí conviene avisar. */
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 900

/* Lo máximo que Salir espera a que salga lo pendiente. Un pedido colgado no puede
   dejarte atrapado adentro de la app. */
const LOGOUT_MAX_WAIT_MS = 4000
/* Cuánto espera una restauración a que aterricen los guardados que ya salieron. Más que
   el de Salir —ahí la persona se quiere ir y cada segundo pesa— porque restaurar ya son
   dos viajes y la espera se nota menos; y alcanza para un PUT normal más su primer
   reintento. Ver `confirmRestore`. */
const RESTORE_MAX_WAIT_MS = 8000

/* Cuánto tiene que haber pasado para que, al volver a la pestaña, se vuelva a pedir la
   colección. Cambiar de app un rato en el teléfono es lo normal; lo que hay que atrapar
   es la pestaña abierta desde ayer. */
const REFRESH_AFTER_MS = 60 * 1000

/* Lo que tarda en mandarse una carta después del último toque. Existe por el orden:
   si tocás tres veces rápido y salen tres pedidos, pueden llegar desordenados y
   quedar guardado el 2 después del 3. Esperando, sale uno solo con el número final. */
const SAVE_DELAY_MS = 250

/* Las expansiones que dejaste cerradas. Se guardan en el navegador y no en la cuenta:
   es cómo te gusta ver la lista en este aparato, no un dato de la colección. Por eso
   la compu y el celular se acuerdan cada uno de lo suyo. */
const COLLAPSED_STORAGE_KEY = 'dbz-cromeros-plegadas'

/* El botón de exportar vive en la barra fija y es un ícono solo: mucha gente no se
   entera de que está. Cada tanto hace un movimiento corto, "tocame".

   Lo que importa no es la animación, son las cuatro reglas que la apagan, para que sea
   una ayuda y no un cartel:
     · sólo si ya cargó cartas, porque si no no hay nada que exportar;
     · sólo si nunca exportó, o si la última vez fue hace más de dos semanas;
     · tres veces por visita y se termina;
     · y nunca si el sistema pide menos movimiento, que para algunas personas no es un
       gusto sino mareo o migraña.
   En cuanto lo usa, se anota la fecha y no vuelve a moverse. */
const LAST_EXPORT_STORAGE_KEY = 'dbz-cromeros-exporto'
const WINK_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000 // dos semanas largas
const WINK_COUNT = 3
const FIRST_WINK_DELAY_MS = 20000
const WINK_INTERVAL_MS = 70000

function readLastExport() {
  try { return Number(localStorage.getItem(LAST_EXPORT_STORAGE_KEY) ?? 0) } catch { return 0 }
}

function readCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)) ?? []) }
  catch { return new Set() }
}

/* ¿ESTE APARATO YA ELIGIÓ QUÉ DEJAR PLEGADO? Se pregunta ANTES de que corra el efecto que
   guarda, porque ese efecto escribe `[]` en el primer render y entonces la clave existe
   siempre — preguntar después diría que sí desde el primer segundo. */
function hadCollapsedPreference() {
  try { return localStorage.getItem(COLLAPSED_STORAGE_KEY) !== null } catch { return false }
}

export default function App() {
  /* Todos los catálogos, por id. Un `null` adentro es «no cargó», que NO es lo mismo que
     «cargó vacío»: de esa distinción depende que el pie no ofrezca borrar 1936 cartas. */
  const [catalogs, setCatalogs] = useState(null)
  const [collection, setCollection] = useState(readCollection)
  const [error, setError] = useState(null)
  // La cuenta entera, no el nombre: trae además si es administrador.
  const [account, setAccount] = useState(undefined) // undefined = todavía no sé
  const [collectionData, setCollectionData] = useState(EMPTY_COLLECTION)

  /* LA DIRECCIÓN SIGUE AL ESTADO, y ése es todo el ruteo que hay del lado de la app.
     Quién se dibuja lo sigue decidiendo `account` tres pantallas más abajo, exactamente
     igual que antes de que existieran las rutas — así que esto no puede cambiar lo que
     ves, sólo lo que dice la barra de direcciones. Al revés habría que reescribir el
     árbol de decisión, que es donde viven los tres estados de carga que ya costaron sus
     bugs. El porqué de `replaceState` y de que no haya `pushState` está en `routes.js`. */
  useEffect(() => { syncPath(pathFor(account)) }, [account])

  /* Hace falta aparte de `collectionData` porque `EMPTY_COLLECTION` es ambiguo: no distingue «todavía no
     llegó» de «este usuario no tiene ninguna carta», y las dos son un objeto vacío. */
  const [collectionLoaded, setCollectionLoaded] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [conditionPrompt, setConditionPrompt] = useState(null)
  /* Las cartas que no se pudieron guardar, no un sí/no. Era un booleano, y entonces el
     primer guardado bueno de CUALQUIER carta lo apagaba: marcabas cuarenta sin señal,
     volvía la señal, tocabas una más, salía bien y el cartel desaparecía diciendo que
     todo se estaba guardando. Con un conjunto, el aviso se va cuando de verdad no queda
     ninguna, y de paso puede decir cuántas son. */
  const [failedKeys, setFailedKeys] = useState(() => new Set())
  const [loggingOut, setLoggingOut] = useState(false)
  /* Por qué estás en la pantalla de entrada. Sin esto, la colección desaparecía de golpe
     y sin explicación cuando se vencía la sesión. */
  const [sessionNotice, setSessionNotice] = useState(null)
  /* Un archivo de copia que no se puede leer no puede tirar abajo la app entera: ese
     aviso va al pie, al lado del botón que lo abrió. */
  const [fileNotice, setFileNotice] = useState(null)
  /* La copia leída del archivo, esperando que la confirmes. */
  const [pendingRestore, setPendingRestore] = useState(null)
  /* Se incrementa para volver a pedir el catálogo y la colección desde cero. */
  const [reloadCount, setReloadCount] = useState(0)
  /* No se pudo ni averiguar quién sos. Es un estado aparte de `error` porque se decide
     ANTES de saber si hay cuenta, y aparte de `account = null` porque no es lo mismo:
     mandar al formulario de entrada cuando el servidor está caído hace creer que se
     venció la sesión y que hay que volver a escribir la clave. */
  const [startupError, setStartupError] = useState(null)
  /* `navigator.onLine` miente en un sentido —dice que sí cuando estás colgado de un wifi
     sin salida— pero nunca en el otro: si dice que no, no hay red. Alcanza para no
     mandar a mirar la conexión cuando la conexión ya volvió. */
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false)
  /* La pantalla de «no hay conexión» (ConnectionTrouble) vive en su propio estado y no
     se apaga al tocar Reintentar: `startupError` y `error` se limpian para volver a
     pedir, pero `trouble` sigue hasta que la carga sale BIEN. `at` es la hora del último
     intento fallido y `detail`, lo técnico que viaja en el WhatsApp. */
  const [trouble, setTrouble] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  /* El panel vive en el hash `#panel`, y no en un booleano suelto, por una razón muy
     concreta de teléfono: ATRÁS TIENE QUE CERRARLO. Con un booleano, el primer botón que
     aprieta cualquiera para cerrar algo que ocupa la pantalla te saca de la app. De paso
     sobrevive a un F5 y se puede pasar el link.

     `#cartas` ya existía para el enlace de saltar, así que esto convive: cualquier hash
     que no sea `#panel` lo cierra. */
  /* Y DESDE EL 2026-10-15 EL PANEL TIENE DOS VISTAS, también en el hash: `#panel` son los
     números y `#panel/users` es la lista de cuentas con sus filtros. Un mapa y no un
     `startsWith`, para que un hash inventado no abra media pantalla. */
  const [panelView, setPanelView] = useState(panelViewFromHash)
  const dashboardOpen = panelView !== null
  /* Si la entrada la empujamos nosotros, cerrar es `history.back()`. Si en cambio llegó
     con `#panel` en la dirección, no hay a dónde volver y un `back()` se va del sitio.

     ESO SE PREGUNTA AL HISTORIAL, NO A UN REF. Con un `useRef` se perdía al recargar:
     abrías el panel con el botón, apretabas F5 —la página vuelve con `#panel` y el panel
     abierto— y al cerrar tomaba la rama equivocada, dejando dos entradas idénticas sin
     hash. El Atrás siguiente navegaba de `.../` a `.../`: no pasaba nada en pantalla, que
     es justo lo que este diseño existe para evitar. `history.state` sobrevive al F5. */
  const isOwnHistoryEntry = () => !!(history.state && history.state.dbzPanel)
  const [winking, setWinking] = useState(false)
  /* Cuándo exportó por última vez vive en un estado y no sólo en localStorage: así,
     al usarlo, el efecto de abajo se vuelve a correr y cancela los guiños que quedaban
     programados. Guardándolo sólo en localStorage seguía guiñando después de usarlo. */
  const [lastExportAt, setLastExportAt] = useState(readLastExport)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  /* La última expansión abierta POR TOQUE: es la única cuya grilla entra animada. */
  const [justOpened, setJustOpened] = useState(null)
  /* Y la que se está CERRANDO: su grilla queda montada sólo lo que dura el repliegue
     (el fin de la animación la desmonta). `collapsed` ya dice plegada desde el toque,
     así que lo persistido no espera a nadie. */
  const [closingId, setClosingId] = useState(null)
  const [aliasNotice, setAliasNotice] = useState(null)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [orphansDialogOpen, setOrphansDialogOpen] = useState(false)
  const [variantPrompt, setVariantPrompt] = useState(null)
  const [addByNumberOpen, setAddByNumberOpen] = useState(false)
  // Qué se completó con el último toque: {expansion, album}, o null.
  const [celebration, setCelebration] = useState(null)

  /* Los diálogos, con un solo mecanismo: en esta app no hay dos abiertos a la vez
     —el telón se come los clicks de atrás— así que alcanza con «hay alguno» y «cerrá el
     que sea». Si algún día se pueden apilar, esto pasa a ser uno por diálogo. */
  const isDialogOpen =
    exportOpen || passwordDialogOpen || profileOpen || orphansDialogOpen || addByNumberOpen ||
    !!conditionPrompt || !!variantPrompt || !!pendingRestore || !!celebration
  const closeDialogs = useCallback(() => {
    setExportOpen(false)
    setPasswordDialogOpen(false)
    setProfileOpen(false)
    setOrphansDialogOpen(false)
    setAddByNumberOpen(false)
    setConditionPrompt(null)
    setVariantPrompt(null)
    setPendingRestore(null)
    setCelebration(null)
  }, [])
  useCloseOnBack(isDialogOpen, closeDialogs)

  /* QUE NO SE SCROLLEE LO DE ATRÁS mientras hay algo encima. Va en un solo lugar para
     todo lo que tapa la pantalla —los diálogos, el panel y el cambio de clave
     obligatorio, que a propósito no cuenta como diálogo porque no se puede cerrar— y
     por eso incluye los tres. Lo medido y el porqué del mecanismo, en `dialog.js`. */
  useLockScroll(isDialogOpen || dashboardOpen || !!account?.mustChange)

  /* Atrás y adelante del navegador mueven el hash, y de ahí sale si el panel está
     abierto. Un solo oyente para los dos sentidos. */
  /* Los dos eventos, y hacen falta los dos: `popstate` cubre Atrás y Adelante (incluido
     el que vuelve de una entrada puesta con `pushState`), y `hashchange` cubre el enlace
     de saltar a `#cartas`, que cierra el panel. Es idempotente, así que que disparen los
     dos no molesta. */
  useEffect(() => {
    const syncDashboardFromHash = () => setPanelView(panelViewFromHash())
    window.addEventListener('popstate', syncDashboardFromHash)
    window.addEventListener('hashchange', syncDashboardFromHash)
    return () => {
      window.removeEventListener('popstate', syncDashboardFromHash)
      window.removeEventListener('hashchange', syncDashboardFromHash)
    }
  }, [])

  /* `pushState` y no `location.hash = ...` porque hay que dejar la marca en el estado.
     Ojo: `pushState` NO dispara `hashchange`, así que el estado se prende acá a mano. */
  const openDashboard = () => {
    history.pushState({ dbzPanel: true }, '', PANEL_HASH.numbers)
    setPanelView('numbers')
  }
  const closeDashboard = () => {
    if (isOwnHistoryEntry()) { history.back(); return }
    history.replaceState(null, '', location.pathname + location.search)
    setPanelView(null)
  }
  /* Entrar a una vista de adentro EMPUJA, igual que abrir el panel: así Atrás vuelve a
     los números y recién el siguiente cierra el panel, que es lo que espera cualquiera
     que entró a la lista desde adentro. */
  const openPanelView = (view) => {
    const hash = PANEL_HASH[view]
    if (!hash) return
    history.pushState({ dbzPanel: true }, '', hash)
    setPanelView(view)
  }
  /* Y VOLVER ES `back()`, NO OTRO PUSH, por lo mismo que cerrar el panel: empujando
     `#panel` encima quedaría el historial `#panel · #panel/users · #panel` y el Atrás
     siguiente te devolvería a la lista de la que acabás de salir — el botón Atrás preso,
     que es justo el bug que este diseño existe para evitar. Sólo cuando la entrada NO es
     nuestra (llegaste con `#panel/users` pegado en la dirección) no hay a dónde volver y
     ahí se reemplaza. */
  const backToPanelNumbers = () => {
    if (isOwnHistoryEntry()) { history.back(); return }
    history.replaceState(null, '', location.pathname + location.search + PANEL_HASH.numbers)
    setPanelView('numbers')
  }

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed])) }
    catch { /* modo privado o sin lugar: se pierde al recargar, nada más */ }
  }, [collapsed])

  const fileInputRef = useRef(null)
  /* El reloj del aviso del alias, para poder apagarlo al desmontar y no dejar un
     setState apuntando a un componente que ya no está. */
  const aliasTimerRef = useRef(null)
  /* Lo tocado que todavía no salió, por carta: el valor final y el reloj de la espera. */
  const pending = useRef(new Map())
  /* El último envío en vuelo de cada carta. El siguiente se encadena atrás de ése en vez
     de salir suelto: cuando el viaje tarda más que la espera —un celular con datos—
     quedaban dos PUT de la misma carta viajando juntos, y si llegaban al revés se
     guardaba el viejo después del nuevo. */
  const inFlight = useRef(new Map())
  /* El último valor conocido de cada carta, esperando que le toque salir. Es lo que hace
     que cinco toques encolados no sean cinco viajes: el envío que llega a la línea de
     largada lee acá el número final, y los que venían atrás con números ya viejos se
     encuentran el casillero vacío y no salen a la red. */
  const queued = useRef(new Map())
  /* Cuándo se leyó la colección por última vez, para el refresco de abajo. */
  const lastReadAt = useRef(0)

  const { estados: conditions, cantidades: quantities } = collectionData

  /* Las que de verdad se pueden mostrar: si un archivo no cargó, su píldora no existe. */
  const availableCollections = useMemo(
    () => (catalogs ? COLLECTIONS.filter((c) => catalogs[c.id]) : []),
    [catalogs]
  )
  /* Si la guardada no cargó, se cae a la primera que sí: mejor mostrar algo que nada. */
  const shownCollectionId = availableCollections.some((c) => c.id === collection)
    ? collection
    : availableCollections[0]?.id
  /* Cuánto llevás en CADA álbum, para que el selector lo diga sin tener que cambiar de
     álbum para enterarte. Son los 3033 huecos de las dos colecciones recorridos de nuevo
     cuando cambia algo — lo mismo que ya cuesta el avance del encabezado, que recorre los
     1936 del álbum activo en cada toque. La cuenta vive en `albumTally` y es la misma que
     usa `summary`, así que el número de la píldora activa no puede discrepar del grande. */
  const albumTallies = useMemo(() => {
    const result = {}
    for (const c of COLLECTIONS) {
      const cat = catalogs?.[c.id]
      if (cat) result[c.id] = albumTally(cat.expansiones, quantities)
    }
    return result
  }, [catalogs, quantities])

  const album = shownCollectionId ? catalogs[shownCollectionId] : null
  const catalog = album?.expansiones ?? null

  /* LA PRIMERA VEZ, CON LA COLECCIÓN VACÍA, TODO ARRANCA PLEGADO. Lo que veía alguien
     recién anotado eran las 16 expansiones abiertas —1936 casilleros vacíos de una— con
     un «0 de 1936 · 0%» arriba. Plegado son 16 renglones con su nombre, su rango y su
     cuenta: se entiende de qué tamaño es la cosa y por dónde entrar.
   *
   * No es una corazonada, es donde está el agujero. Medido en la base el 16-10-2026:
   * de los 30 que se anotaron y nunca marcaron una carta, **21 entraron un solo día**;
   * y de los 32 que sí marcaron, **17 lo hicieron en los primeros diez minutos**. Nadie
   * se desencanta después — los 40 que cargaron siguen activos —, así que lo único que
   * sigue roto es el primer rato.
   *
   * Las tres guardas son para no pisarle la vista a nadie: sólo si este aparato NUNCA
   * eligió qué plegar, sólo cuando ya se sabe qué hay (si no, se pliega y al llegar la
   * colección habría que desplegar, que es un salto), y sólo si la colección está
   * VACÍA — al que vuelve con 1464 cartas en una compu nueva no se le cambia nada. Y se
   * pliegan las de los dos álbumes, porque la situación es la misma en los dos. */
  const hadPreference = useRef(hadCollapsedPreference())
  const foldedFirstTime = useRef(false)
  useEffect(() => {
    if (hadPreference.current || foldedFirstTime.current) return
    if (!catalogs || !collectionLoaded) return
    if (Object.keys(quantities).length > 0) return
    foldedFirstTime.current = true
    setCollapsed(new Set(Object.values(catalogs).flatMap((c) => c?.expansiones?.map((e) => e.id) ?? [])))
  }, [catalogs, collectionLoaded, quantities])
  /* Cuatro a la vista de cinco declarados: con condición va «Para reemplazar», sin
     condición va «Faltan variantes». Ver la nota de FILTERS. Y «Repetidas» sólo si HAY
     alguna: un filtro que siempre da vacío es un botón que no hace nada. Se mira
     `quantities` directo y no `summary.byFilter`, que se declara más abajo (la trampa
     TDZ de siempre); para «¿hay alguna?» dan lo mismo. Si el filtro está puesto y la
     última repetida se va, el chip desaparece y `effectiveFilter` cae a «Todas». */
  const visibleFilters = FILTERS.filter((f) => {
    if (album?.condicion ? f.id === 'variants' : f.id === 'replace') return false
    if (f.id === 'duplicates') return Object.values(quantities).some((n) => n > 1)
    return true
  })
  /* El invariante «el filtro activo tiene chip» se fija ACÁ y no en el click, porque el
     álbum también cambia sin pasar por la píldora: la caída a la primera colección que
     cargó, y un Reintentar que termina de cargar la recordada. Lo encontró la revisión:
     con el estado crudo, un «Para reemplazar» huérfano en Leyenda filtraba la grilla con
     un botón que ya no se dibuja — el álbum entero vacío, sin ninguna pista de por qué,
     y sin forma de verlo presionado. La grilla, el aviso de vacío y el aria-pressed
     miran TODOS éste, nunca `activeFilter` directo. */
  const effectiveFilter = visibleFilters.some((f) => f.id === activeFilter) ? activeFilter : 'all'

  function pickCollection(id) {
    /* El filtro activo puede no existir en el álbum al que vas («Para reemplazar» no está
       en Leyenda ni «Faltan variantes» en Cromeros): de eso se ocupa `effectiveFilter`,
       que vale para este camino Y para los cambios de álbum que no pasan por acá. */
    setCollection(id)
    rememberCollection(id)
  }

  /* Espejo de `collectionData` que se actualiza en el mismo instante del toque y no en el próximo
     render. `quantities` sale del render anterior: dos toques en el mismo frame leen los
     dos el mismo número y el segundo pisa al primero — un toque perdido. Se resincroniza
     solo cuando los datos cambian por otro lado (la lectura del servidor, restaurar). */
  const liveRef = useRef(collectionData)
  useEffect(() => { liveRef.current = collectionData }, [collectionData])

  /* Sube de a uno en cada restauración. `saveWithRetries` la captura al empezar y se rinde si
     cambió: un reintento programado a 900 o 1800 ms no puede aterrizar DESPUÉS de que se
     reemplazó la colección entera y reponer una carta que la copia no traía. */
  const generation = useRef(0)

  /* Para leer las fallidas desde un efecto que no depende de ellas. */
  const failedKeysRef = useRef(failedKeys)
  failedKeysRef.current = failedKeys
  /* Cómo se llaman esas cartas. Se asigna más abajo, cuando el catálogo ya está resuelto;
     `handleSessionExpired` la lee de acá porque se declara antes. */
  const describeFailedRef = useRef(null)

  useEffect(() => {
    /* Con corte, igual que todos los pedidos de `api.js`. Era el unico
       `fetch` de la app sin techo de tiempo, y un pedido COLGADO no es lo mismo que uno
       que falla: sin corte se quedaba para siempre en la pantalla de espera, que no tiene
       ni botón de reintentar ni forma de salir. Con el corte cae en el `catch` de abajo,
       que sí lo tiene. Los 15 s son los mismos que usa `request`. */
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), 15000)

    loadCatalogs(abortController.signal)
      .then((catalogsById) => {
        /* Sólo es un error si no cargó NINGUNO. Que falte Leyenda no puede dejar sin app a
           quien viene a marcar Cromeros: el selector muestra lo que haya. */
        if (!Object.values(catalogsById).some(Boolean)) throw new Error('ninguno')
        setCatalogs(catalogsById)
      })
      .catch(() => setError('No se pudo cargar el catálogo de cartas.'))
      .finally(() => clearTimeout(timer))
  }, [reloadCount])

  /* ¿El token guardado sigue sirviendo? Si no, se muestra la pantalla de entrada.

     Un 401 vuelve como `null` y va al formulario. Cualquier otra cosa —el servidor
     caído, un deploy a medio terminar, el teléfono sin datos— NO es eso, y antes
     terminaba en el mismo lugar: parecía que se te había vencido la sesión y que había
     que volver a escribir la clave, cuando lo único que hacía falta era esperar. */
  useEffect(() => {
    setStartupError(null)
    fetchAccount()
      .then((c) => setAccount(c))
      /* Lo que se guarda es el DETALLE técnico y no un texto para mostrar: lo que lee la
         persona lo escribe ConnectionTrouble —que su sesión sigue abierta y que no tiene
         que hacer nada—, y esto viaja adentro del WhatsApp. */
      .catch((e) => setStartupError(loadErrorDetail(e)))
  }, [reloadCount])

  /* La colección es la del usuario: se pide al entrar y se olvida al salir.

     LA CONDICIÓN ES EL TOKEN Y NO `account`, Y ESO VALE UN VIAJE ENTERO. Esperando a
     `account` los dos pedidos salían en fila —primero `/api/yo`, y recién cuando
     contestaba, `/api/coleccion`—, y en 3G cada viaje son varios cientos de
     milisegundos. Pero los dos necesitan lo mismo y nada más: el token, que ya está en
     `localStorage` antes de que arranque nada. Así que salen juntos.

     No cambia lo que se ve cuando algo falla: un 401 de cualquiera de los dos termina
     en la pantalla de entrada igual, y `request` ya borró el token antes de avisar.

     El ref es lo que evita el pedido repetido: el efecto se vuelve a correr cuando
     `account` pasa de `undefined` al usuario, y sin él serían dos lecturas de la
     colección en cada carga. Lleva el `reloadCount` adentro para que el botón de reintentar
     sí vuelva a pedir. */
  const collectionRequestedFor = useRef(null)
  useEffect(() => {
    setFailedKeys(new Set())
    const t = token()
    /* `!t && !account` y no sólo `!t`: hay un navegador con el almacenamiento bloqueado
       donde `storeToken` no puede escribir, se lo traga a propósito, y entonces el
       login anda pero `token()` sigue devolviendo null. Mirando sólo el token, ese
       usuario entraba a un álbum VACÍO con el pie jurándole que se estaba guardando.
       Pidiendo igual, el 401 lo manda a la pantalla de entrada, que es feo pero honesto. */
    if (!t && !account) {
      collectionRequestedFor.current = null
      return setCollectionData(EMPTY_COLLECTION)
    }
    const requestTag = `${t ?? 'sin-token'}|${reloadCount}`
    if (collectionRequestedFor.current === requestTag) return
    collectionRequestedFor.current = requestTag
    fetchCollection()
      .then((d) => { lastReadAt.current = Date.now(); setCollectionData(d); setCollectionLoaded(true) })
      // Si el token ya no sirve, a la pantalla de entrada: un cartel de error con un
      // solo botón de Salir no le sirve a nadie.
      .catch((e) => (e?.sessionExpired ? handleSessionExpired() : setError(loadErrorDetail(e))))
  }, [account, reloadCount])

  /* Se mira la red para dos cosas: no mandar a revisar la conexión cuando ya volvió, y
     reintentar solo lo que había quedado sin guardar. Lo segundo hace falta de verdad:
     volver a tocar la carta NO reintenta, le suma una, así que sin esto el usuario no
     tenía ninguna forma de recuperar esos cambios. Y reintentar solo es más fiel al
     "cero ceremonia" que ponerle un botón. */
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine !== false)
    addEventListener('online', updateOnline)
    addEventListener('offline', updateOnline)
    return () => { removeEventListener('online', updateOnline); removeEventListener('offline', updateOnline) }
  }, [])

  /* Cuándo se prende y cuándo se apaga la pantalla de «no hay conexión».
     El error de la colección o del catálogo sólo cuenta con sesión: sin cuenta va la
     pantalla de entrada, igual que antes. */
  const loadError = startupError ?? (account ? error : null)
  useEffect(() => {
    if (!loadError) return
    setTrouble({ at: new Date(), detail: loadError })
    setRetrying(false)
  }, [loadError])

  /* Se apaga recién cuando hay con qué dibujar: la cuenta (o la certeza de que no hay
     sesión) y, con sesión, el catálogo y la colección. Apagarla apenas se toca Reintentar
     era el «Cargando…» de medio segundo que hacía parecer muerto al botón. */
  const loadedEnough = account === null || Boolean(account && catalog && collectionLoaded)
  useEffect(() => {
    if (trouble && !loadError && loadedEnough) {
      setTrouble(null)
      setRetrying(false)
    }
  }, [trouble, loadError, loadedEnough])

  function retryNow() {
    setRetrying(true)
    setStartupError(null)
    setError(null)
    setReloadCount((n) => n + 1)
  }

  /* Reintenta sola mientras la pantalla esté puesta. `trouble` cambia en cada intento
     fallido (trae la hora nueva), así que el reloj se vuelve a armar solo. */
  useEffect(() => {
    if (!trouble || retrying) return
    const timer = setTimeout(retryNow, AUTO_RETRY_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [trouble, retrying])

  /* Y apenas vuelve internet, sin esperar los treinta segundos. */
  useEffect(() => {
    if (isOnline && trouble && !retrying) retryNow()
  }, [isOnline])

  useEffect(() => {
    if (!isOnline) return
    for (const cardKey of failedKeysRef.current)
      queueSave(cardKey, liveRef.current.cantidades[cardKey] ?? 0, liveRef.current.estados[cardKey] ?? null)
  }, [isOnline])

  /* #91: irse con cambios que no se pudieron guardar los pierde para siempre, y hasta
     acá en silencio — al recargar volvía el número del servidor y el pie decía que todo
     se estaba guardando. No hay dónde dejarlos (la colección no se guarda en el aparato,
     y es a propósito), así que lo único honesto es avisar antes de que se vaya. Sólo se
     engancha cuando hay algo perdido: en el camino normal no molesta nunca. */
  useEffect(() => {
    if (!failedKeys.size) return
    const warnBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    addEventListener('beforeunload', warnBeforeUnload)
    return () => removeEventListener('beforeunload', warnBeforeUnload)
  }, [failedKeys.size])

  function markFailed(cardKey, failed) {
    setFailedKeys((prev) => {
      if (failed === prev.has(cardKey)) return prev
      const next = new Set(prev)
      if (failed) next.add(cardKey); else next.delete(cardKey)
      return next
    })
  }

  /* Un guardado que falla se reintenta un par de veces antes de darse por perdido. Es
     más fiel al "cero ceremonia" que un cartel: casi todos los fallos son un bache de
     red de un segundo, y de eso el usuario no tiene por qué enterarse.

     `isLeaving` es la página yéndose: ahí no se reintenta nada, no hay tiempo. */
  async function saveWithRetries(cardKey, quantity, condition, isLeaving) {
    const gen = generation.current
    for (let attempt = 0; ; attempt++) {
      try {
        // keepalive también acá, no sólo al cerrar: lo que hay que proteger no son los
        // 250 ms de espera —eso ya lo cubría el vaciado— sino el viaje entero, que en un
        // teléfono con datos son entre 300 y 3000 ms. Si la pestaña se cierra en el
        // medio, sin esto el navegador aborta el pedido y ese toque se pierde.
        await saveCard(cardKey, quantity, condition, { keepalive: true })
        return true
      } catch (e) {
        // La sesión murió: no hay nada que reintentar, hay que volver a entrar. Antes
        // esto pintaba el cartel de "fijate la conexión" y la app seguía andando: podías
        // marcar media hora al vacío y perder todo sin enterarte.
        /* Hubo una restauración mientras esto viajaba: este valor es de la colección
           ANTERIOR y ya no significa nada. No se reintenta y no se marca como fallado
           —no se perdió un cambio: se reemplazó a propósito—. `null` es justamente
           «no mandé nada» y quien llama ya lo distingue. */
        if (generation.current !== gen) return null
        if (e?.sessionExpired) { handleSessionExpired(undefined, cardKey); return false }
        if (isLeaving || attempt >= MAX_RETRIES) return false
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
        if (generation.current !== gen) return null
      }
    }
  }

  /* Saca de la cola lo último que se sabe de esa carta y lo manda, encadenado atrás del
     envío anterior de la MISMA carta, para que dos no se pisen. */
  function sendQueued(cardKey, isLeaving) {
    const entry = pending.current.get(cardKey)
    if (!entry) return null
    clearTimeout(entry.timer)
    pending.current.delete(cardKey)

    /* Yéndose la página no se encadena ni se espera nada: el fetch tiene que salir
       DENTRO del manejador de pagehide, o el navegador descarta el documento antes de
       que corra ningún .then(). Si esperáramos al envío anterior de esta carta —que
       puede no volver nunca— el valor nuevo no saldría jamás, y es justo el que hay que
       salvar. Se acepta el riesgo chico de que el anterior llegue último: mucho mejor
       que perderlo seguro. Medido: sin esto, irse con un PUT en vuelo hacía que el
       último toque ni siquiera saliera a la red. */
    if (isLeaving) {
      /* Y lo que esperaba turno en el casillero queda descartado: lo que sale acá es más
         nuevo. `pagehide` no siempre termina en documento descartado —con bfcache la
         página vuelve—, así que si el encadenado despertara, mandaría el número viejo
         encima del que acabamos de mandar. */
      queued.current.delete(cardKey)
      saveCard(cardKey, entry.quantity, entry.condition, { keepalive: true })
        .catch(() => markFailed(cardKey, true))
      return null
    }

    /* El valor queda en el casillero y el envío lo lee recién cuando le toca salir. */
    queued.current.set(cardKey, { quantity: entry.quantity, condition: entry.condition })

    const previous = inFlight.current.get(cardKey) ?? Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(() => {
        /* Si otro envío encadenado ya se llevó el valor final, éste saldría con un
           número viejo: no sale. Medido antes de esto: con el primer envío retenido,
           cinco toques daban cinco viajes seguidos aunque sólo importara el último. */
        const v = queued.current.get(cardKey)
        if (!v) return null
        queued.current.delete(cardKey)
        return saveWithRetries(cardKey, v.quantity, v.condition, isLeaving)
      })
      .then((ok) => {
        // null es "no mandé nada", y entonces no puede apagar el aviso de un fallo ajeno.
        if (ok !== null) markFailed(cardKey, !ok)
        if (inFlight.current.get(cardKey) === current) inFlight.current.delete(cardKey)
        // Con la clave adentro, así quien espera el vaciado sabe QUÉ falló y no sólo
        // cuántos: al salir hay que juntarlo con lo que ya venía fallado de antes.
        return { cardKey, ok }
      })
    inFlight.current.set(cardKey, current)
    return current
  }

  /* Manda una carta sola, esperando por si vienen más toques de la misma. */
  function queueSave(cardKey, quantity, condition) {
    const existing = pending.current.get(cardKey)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => sendQueued(cardKey, false), SAVE_DELAY_MS)
    pending.current.set(cardKey, { quantity, condition, timer })
  }

  /* Vaciar todo lo pendiente de una. Sólo toca refs y setters de React, así que no se
     queda vieja aunque la capture un efecto con dependencias vacías.

     Espera también lo que YA salió y sigue viajando (`inFlight`), no sólo la cola: si no,
     tocar una carta, mirarla medio segundo y recién ahí salir dejaba el PUT en el aire y
     el DELETE de la sesión le ganaba de mano. Ese caso es más probable que el que se
     cubría antes. */
  function flushAll(isLeaving) {
    for (const cardKey of [...pending.current.keys()]) sendQueued(cardKey, isLeaving)
    if (isLeaving) {
      /* Y NO ALCANZA CON `pending`: el último toque puede no estar ahí. Cuando ya
         había un PUT de esa carta en vuelo, `sendQueued` le cumplió la espera de 250 ms, lo
         sacó de `pending` y lo dejó en el casillero encadenado atrás de ese viaje —que
         en un teléfono con datos son entre 300 y 3000 ms—. Yéndose la página, ese
         `.then()` no corre nunca: el valor se quedaba en el casillero y NI SIQUIERA SALÍA
         A LA RED, que es exactamente el bug que el encadenado por carta vino a arreglar y
         que acá volvía por la puerta de al lado. Sale por el mismo camino de emergencia:
         `keepalive` y sin encadenar. */
      /* SI ESE ENVÍO FALLA, SE ANOTA. El camino de emergencia no pasa por `saveWithRetries`, o
         sea que no tiene los dos reintentos — no hay tiempo — pero eso no es razón para
         tragarse el fallo. `pagehide` no siempre termina en documento descartado: con
         bfcache la página vuelve, y ahí un `.catch(() => {})` dejaba la carta en pantalla
         con el número nuevo, el pie diciendo «Guardando a cada cambio» y nada en
         `failedKeys` — con lo que ni el reintento por `online` ni el refresco al volver la
         tocaban, y a los 60 s el servidor devolvía el número viejo y el cambio desaparecía
         también de la pantalla. Sin rastro.

         Si el documento sí se descarta, el `setState` de `markFailed` es un no-op y no
         cuesta nada. No agrega maquinaria: usa el conjunto que el pie ya mira. */
      for (const [cardKey, v] of [...queued.current]) {
        queued.current.delete(cardKey)
        saveCard(cardKey, v.quantity, v.condition, { keepalive: true })
          .catch(() => markFailed(cardKey, true))
      }
      return Promise.resolve() // la página se va: no hay nada que esperar
    }
    return Promise.all([...inFlight.current.values()].map((p) => p.catch(() => {})))
  }

  /* La sesión murió: lo encolado ya no se puede mandar, y si se mandara podría salir con
     el token de OTRA cuenta que entre en esta misma pestaña. Se tira.

     Y NO ALCANZA CON VACIAR LA COLA. Un reintento programado a 900 o 1800 ms no vive en
     `pending` —vive en el `await` de `saveWithRetries`, que ya salió de la cola— así que
     limpiar los tres mapas no lo toca: se despierta, vuelve a leer el token de
     `localStorage`, y si en el medio entró otra cuenta en esta misma pestaña **sale con
     ese token**. El servidor hace lo correcto con la credencial que le llega, así que no
     hay 401 que lo frene: es una carta de una persona escrita en la cuenta de otra.

     Subir `generation` es justamente el freno que ya existe para eso: `saveWithRetries` guarda
     el valor al empezar y se rinde con `null` en los dos puntos donde vuelve del await. */
  function dropQueue() {
    generation.current += 1
    for (const { timer } of pending.current.values()) clearTimeout(timer)
    pending.current.clear()
    queued.current.clear()
    inFlight.current.clear()
  }

  /* SI QUEDABA ALGO SIN GUARDAR, SE DICE CUÁL. Al volver a entrar, el efecto que lee la
     colección hace `setFailedKeys(new Set())` —tiene que hacerlo: la colección se relee del
     servidor y podría ser otra cuenta— así que esos cambios desaparecían **en silencio**.
     El pie dejaba de avisar y no quedaba rastro de qué cartas habían sido.

     No se reintentan a propósito: después de una sesión muerta el que vuelve a entrar
     puede ser OTRA persona en la misma compu, y mandar las cartas de uno a la cuenta de
     otro es exactamente lo que el oyente de `storage` vino a evitar. Lo único honesto es
     decir cuáles fueron, que es lo mismo que hace `beforeunload` al irse con algo perdido. */
  function handleSessionExpired(notice, failedKey) {
    const lostKeys = new Set(failedKeysRef.current)
    /* La carta cuyo 401 mató la sesión también se perdió, y todavía no está en el
       conjunto: `saveWithRetries` llama acá ANTES de anotar el fallo, y después `dropQueue` se
       lleva la cola. Sin esto, el toque que destapó el problema era justo el que no se
       nombraba. */
    if (failedKey) lostKeys.add(failedKey)
    dropQueue()
    const base = notice ?? 'Se venció tu sesión. Entrá de nuevo para seguir.'
    const lostNames = lostKeys.size ? describeFailedRef.current?.(lostKeys) ?? '' : ''
    setSessionNotice(
      lostKeys.size
        ? `${base} Quedaron ${lostKeys.size} ${lostKeys.size === 1 ? 'cambio' : 'cambios'} sin guardar${lostNames ? `: ${lostNames.replace(/^Son la /, 'la ').replace(/\.$/, '')}` : ''}. Vas a tener que marcar${lostKeys.size === 1 ? 'la' : 'las'} de nuevo.`
        : base
    )
    setAccount(null)
  }

  /* DOS PESTAÑAS EN LA MISMA COMPU NO PUEDEN SER DOS CUENTAS.
     El token vive en `localStorage`, que es de todo el origen, pero `account` es estado de
     React y por lo tanto de esta pestaña sola. Sin esto: tenés abierta la colección de
     angel, alguien entra como lucas en otra pestaña, y la primera sigue dibujando las
     cartas de angel y diciendo «Guardando en tu cuenta, angel» — pero el próximo toque
     sale con el token de lucas y se guarda en la cuenta equivocada. No hay 401 que lo
     frene, porque el token es válido: el servidor hace lo correcto con la credencial que
     le llega.

     El evento `storage` NO se dispara en la pestaña que hizo el cambio, que es justo lo
     que hace falta. `e.key === null` es un `clear()` entero y también cuenta. */
  useEffect(() => {
    const ownToken = token()
    const handleStorage = (e) => {
      if (e.key !== null && e.key !== TOKEN_STORAGE_KEY) return
      if (token() !== ownToken) handleSessionExpired('Entraste con otra cuenta en otra pestaña. Entrá de nuevo acá.')
    }
    addEventListener('storage', handleStorage)
    return () => removeEventListener('storage', handleStorage)
  }, [account])

  const flushAllRef = useRef(null)
  flushAllRef.current = flushAll

  /* Lo que el servidor manda, pero conservando lo que NO se pudo guardar.

     Sin esto, el refresco al volver a la pestaña pisaba `collectionData` con lo del servidor y no
     tocaba `failedKeys`: tu cambio desaparecía de la pantalla sin que nada lo dijera, la
     carta seguía marcada como «sin guardar» pero mostrando el número VIEJO, y no había
     forma de destrabarlo —volver a tocarla no reintenta, le suma una—.

     Y lo peor venía después: el reintento por `online` lee `liveRef.current`, que tras el
     refresco ya era el valor del servidor, así que mandaba el número viejo, salía bien y
     apagaba el aviso. El mecanismo que existe para recuperar un cambio perdido terminaba
     certificando que se había guardado. */
  function keepFailedChanges(d) {
    const lostKeys = failedKeysRef.current
    if (!lostKeys.size) return d
    const nextQuantities = { ...d.cantidades }
    const nextConditions = { ...d.estados }
    for (const cardKey of lostKeys) {
      const n = liveRef.current.cantidades[cardKey] ?? 0
      if (n > 0) {
        nextQuantities[cardKey] = n
        nextConditions[cardKey] = liveRef.current.estados[cardKey] ?? null
      } else {
        // Lo que quiso borrar y no se pudo: tampoco vuelve.
        delete nextQuantities[cardKey]
        delete nextConditions[cardKey]
      }
    }
    return { estados: nextConditions, cantidades: nextQuantities }
  }

  /* Volver a pedir la colección al volver a la pestaña, si pasó un rato.

     Antes se pedía UNA sola vez y nunca más. El teléfono con la pestaña abierta desde
     hace una semana mostraba la carta 700 en 0; si mientras tanto la pusiste en 2 desde
     la compu, el próximo toque en el teléfono calculaba sobre ESA instantánea vieja y
     mandaba 1: la base retrocedía, y no había ningún error que lo delatara.

     Lo pendiente se manda ANTES de releer, o la respuesta del servidor lo pisaría. */
  useEffect(() => {
    if (!account) return
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastReadAt.current < REFRESH_AFTER_MS) return
      lastReadAt.current = Date.now()
      Promise.resolve(flushAllRef.current(false))
        .catch(() => {})
        .then(() => fetchCollection())
        .then((d) => {
          const merged = keepFailedChanges(d)
          liveRef.current = merged
          setCollectionData(merged)
          /* Y se reintenta lo que había quedado sin guardar, que acá tiene más sentido
             que en ningún lado: acabamos de leer del servidor, o sea que la red anda. */
          for (const cardKey of failedKeysRef.current)
            queueSave(cardKey, merged.cantidades[cardKey] ?? 0, merged.estados[cardKey] ?? null)
        })
        .catch(() => { /* si falla, se sigue con lo que ya había en pantalla */ })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [account])

  useEffect(() => () => clearTimeout(aliasTimerRef.current), [])

  /* Si cerrás la pestaña justo después de un toque, eso todavía no salió. */
  useEffect(() => {
    const handlePageHide = () => flushAllRef.current(true)
    addEventListener('pagehide', handlePageHide)
    return () => { removeEventListener('pagehide', handlePageHide); handlePageHide() }
  }, [])

  /* Cambiar una carta: primero se ve en pantalla, después sale para el servidor. */
  function applyChange(cardKey, quantity, condition) {
    const d = liveRef.current
    const previousQuantity = d.cantidades[cardKey] ?? 0
    const nextQuantities = { ...d.cantidades }
    const nextConditions = { ...d.estados }
    if (quantity > 0) {
      nextQuantities[cardKey] = quantity
      if (condition) nextConditions[cardKey] = condition; else delete nextConditions[cardKey]
    } else {
      // Cantidad 0 es no tenerla, y entonces tampoco tiene condición.
      delete nextQuantities[cardKey]
      delete nextConditions[cardKey]
    }
    /* Se escribe el espejo ANTES del setCollectionData, así el toque siguiente —aunque caiga en
       el mismo frame, antes de que React vuelva a dibujar— calcula sobre este número y
       no sobre el del render viejo. */
    liveRef.current = { estados: nextConditions, cantidades: nextQuantities }
    setCollectionData(liveRef.current)
    queueSave(cardKey, quantity, quantity > 0 ? condition : null)

    /* El festejo, sólo cuando un casillero pasa de no tenerla a tenerla: es el único toque
       que puede completar algo. Si cuando llega éste ya hay uno abierto, queda el primero. */
    if (!previousQuantity && quantity > 0) {
      const done = completionBy(cardKey, d.cantidades, nextQuantities, album)
      if (done) setCelebration((current) => current ?? done)
    }
  }

  /* Cartas que están en tu cuenta pero NO en el catálogo.

     El servidor valida la FORMA de la clave, no que exista: «exp-9:1» tiene forma de
     carta y entra igual. Hoy no hay ninguna, pero el catálogo se edita sin recompilar
     nada, así que el día que una expansión cambie de id o se recorte un rango, las filas
     viejas quedan huérfanas: no se pueden tocar —no hay carta que tocar—, sobreviven a
     bajar y restaurar una copia, y ocupan lugar contra el tope de 2200.

     La tentación es que el servidor valide contra el catálogo. NO sirve para esto, y es
     lo que hace que este arreglo esté de este lado: cuando el catálogo cambia, esas
     filas YA están guardadas y eran válidas cuando se escribieron. Ninguna validación de
     entrada las saca. Lo que hace falta es poder verlas y borrarlas, y el único lado que
     conoce el catálogo es éste. */
  /* SE COMPARA CONTRA TODOS LOS CATÁLOGOS, mires lo que mires, y es de pérdida de datos.
     `quantities` son las filas de la cuenta ENTERA, las dos colecciones juntas. Mirando
     sólo el catálogo elegido, apenas cambiás a Leyenda las 1936 de Cromeros figuran como
     huérfanas y el pie ofrece borrarlas de un click.

     Y devuelve `[]` mientras falte cargar alguno: si `leyenda.json` no bajó, no hay nada
     que declarar. Un archivo que no llegó no es un catálogo vacío. */
  const orphans = useMemo(() => {
    if (!catalogs) return []
    if (COLLECTIONS.some((c) => !catalogs[c.id])) return []
    return Object.keys(quantities).filter((c) => !pointsToASlot(c, catalogs))
  }, [catalogs, quantities])

  /* Se borran de a una, con el mismo camino que usa cada toque (cantidad 0 = no tener
     fila). A propósito NO va por el reemplazo masivo: ése es el único camino que borra
     en masa y no hace falta abrirlo para esto. */
  /* La copia se baja ANTES de tocar nada, igual que al restaurar: si el catálogo estaba
     mal, es lo único que permite volver. */
  function removeOrphans() {
    downloadJson(collectionData, 'mi-coleccion-dbz-antes-de-sacar.json')
    for (const cardKey of orphans) applyChange(cardKey, 0, null)
    setOrphansDialogOpen(false)
  }

  /* Las variantes que se DIBUJAN por expansión, que no son las mismas que se ofrecen:
     acá entra también lo que ya tenés cargado con un id que el catálogo dejó de declarar.
     Se calcula una vez por cambio de colección y no por carta. */
  const drawableByExpansion = useMemo(() => drawableVariants(catalog, quantities), [catalog, quantities])

  const summary = useMemo(() => {
    if (!catalog) return null
    let total = 0, owned = 0
    const conditionCounts = { bien: 0, perfecta: 0, reemplazar: 0 }
    const byFilter = Object.fromEntries(FILTERS.map((f) => [f.id, 0]))

    /* `total` son los HUECOS del álbum: las variantes nunca son huecos, porque nadie sabe
       cuántas existen. `owned` es cuántos huecos tienen algo — si no, tener la 551 en dos
       fondos daría «1079 de 1078».

       Acá se contaban también los sobrantes, para el «N repetidas» del encabezado que se
       fue el 2026-10-19: el filtro «Repetidas» ya lleva su contador y eran dos números
       distintos para lo mismo. El exportar cuenta los suyos aparte, por carta, que es lo
       que necesita para armar la lista. */
    for (const exp of catalog) {
      /* Los Manuales no son cartas: fuera del avance Y de los contadores de filtro. Si
         contaran en los chips, el de «Todas» diría 1956 al lado de un «de 1946» — los
         dos números en la misma pantalla sin cerrar entre sí, que es el bug documentado
         de los contadores. Ver `countsInTally`. */
      if (!countsInTally(exp)) continue
      for (const n of exp.cardNumbers) {
        total++
        let hasAny = false
        /* LOS CONTADORES DE LOS FILTROS SON DE HUECOS, NO DE CASILLEROS, y hace falta
           para que los números cierren entre sí. Contando casilleros, teniendo la 2 en
           dos fondos el chip «Todas» decía «Colección 1099» al lado de un «4 de 1097»,
           y 1093 + 4 no daba 1099. Un hueco cuenta para un filtro si ALGUNO de sus
           casilleros pasa, que además es lo que se ve: la carta aparece en el listado. */
        const slotMatches = Object.fromEntries(FILTERS.map((f) => [f.id, false]))
        for (const { cardKey } of slotsOf(exp, n, drawableByExpansion[exp.id], quantities)) {
          const quantity = quantities[cardKey] ?? 0
          const condition = conditions[cardKey]
          if (quantity > 0) {
            hasAny = true
            conditionCounts[condition ?? 'bien']++
          }
          for (const f of FILTERS) if (f.matches?.(quantity, condition)) slotMatches[f.id] = true
        }
        /* Los filtros de HUECO deciden una vez por carta, no por casillero. */
        for (const f of FILTERS) if (f.matchesHole?.(exp, n, quantities, drawableByExpansion[exp.id])) slotMatches[f.id] = true
        for (const f of FILTERS) if (slotMatches[f.id]) byFilter[f.id]++
        if (hasAny) owned++
      }
    }
    /* `total` y `owned` salen de `albumTally`, que es lo mismo que cuenta el selector:
       una sola regla de «tener un hueco» para el número grande y para la píldora, que si
       no el día que esa regla cambie —ya cambió una vez, con las variantes— uno de los
       dos se queda viejo y los dos números se contradicen en la misma pantalla. El bucle
       de arriba sigue para lo que es sólo de acá: sobrantes, condiciones y los filtros.
       Hay un `assert` barato en desarrollo por si alguna vez se separan. */
    const tally = albumTally(catalog, quantities)
    if (import.meta.env?.DEV && (tally.total !== total || tally.owned !== owned)) {
      console.warn('el avance y el selector cuentan distinto', { bucle: { total, owned }, tally })
    }
    return { ...tally, byFilter, ...conditionCounts }
  }, [catalog, drawableByExpansion, conditions, quantities])

  /* La columna «Álbum» del panel es cuánto lleva cada uno de TODO lo que hay para
     marcar, no de la colección que yo esté mirando: `g.cartas` cuenta las filas de esa
     persona, que son las dos colecciones juntas. Con `summary.total` dividiría 1936
     cartas por los 1097 huecos de Leyenda y daría 176%. */
  /* LO QUE EL PANEL NECESITA SABER DE LOS CATÁLOGOS, y que el servidor no puede saber.
     Cada colección con su nombre, cuántos huecos tiene y qué prefijos de clave son suyos.
     Sin esto la columna «Álbum» divide por la suma de los dos: el que tiene Cromeros
     entero —1936 de 1936— se dibujaba con 64%.

     Acá los Manuales van ADENTRO a propósito, id y total, aunque no contabilicen en la
     app: sin el id, el panel anuncia los manuales marcados como «de un catálogo viejo»
     con cartel de borrar; y con el id pero sin el total, el numerador puede pasar al
     denominador y alguien a una carta de terminar sale con 100%. La columna «Álbum» es
     «todo lo que hay para marcar», y los manuales se marcan. */
  const dashboardCollections = useMemo(() => {
    const result = []
    for (const c of COLLECTIONS) {
      const col = catalogs?.[c.id]
      if (!col) continue
      result.push({
        id: c.id,
        name: c.name,
        total: col.expansiones.reduce((a, e) => a + e.cardNumbers.length, 0),
        expansionIds: col.expansiones.map((e) => e.id),
      })
    }
    return result
  }, [catalogs])

  /* La expansión que tenés más cerca de terminar, si te falta poco. */
  const almostDone = useMemo(
    () => (catalog ? closestToComplete(catalog, quantities) : null),
    [catalog, quantities])

  /* El rango que acepta «Agregar por número» (1 a 1936 en Cromeros) y el ejemplo de cómo
     se escribe una especial («504E»), los dos sacados del catálogo y no escritos a mano —
     perseguir al catálogo con números fijos es el error documentado del 1936. */
  const numberRun = useMemo(() => (catalog ? plainNumberRun(catalog) : null), [catalog])
  const suffixExample = useMemo(() => {
    const exp = (catalog ?? []).find((e) => e.sufijo && !e.prefijo)
    return exp ? cardLabel(exp, exp.cardNumbers[0]) : null
  }, [catalog])

  /* Llevar a una expansión: si estaba plegada se abre, y recién después se baja hasta
     ella — con la banda cerrada el anclaje caería en el renglón de arriba. El `0` del
     timeout es para que React ya haya dibujado la expansión abierta. */
  const goToExpansion = (exp) => {
    if (collapsed.has(exp.id)) setJustOpened(exp.id)
    setCollapsed((old) => {
      if (!old.has(exp.id)) return old
      const next = new Set(old)
      next.delete(exp.id)
      return next
    })
    setTimeout(() => {
      /* La sección va con display: contents (no tiene caja): lo que se scrollea es su
         primer hijo, la banda, que es la que lleva el scroll-margin-top. */
      const target = document.getElementById(`exp-${exp.id}`)
      ;(target?.firstElementChild ?? target)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 0)
  }

  const hasOwnedCards = (summary?.owned ?? 0) > 0

  /* Los números de las cartas que no se pudieron guardar. La clave es «expansión:número»,
     así que el número sale de ahí sin tener que buscar en el catálogo. Se nombran hasta
     seis: más que eso no se lee, y con esa cantidad el problema ya no es encontrarlas. */
  /* Con dos colecciones, «la 551» es ambiguo: hay una 551 en cada álbum. Así que a la
     que NO es de la colección que estás mirando se le antepone el rótulo corto de su
     expansión. A las de acá no, que son la mayoría y el número pelado se lee mejor.

     LA CLAVE NO SE PARTE POR LOS DOS PUNTOS, y eso era un bug que se veía: con una
     variante, `ley-6-dor:824` daba `exp = 'ley-6-dor'`, que no figura en la tabla de
     rótulos —ahí sólo están los ids de expansión— y salía tal cual. El pie decía **«No se
     pudo guardar ley-6-dor 824»**: la clave interna, en la cara del usuario, en el único
     cartel que aparece cuando algo salió mal. Hoy lo resuelve `slotName`, que busca contra
     el catálogo y nombra también la variante. */
  /* Sale del `useMemo` porque hace falta en otro lado: cuando muere la sesión hay que
     decir CUÁLES quedaron sin guardar, y ahí no hay render del que colgarse. */
  const describeFailed = useCallback((keys) => {
    if (!keys.size) return ''
    const localExpansionIds = new Set((catalog ?? []).map((e) => e.id))
    const names = [...keys]
      .map((c) => {
        const slot = slotOf(c, catalogs)
        /* Si no apunta a ningún hueco conocido —un catálogo que no cargó— se cae al
           número, que es lo único seguro. Nunca a la clave. */
        if (!slot) {
          const n = Number(c.slice(c.lastIndexOf(':') + 1))
          return Number.isFinite(n) && c.includes(':') ? { n, text: String(n) } : null
        }
        /* El «de dónde es» lo resuelve `slotName`, que sabe que el `corto` y el `prefijo`
           hacen el mismo trabajo. Acá se apilaban: «Son la F F504». */
        return { n: slot.n, text: slotName(c, catalogs, localExpansionIds.has(slot.exp.id)) }
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n)
      .map((x) => x.text)
    if (!names.length) return ''
    if (names.length <= 6) return `Son la ${names.join(', la ')}.`
    return `Son la ${names.slice(0, 6).join(', la ')} y ${names.length - 6} más.`
  }, [catalog, catalogs])

  const failedDescription = useMemo(() => describeFailed(failedKeys), [failedKeys, describeFailed])
  /* Por ref, como `flushAllRef`: `handleSessionExpired` se declara más arriba y la necesita. */
  describeFailedRef.current = describeFailed

  useEffect(() => {
    if (!hasOwnedCards) return
    if (Date.now() - lastExportAt < WINK_COOLDOWN_MS) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let remaining = WINK_COUNT
    let timers = []
    const wink = () => {
      setWinking(true)
      timers.push(setTimeout(() => setWinking(false), 1500))
      if (--remaining > 0) timers.push(setTimeout(wink, WINK_INTERVAL_MS))
    }
    timers.push(setTimeout(wink, FIRST_WINK_DELAY_MS))
    return () => timers.forEach(clearTimeout)
  }, [hasOwnedCards, lastExportAt])

  /* Se abrió el diálogo: ya sabe que el botón está. Se anota y no se mueve más. */
  function openExport() {
    const now = Date.now()
    setWinking(false)
    setLastExportAt(now)
    try { localStorage.setItem(LAST_EXPORT_STORAGE_KEY, String(now)) } catch { /* modo privado */ }
    setExportOpen(true)
  }

  /* Contraer una expansión: deja de dibujarse su grilla y queda sólo la banda. Queda
     guardado: lo que dejaste cerrado sigue cerrado cuando volvés. */
  function toggleCollapsed(id) {
    if (collapsed.has(id)) {
      /* Se está abriendo: la que anima es ésta y sólo ésta. Al cargar la página las
         grillas abiertas se montan sin animar — dieciséis a la vez es ruido. */
      setJustOpened(id)
      if (closingId === id) setClosingId(null)
    } else {
      /* Se está cerrando: la grilla se queda hasta que el repliegue termine. El timeout
         es el respaldo por si el animationend no llega (un ancestro oculto, un navegador
         raro): un estado de cierre que no muere deja la grilla montada para siempre. */
      if (justOpened === id) setJustOpened(null)
      setClosingId(id)
      setTimeout(() => setClosingId((c) => (c === id ? null : c)), 400)
    }
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* Un toque: si no la tenés, pregunta la condición. Si ya la tenés, suma una. */
  function tap(cardKey, number) {
    const currentQuantity = liveRef.current.cantidades[cardKey] ?? 0

    /* LA APP PREGUNTA CUANDO HAY MÁS DE UNA RESPUESTA POSIBLE, y cuando hay una sola no
       pregunta. Es la regla de siempre: en Cromeros, el primer toque pregunta la condición
       —hay tres respuestas— y el segundo no vuelve a preguntar, porque «a la repetida no
       le corresponde un estado propio».

       EN UNA EXPANSIÓN CON VARIANTES LA PREGUNTA ES LA MISMA TENGAS O NO TENGAS LA CARTA:
       cuál es. Y va PRIMERO, antes de mirar la cantidad. La primera versión sólo
       preguntaba en el segundo toque y Angel lo encontró al minuto de usarla: tocaba una
       carta vacía teniendo una Rosa vino en la mano, se ponía violeta como «sin
       clasificar» y no le preguntaba nada. La regla estaba bien; estaba aplicada a la
       mitad de los casos.

       Se pregunta también al tocar un casillero de variante que ya tenés, y no es por
       gusto: si el hueco no tiene casillero base dibujado —que es lo que pasa cuando
       tenés la variante y no la base— sería el único lugar desde donde se puede agregar
       una variante DISTINTA. Sumándole una directo, esa tercera variante quedaba
       inalcanzable. */
    const slot = slotForKey(cardKey)
    if (slot && variantsFor(slot.exp, slot.n).length) return setVariantPrompt(slot)

    if (!currentQuantity) {
      /* Sin variantes y sin condición —el resto de Leyenda— hay una sola respuesta
         posible, así que no se pregunta: la deja en 1. */
      if (!album?.condicion) return applyChange(cardKey, 1, null)
      return setConditionPrompt({ cardKey, label: cardLabel(slot?.exp, number) })
    }
    applyChange(cardKey, currentQuantity + 1, liveRef.current.estados[cardKey])
  }

  /* De qué hueco del álbum es este casillero. La parte de la clave anterior a los dos
     puntos puede ser el id de la expansión o ese id con el sufijo de una variante, y los
     ids de expansión llevan guiones (`ley-2-3`), así que no se puede partir por guion: se
     busca contra el catálogo, que es quien sabe. */
  function slotForKey(cardKey) {
    const colonIndex = cardKey.lastIndexOf(':')
    const expansionPart = cardKey.slice(0, colonIndex)
    const n = Number(cardKey.slice(colonIndex + 1))
    for (const exp of catalog ?? []) {
      if (expansionPart === exp.id || expansionPart.startsWith(exp.id + '-')) return { exp, n }
    }
    return null
  }

  /* Elegiste una variante: se le suma una a ESE casillero. */
  function pickVariant(id) {
    const slot = variantPrompt
    setVariantPrompt(null)
    if (!slot) return
    const cardKey = slotKey(slot.exp.id, slot.n, id)
    applyChange(cardKey, (liveRef.current.cantidades[cardKey] ?? 0) + 1, liveRef.current.estados[cardKey] ?? null)
  }

  /* Mantener apretado: resta una. Al llegar a cero se olvida también la condición. */
  function decrement(cardKey) {
    /* Si no la tenés no hay nada que restar. Sin esto salía un PUT con cantidad -1, el
       servidor lo rechazaba con un 400 y el pie pintaba "No se pudo guardar el último
       cambio. Fijate la conexión." por un gesto que la propia app sugiere —y sobre
       1597 de las 1936 cartas, que es el estado más común. Una falsa alarma de pérdida
       de datos hace que el usuario desconfíe de todo lo demás. */
    const currentQuantity = liveRef.current.cantidades[cardKey] ?? 0
    if (!currentQuantity) return
    applyChange(cardKey, currentQuantity - 1, liveRef.current.estados[cardKey])
  }

  /* Las dos de arriba son distintas en cada render, porque leen `cantidades`. Estas dos
     no cambian nunca, y son las que reciben las 1936 cartas: si a cada una le pasáramos
     una flecha nueva, el memo de Card no serviría de nada. El ref guarda siempre la
     versión fresca, y estas la leen recién cuando el dedo toca. */
  const handlersRef = useRef(null)
  handlersRef.current = { tap, decrement }
  const handleTap = useCallback((cardKey, number) => handlersRef.current.tap(cardKey, number), [])
  const handleHold = useCallback((cardKey) => handlersRef.current.decrement(cardKey), [])

  function pickCondition(condition) {
    applyChange(conditionPrompt.cardKey, 1, condition)
    setConditionPrompt(null)
  }

  /* El OK de «Agregar por número»: resuelve el número contra el catálogo y después hace
     LO MISMO que un toque en esa carta — ése fue el pedido, «como si le hubieras hecho un
     click». Si lo que sigue es una pregunta (el estado de una que no tenés, o la variante),
     este diálogo se cierra y la pregunta se abre; si es una repetida muda, el diálogo se
     queda y la dice, porque acá la carta no está a la vista. Devuelve lo que AddByNumber
     tiene que mostrar, o null si ya no hay nada que decir. */
  function addByNumber(text) {
    const match = /^(\d+)\s*([a-zA-Z])?$/.exec(text)
    if (!match) return { error: 'Escribí el número de la carta y nada más.' }
    const n = Number(match[1])
    const suffix = match[2]?.toUpperCase() ?? null
    const exp = expansionForNumber(catalog, n, suffix)
    if (!exp) {
      return {
        error: suffix
          ? `No hay ninguna carta ${n}${suffix}.`
          : `No hay ninguna carta ${n}: van del ${numberRun.min} al ${numberRun.max}.`,
      }
    }
    const cardKey = slotKey(exp.id, n)
    const quantity = liveRef.current.cantidades[cardKey] ?? 0
    if (!quantity || variantsFor(exp, n).length) {
      setAddByNumberOpen(false)
      tap(cardKey, n)
      return null
    }
    tap(cardKey, n)
    return { added: `La ${cardLabel(exp, n)} ya la tenías: se sumó una repetida, ahora tenés ${quantity + 1}.` }
  }

  /* El alias se copia de un toque: es para pegarlo en el homebanking, no para leerlo. */
  async function copyAlias() {
    let copied = false
    try {
      await navigator.clipboard.writeText(ALIAS)
      copied = true
    } catch {
      // El portapapeles moderno pide pestaña con foco y sitio seguro. Donde no se
      // puede, el de toda la vida todavía anda.
      const textarea = document.createElement('textarea')
      textarea.value = ALIAS
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      copied = document.execCommand?.('copy') ?? false
      textarea.remove()
    }
    // Un botón que no hace nada es peor que uno que avisa que no pudo.
    setAliasNotice(copied ? 'copiado' : 'copialo a mano')
    clearTimeout(aliasTimerRef.current)
    aliasTimerRef.current = setTimeout(() => setAliasNotice(null), 2500)
  }

  async function handleLogout() {
    /* Guarda de reentrada: sin esto, dos clicks seguidos reproducían el bug original
       entero y en silencio — el segundo encontraba la cola ya vacía, resolvía al toque y
       mandaba el DELETE con el PUT todavía viajando. */
    if (loggingOut) return
    setLoggingOut(true)
    /* Primero lo pendiente, y esperándolo: después de salir el token ya no sirve, así
       que el último toque salía con una sesión muerta y se perdía siempre. Y como App no
       se desmonta al salir, la limpieza del efecto tampoco corría.

       Pero con techo. Un pedido que se cuelga no puede dejarte atrapado adentro de la
       app: se midió a Salir bloqueando quince segundos sin decir nada. Si no llega a
       tiempo se pierde ese cambio, que es mejor que un botón que no sale nunca. */
    /* Lo que se pierde al salir no es sólo lo que falle en este último vaciado: lo que
       YA había fallado —y que el pie viene mostrando— también se va sin dejar rastro.
       Por eso se parte del mismo conjunto que mira el pie y se le aplica lo de ahora.
       Mirar sólo el resultado del vaciado daba cero, y se comprobó: para cuando tocás
       Salir, aquel envío ya falló hace rato y su promesa no está más en la cola. */
    const lostKeys = new Set(failedKeysRef.current)
    let finished = false
    const flushing = flushAll(false)
      .then((r) => {
        finished = true
        for (const x of r ?? []) {
          if (!x || x.ok === null || x.ok === undefined) continue
          if (x.ok) lostKeys.delete(x.cardKey); else lostKeys.add(x.cardKey)
        }
      })
      .catch(() => { finished = true })
    await Promise.race([flushing, new Promise((r) => setTimeout(r, LOGOUT_MAX_WAIT_MS))])
    await logout()
    dropQueue()
    const lostCount = lostKeys.size
    /* Sin red, Salir se llevaba el toque y no lo decía en ningún lado: el aviso del pie
       se iba junto con la pantalla. Se cuenta lo que no llegó a entrar y se dice en la
       pantalla de entrada, que es la única que el usuario va a estar mirando. Si venció
       el techo no sabemos cuántos fueron, y decirlo así es más honesto que callarlo. */
    if (lostCount)
      setSessionNotice(lostCount === 1
        ? 'Saliste, pero un cambio no se pudo guardar: quedó sin registrar en tu cuenta.'
        : `Saliste, pero ${lostCount} cambios no se pudieron guardar: quedaron sin registrar en tu cuenta.`)
    else if (!finished)
      setSessionNotice('Saliste sin que terminara de guardarse el último cambio. Fijate la conexión.')
    setAccount(null)
    setError(null)
    setLoggingOut(false)
  }

  /* Restaurar un respaldo: se manda entera y se pisa lo que había en la cuenta. */
  /* Leer el archivo NO reemplaza nada: sólo abre la confirmación. */
  function loadBackupFile(file) {
    setFileNotice(null)
    readBackupFile(file)
      .then((d) => {
        // El servidor también lo rechaza, pero es mejor decirlo acá que dejar confirmar
        // algo que va a fallar.
        if (!Object.keys(d.cantidades).length)
          return setFileNotice('Esa copia no tiene ninguna carta. No se cambió nada.')
        setPendingRestore(d)
      })
      .catch((e) => {
        if (e?.sessionExpired) return handleSessionExpired()
        /* Los errores del navegador al leer un archivo vienen en inglés y hablan de
           permisos del sistema: no le dicen nada a nadie. Sólo se muestran los nuestros,
           que están escritos para leerse. */
        setFileNotice(e instanceof ApiError
          ? e.message
          : 'No pude leer ese archivo. ¿Es una copia de tu colección?')
      })
  }

  /* Confirmado. Primero se baja sola una copia de lo que había —la red por si el archivo
     elegido no era el que creías— y recién después se reemplaza. */
  function confirmRestore() {
    const backup = pendingRestore
    setPendingRestore(null)
    if (!backup) return
    downloadJson(collectionData, 'mi-coleccion-dbz-antes-de-restaurar.json')

    /* PRIMERO SE ESPERA A LO QUE YA SALIÓ, Y RECÉN DESPUÉS SE REEMPLAZA.
       Restaurar es el único camino que borra en masa y el CLAUDE.md lo protege con tres
       capas para que el resultado sea exactamente el archivo. Pero un PUT de carta que
       salió hace 200 ms puede aterrizar DESPUÉS del reemplazo y reponer una carta que la
       copia no traía: la colección queda contaminada, sin ningún aviso, y no se descubre
       hasta la próxima carga.

       Cancelarlo desde el navegador no sirve: un `abort` corta la espera del cliente, no
       impide que el servidor procese lo que ya le llegó. Lo único que ORDENA de verdad es
       esperar. Con techo, porque un pedido colgado no puede dejar la restauración
       trabada; y lo que sobreviva al techo lo frena la `generation`, que corta los
       reintentos. Queda una ventana chica —un PUT colgado que conteste entre el techo y
       su propio corte de 15 s— y se acepta: cerrarla del todo pediría que el servidor
       supiera ordenar, que es mucho más caro que el problema. */
    generation.current += 1
    for (const { timer } of pending.current.values()) clearTimeout(timer)
    pending.current.clear()
    queued.current.clear()
    const inFlightSettled = Promise.all([...inFlight.current.values()].map((pp) => pp.catch(() => {})))

    Promise.race([inFlightSettled, new Promise((r) => setTimeout(r, RESTORE_MAX_WAIT_MS))])
      .then(() => replaceCollection(backup))
      /* Se relee del servidor en vez de pintar lo que venía en el archivo. El servidor
         es la única fuente y puede haber descartado claves que no reconoce: antes la
         pantalla te mostraba cartas que en tu cuenta no habían quedado, y no había forma
         de darse cuenta hasta la próxima visita. Si la relectura falla, se muestra lo
         del archivo, que es lo que se hacía siempre. */
      .then(() => fetchCollection().catch(() => backup))
      .then((d) => {
        lastReadAt.current = Date.now()
        liveRef.current = d
        setCollectionData(d)
        // Se reemplazó todo: lo que no se había podido guardar carta por carta ya no
        // tiene sentido. (La cola ya se vació arriba, antes de esperar.)
        pending.current.clear()
        queued.current.clear()
        inFlight.current.clear()
        setFailedKeys(new Set())
      })
      .catch((e) => {
        if (e?.sessionExpired) return handleSessionExpired()
        setFileNotice(e.message ?? 'No se pudo reemplazar la colección.')
      })
  }

  /* Va ANTES del formulario de entrada a propósito: si el servidor no contesta, mandar
     a alguien a escribir usuario y clave es mentirle sobre lo que pasó y encima no le
     sirve de nada, porque tampoco va a poder entrar. Y con sesión, un corte de dos
     segundos al abrir o un deploy a medio terminar no puede dejar como única salida
     desloguearse: se reintenta sin perder la sesión, y «Salir» queda callado abajo. */
  if (trouble) return (
    <ConnectionTrouble
      offline={!isOnline}
      retrying={retrying}
      lastAttemptAt={trouble.at}
      detail={trouble.detail}
      username={account?.username}
      onRetry={retryNow}
      onLogout={account ? handleLogout : null}
    />
  )
  if (account === undefined) return <div className="sheet"><p className="loading">Cargando…</p></div>
  if (!account) return <Login notice={sessionNotice} onLogin={(c) => { setSessionNotice(null); setAccount(c) }} />
  /* LA GRILLA NO SE DIBUJA HASTA QUE LLEGÓ LA COLECCIÓN, y no es cosmético.
     `collectionData` arranca en `EMPTY_COLLECTION`, así que apenas contestan `/api/yo` y el catálogo se
     dibujaban las 1936 cartas en «me falta» mientras `/api/coleccion` seguía viajando.
     Esa grilla se podía tocar: `tap` lee `liveRef.current.cantidades[cardKey] ?? 0`, ve un 0
     que en realidad es «no sé», abre el diálogo de condición y manda un PUT con
     cantidad 1 PISANDO en el servidor la cantidad de verdad. Y después la colección
     llegaba y devolvía el número bueno a la pantalla, así que no quedaba ni rastro: el
     usuario se entera la próxima vez que abre la app, o nunca. */
  if (!catalog || !collectionLoaded) return <div className="sheet"><p className="loading">Cargando…</p></div>

  /* Qué está viejo de lo que corre afuera de la app. Vacío para todo el mundo menos el
     admin, porque `/api/yo` sólo le manda `salud` a él. */
  const staleItems = whatIsStale(account?.health)

  const pct = (n) => (n / summary.total) * 100

  return (
    <>
      {/* Antes de todo: entre el encabezado y la primera carta hay un logo, el progreso
          y cinco botones de la barra. Con teclado o lector de pantalla eso son varios
          tabuladores en CADA visita antes de llegar a lo único que importa. La pantalla
          de entrada ya tenía su <main>; la app, que es donde se pasa el tiempo, no. */}
      <a className="skip" href="#cartas">Saltar a las cartas</a>

      {/* Header, barra y footer van fuera de la columna de las cartas: así el fondo
          de cada franja llega de lado a lado y lo de adentro sigue alineado. */}
      <header className="masthead">
        <div className="column">
          <div className="mark">
              <h1>
                <img src="./logo.png" alt="Dragon Ball Z" width="660" height="168" />
              </h1>
            {/* QUÉ ÁLBUM ESTOY MIRANDO. Píldoras y no un `<select>`: con dos opciones el
                desplegable es un click de más.

                SE LLEVA EL RENGLÓN DEL SUBTÍTULO, y el subtítulo se va. Decía «Mi colección
                · Cartas Cromeros · 2007–2008», que es el nombre de la colección escrito en
                prosa: el selector dice lo mismo y además deja cambiarla. Y así el
                encabezado no gana una fila — en angosto es una grilla donde cada hijo
                tiene su `grid-area` a mano, y un hermano nuevo sin área se auto-coloca en
                una fila implicita. Eso ya llevó el encabezado de 162 a 266 px una vez.

                Va en el encabezado y NO en la barra de filtros, por lo mismo que el botón
                del panel: en teléfono esa barra son cinco lugares de ancho igual. */}
            {/* EL SELECTOR ES UN CONTROL DE DOS POSICIONES, no dos botones sueltos, y eso
                es lo que arregla cómo se leía — Angel: «el selector de Cromeros / Leyenda
                está poco pulido». Eran dos píldoras con el mismo aire que «Panel» y «Mi
                perfil», que son acciones: parecían tres cosas de la misma clase cuando
                una es «qué estoy mirando» y las otras «llevame a otro lado». Metidas en
                un riel se lee de una que son dos caras de lo mismo y que hay una elegida.

                Y CADA UNA DICE CÓMO VAS, que es lo que hace que el selector sirva y no
                sólo se vea mejor: con dos álbumes de 1936 y 1097 huecos, «cómo voy en el
                otro» era una pregunta que obligaba a cambiar de álbum para contestarla. */}
            {availableCollections.length > 1 && (
              /* Las dos variables que ubican la pastilla que se desliza: cuántos
                 segmentos hay y cuál está puesto. Van en el estilo y no en el CSS para
                 que una tercera colección no pida tocar la hoja — ver `.album-switch`. */
              <div className="album-switch" role="group" aria-label="Qué colección estoy mirando"
                   style={{
                     '--album-count': availableCollections.length,
                     '--album-index': Math.max(0, availableCollections.findIndex((c) => c.id === shownCollectionId)),
                   }}>
                {availableCollections.map((c) => {
                  const tally = albumTallies[c.id]
                  const active = c.id === shownCollectionId
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`album-pill${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() => pickCollection(c.id)}
                    >
                      <span className="album-name">{c.name}</span>
                      {tally && (
                        /* LO QUE FALTA, no lo que tenés, y es para no decir dos veces lo
                           mismo: el avance grande de acá al lado ya dice «0 de 1936
                           cartas», así que repetirlo en la píldora era ruido. El
                           complemento es dato nuevo en las dos —también en la que no
                           estás mirando, que es de lo que se trata— y es la pregunta que
                           se hace el que colecciona. */
                        <span className="album-tally">
                          {tally.owned >= tally.total
                            ? '¡completa!'
                            : `faltan ${(tally.total - tally.owned).toLocaleString('es-AR')}`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {/* El botón del panel y el avance comparten la columna derecha: el botón arriba,
              el avance abajo. Antes `.progress` era el segundo hijo del flex del header;
              ahora lo es `.side`, y `.progress` se queda con el ancho de su columna.

              Va acá y NO en la barra de filtros: en teléfono esa barra se convierte en la
              de abajo, con cinco lugares de ancho igual, y un sexto hermano les saca a los
              cuatro filtros el 20% que tienen cada uno. El encabezado es donde vive lo que
              no es la colección. */}
          <div className="side">
            {/* LOS BOTONES DE LA CUENTA, JUNTOS: «Panel» (sólo el admin) y «Mi perfil»
                (todos). Van en un envoltorio para que en el teléfono ocupen UNA celda de la
                grilla del encabezado —la del renglón del logo— y no se auto-coloque ninguno
                en una fila implícita, que es lo que ya infló este encabezado una vez. */}
            <div className="header-actions">
            {account.admin && (
              /* LA MARCA CUANDO LA COPIA ESTÁ VIEJA. Angel: «lo único que me importa es que
                 se haga la copia de seguridad, y si no se hace que ahí sí me avise».
                 El bloque Salud del panel ya lo decía — pero hay que ABRIR el panel para
                 verlo, y eso es un tablero, no una alarma. Acá aparece en la app, que se
                 abre todos los días.

                 Y NO ES UN CARTEL NI UN DIÁLOGO a propósito: un aviso que tapa algo se
                 aprende a cerrar sin leerlo. Un punto en un botón que ya está ahí no molesta
                 nunca y no se puede pasar por alto dos días seguidos.

                 El umbral NO se decide acá: sale de `health.js`, que es el mismo módulo que
                 usa el panel. Si viviera en los dos lados, un día dirían cosas distintas. */
              <button
                className={`open-panel${staleItems.length ? ' has-alert' : ''}`}
                onClick={openDashboard}
                aria-label={staleItems.length
                  ? `Panel · revisá ${staleText(staleItems)}`
                  : undefined}
              >
                {/* SVG y no un emoji: un emoji lo dibuja cada sistema a su manera y en
                    Android viejo puede salir un cuadradito. */}
                <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" focusable="false">
                  <rect x="0" y="7" width="3" height="6" rx="1" fill="currentColor" />
                  <rect x="5" y="3" width="3" height="10" rx="1" fill="currentColor" />
                  <rect x="10" y="0" width="3" height="13" rx="1" fill="currentColor" />
                </svg>
                Panel
              </button>
            )}
              {/* «MI PERFIL». Un ícono solo, con su nombre para el lector de pantalla y sin
                  `title` (con los dos, el lector lee el nombre dos veces). */}
              <button type="button" className="profile-button" aria-label="Mi perfil"
                      onClick={() => setProfileOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              </button>
            </div>
            <div className="progress">
              {/* TRES BANDAS Y NO UN MONTÓN: el avance arriba, la barra, y debajo lo
                  secundario. Eran cuatro datos en una sola línea que además se partía
                  —«de 1936 / cartas», «20 / repetidas»— y Angel lo dijo tal cual: «parece
                  un conjunto de cosas agrupadas simplemente».

                  El porcentaje se va al EXTREMO DERECHO, alineado con el final de la
                  barra que tiene abajo: así deja de ser un cuarto dato suelto y pasa a
                  decir cuánto de esa barra está lleno. */}
              <div className="tally">
                <span className="large">{summary.owned}</span>
                {/* El porcentaje sale de los mismos dos números que están al lado, así que
                    no puede contradecirlos — y vale igual en los dos álbumes porque los dos
                    cuentan huecos. Ver `albumPercent`. */}
                <span className="of">de {summary.total} cartas</span>
                <span className="pct">{albumPercent(summary.owned, summary.total)}%</span>
              </div>
              {/* Con condición, los tres tramos. Sin condición —Leyenda— uno solo y
                  neutro: `conditionCounts[condition ?? 'bien']++` mete TODO en `bien`, así que las tres
                  franjas pintarían «buen estado» sobre un álbum que no tiene estado. */}
              <div className="bar">
                {album?.condicion ? (
                  <>
                    <span className="s-good" style={{ width: `${pct(summary.bien)}%` }} />
                    <span className="s-perfect" style={{ width: `${pct(summary.perfecta)}%` }} />
                    <span className="s-replace" style={{ width: `${pct(summary.reemplazar)}%` }} />
                  </>
                ) : (
                  <span className="s-only" style={{ width: `${pct(summary.owned)}%` }} />
                )}
              </div>
              {/* ACÁ VIVÍA TAMBIÉN «N repetidas» Y SE FUE el 2026-10-19 — Angel: «sacá
                  ese indicador de repetidas, no tiene sentido». El filtro «Repetidas» de
                  la barra ya lleva su contador, así que el mismo dato estaba dos veces en
                  la pantalla y encima con números distintos: el filtro cuenta HUECOS con
                  más de una y éste contaba UNIDADES sobrantes, o sea «14» arriba y «20»
                  abajo para lo mismo.

                  Queda el «te falta N», que es un BOTÓN y no un cartel porque lo que
                  sigue después de leerlo es ir a esa expansión: te lleva, abriéndola si
                  estaba plegada. Ver `closestToComplete`. */}
              {almostDone && (
                /* EL AVISO ES UN VIDRIO TEÑIDO DEL COLOR DE ESA EXPANSIÓN. Tercera
                   forma, y las dos anteriores las enterró Angel, así que quedan
                   anotadas para no desandar: texto gris (quedaba como nota al pie),
                   card blanca con pastilla y chevron («feaza: el genérico de cualquier
                   app», y la fila envolvía dejando la flecha huérfana abajo), y la
                   banda maciza con tipografía de banda («muy tosco, el bold molesta,
                   mejor transparente/vidrioso»).

                   Lo que quedó: el tinte del color al 13% con su borde al 45%, y el
                   TEXTO en el mismo color oscurecido hasta leerse (`inkOn`) — porque
                   los colores del catálogo son fondos, no tintas, y crudos sobre claro
                   no llegan ni a 2.5:1. Todo monocromo del color de la expansión: eso
                   es lo que lo ata a su banda sin pesar como ella. */
                <button type="button" className="almost"
                        style={(() => {
                          const tint = tintOf(almostDone.exp.color, 0.13)
                          return { background: tint, borderColor: tintOf(almostDone.exp.color, 0.45), color: inkOn(almostDone.exp.color, tint) }
                        })()}
                        onClick={() => goToExpansion(almostDone.exp)}
                        aria-label={`Te falta${almostDone.faltan > 1 ? 'n' : ''} ${almostDone.faltan} para completar ${almostDone.exp.nombre}. Ir a esa expansión.`}>
                  <span className="almost-name">{almostDone.exp.nombre}</span>
                  <span className="almost-count">
                    te falta{almostDone.faltan > 1 ? 'n' : ''} <b>{almostDone.faltan}</b>
                  </span>
                  <svg className="almost-go" width="14" height="14" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                       aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              )}
              {/* «AGREGAR POR NÚMERO» — lo pidió Angel. Va acá, debajo de la barra, y NO
                  en la barra de filtros: en teléfono ésa son cinco lugares de ancho igual
                  y un sexto les saca el 20% a todos (está medido). Es de la familia de
                  pills terciarias («Panel»), porque es una entrada y no tiene que competir
                  con la colección.

                  Sólo en álbumes CON condición (hoy Cromeros, que es lo pedido): ahí todo
                  OK produce una respuesta visible — pregunta el estado, o el propio
                  diálogo anuncia la repetida. En Leyenda una carta sin variantes se marca
                  muda, y un botón que a veces no muestra nada parece roto. */}
              {album?.condicion && numberRun && (
                <button type="button" className="add-number" onClick={() => setAddByNumberOpen(true)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" focusable="false">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Agregar por número
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="column">
            <div className="filters">
              {visibleFilters.map((f) => (
                <button
                  key={f.id}
                  className={`filter f-${f.css}${effectiveFilter === f.id ? ' active' : ''}`}
                  onClick={() => setActiveFilter(f.id)}
                  aria-pressed={effectiveFilter === f.id}
                >
                  <svg className="icon" width="21" height="21" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                       strokeLinejoin="round" aria-hidden="true">
                    {FILTER_ICONS[f.id]}
                  </svg>
                  {/* Los dos rótulos van siempre en el DOM y el CSS elige. Ver la nota
                      de FILTERS: así no hay un `if` sobre el ancho de la pantalla. */}
                  <span className="long">{f.label}</span>
                  <span className="short">{f.shortLabel}</span>
                  <b>{summary.byFilter[f.id]}</b>
                </button>
              ))}
            </div>

            {/* A mano en la barra fija: el botón del pie queda abajo de las 1936 cartas.
                En el teléfono es el quinto lugar de la barra de abajo, con su rótulo;
                en escritorio sigue siendo el ícono solo. El `title` va sólo cuando NO
                hay rótulo visible: si hubiera los dos, el lector de pantalla leería
                «Exportar. Exportar», que es el mismo problema que tenían las cartas. */}
            <button
              className={`share${winking ? ' wink' : ''}`}
              onClick={openExport}
              aria-label="Exportar"
            >
              <svg className="icon" width="21" height="21" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                   strokeLinejoin="round" aria-hidden="true">
                {/* El avión de papel (pedido de Angel: «exportar» es mandarle la lista a alguien).
                    Va CENTRADO POR MASA y no por caja, como la Z del ícono de la app: la caja
                    llena el lienzo, pero el peso cae hacia la punta —medido: 1,85 a la derecha
                    y 1,9 arriba del centro— y se veía corrido. Correrlo solo lo cortaba en el
                    borde, así que se achica a 0,86 y el trazo se compensa (2 / 0,86) para que
                    pese lo mismo que los demás íconos. */}
                <g transform="translate(0.09 3.31) scale(0.86)" strokeWidth="2.33">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </g>
              </svg>
              <span className="short">Exportar</span>
            </button>
        </div>
      </div>

      <main className="sheet" id="cartas" tabIndex={-1}>
        {/* Fuera de la barra fija: son instrucciones, se leen una vez y pueden irse con
            el scroll. Adentro ocupaban dos renglones fijos en el celular. */}
          {/* «otra» y no «otra igual»: en una expansión con variantes el segundo toque
              NO es una repetida de la misma, te pregunta cuál tenés — y la respuesta
              puede ser otro fondo. La palabra «igual» dejó de ser cierta el día que entró
              Leyenda. Se arregla sacándola y no partiendo la frase en dos según el álbum:
              una sola que sea verdad en los dos es mejor que dos que haya que mantener, y
              además en Leyenda sólo 271 de 1097 cartas preguntan, así que ninguna versión
              condicional sería cierta para toda la colección tampoco. */}
          {/* CON TODO PLEGADO LA AYUDA DICE OTRA COSA, porque la de siempre habla de
              tocar cartas y no hay ninguna a la vista: la primera visita arranca con las
              expansiones cerradas, así que el primer paso no es marcar, es abrir la
              tuya. Se mira si hay alguna desplegada y no si la colección está vacía —
              quien plegó todo a mano está en la misma situación. */}
          <p className="help">
            {catalog.every((e) => collapsed.has(e.id))
              ? <>Abrí la expansión que estás juntando y tocá las cartas que tenés</>
              : <>
                  Tocá para marcar · de nuevo si tenés otra · mantené apretado para restar
                  {/* Con el teclado no hay «mantener apretado», así que si el atajo no se
                      dice acá no se entera nadie. Se muestra sólo cuando hay teclado de
                      verdad: en un teléfono es ruido. */}
                  <span className="keyboard-only"> · con el teclado, Backspace</span>
                </>}
          </p>

        {/* El listado vive en una grilla que en anchos grandes acomoda las fichas en
            dos o tres columnas (auto-fill decide solo). La sección va con display:
            contents, así la BANDA es una celda más —abrir no la estira— y sólo el
            despliegue de cartas ocupa la fila entera. */}
        <div className="expansions">
        {catalog.map((exp) => {
          const activeFilterDef = FILTERS.find((f) => f.id === effectiveFilter)
          /* Lo que no contabiliza sólo se ve en «Todas»: los chips no lo cuentan, así
             que mostrarlo filtrado sería listar huecos que el contador de arriba niega. */
          if (effectiveFilter !== 'all' && !countsInTally(exp)) return null
          /* Un hueco se dibuja si ALGUNO de sus casilleros pasa el filtro — o si el
             filtro es de hueco, si el hueco entero pasa. La misma distinción que en
             `summary`, para que el chip y lo dibujado cuenten lo mismo. */
          const visibleNumbers = exp.cardNumbers.filter((n) =>
            activeFilterDef.matchesHole
              ? activeFilterDef.matchesHole(exp, n, quantities, drawableByExpansion[exp.id])
              : slotsOf(exp, n, drawableByExpansion[exp.id], quantities).some((s) =>
                  activeFilterDef.matches(quantities[s.cardKey] ?? 0, conditions[s.cardKey])
                )
          )
          if (!visibleNumbers.length) return null

          /* Y la cuenta de la banda es de HUECOS, no de casilleros: «180 de 176» no
             significaría nada. */
          const ownedInExpansion = exp.cardNumbers.filter((n) =>
            slotsOf(exp, n, drawableByExpansion[exp.id], quantities).some((s) => (quantities[s.cardKey] ?? 0) > 0)
          ).length
          const isCollapsed = collapsed.has(exp.id)
          const donutPct = (ownedInExpansion / exp.cardNumbers.length) * 100
          /* Con piso y tapado a 99, como albumPercent: 128 de 129 es 99,2% y no puede
             leerse «100%». El 100 es sólo para la completa de verdad. */
          const donutLabel = ownedInExpansion === exp.cardNumbers.length
            ? '100%'
            : `${Math.min(99, Math.floor(donutPct))}%`
          /* El `id` es el blanco del «te falta 1 para completar»: sin él no hay a dónde
             llevar. Va con prefijo para no chocar con `#panel` ni `#cartas`. */
          return (
            <section className={`expansion${isCollapsed ? ' folded' : ''}`} key={exp.id} id={`exp-${exp.id}`}>
              <div
                className={`band${exp.imagen ? ' boxed' : ''}`}
                /* El mismo vidrio del aviso «te falta N»: el fondo es el tinte claro del
                   color de la expansión y el texto es ese color oscurecido hasta pasar
                   4.5:1. Así TODA banda lleva texto oscuro — con el color pleno de
                   fondo, la mitad pedía texto blanco y la otra mitad negro. */
                style={(() => {
                  const tint = tintOf(exp.color, 0.16)
                  return { background: tint, borderColor: tintOf(exp.color, 0.5), color: inkOn(exp.color, tint) }
                })()}
              >
                <button
                  className={`fold${isCollapsed ? ' closed' : ''}`}
                  onClick={() => toggleCollapsed(exp.id)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Mostrar' : 'Contraer'} ${exp.nombre}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {/* Con caja en el catálogo la banda es ficha, plegada o abierta: que
                    abrir no la cambie de forma es la mitad de que no sea brusco.
                    Decorativa (alt vacío): el nombre está al lado. */}
                {exp.imagen && (
                  <img className="band-thumb" src={exp.imagen} alt="" loading="lazy" />
                )}
                <h2>{exp.nombre}</h2>
                {/* EL RANGO VA SIN PREFIJO, y se probó con prefijo. El prefijo existe para
                    cuando el número se lee FUERA de contexto —la etiqueta hablada, el
                    título del diálogo, el texto que se pega en un grupo—; acá el contexto
                    es el nombre de la expansión, que está a diez píxeles. Y medido a 320,
                    360 y 412 px, «Leyenda 1–Leyenda 9» lleva la banda de 35 a 54 px en los
                    tres, y a 320 se corta. El CLAUDE.md ya avisaba que ahí estaba al
                    límite: hacen falta 311 px de texto en 292 de ancho útil. */}
                <span className="range">{exp.desde}–{exp.hasta}</span>
                {/* Completa es tener todas, estén en el estado que estén: las "para reemplazar"
                    también cuentan, y ya tienen su propio filtro. */}
                {ownedInExpansion === exp.cardNumbers.length ? (
                  <span className="count complete" title={`${ownedInExpansion} de ${exp.cardNumbers.length}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    Completa
                  </span>
                ) : (
                  <span className="count">{ownedInExpansion} de {exp.cardNumbers.length}</span>
                )}
                {/* La dona de avance de la ficha: el mismo truco que el DonutChart del
                    panel (r = 15.9155 da circunferencia 100, así el dasharray es el
                    porcentaje directo). Decorativa: el «3 de 129» de al lado ya lo dice.
                    El arco va en currentColor, que textColorOn ya eligió por contraste. */}
                {exp.imagen && (
                  <svg className="band-donut" viewBox="0 0 36 36" aria-hidden="true">
                    <circle className="rail" cx="18" cy="18" r="15.9155" />
                    {/* Con cero no se monta: un dasharray de 0 con punta redonda pinta
                        un puntito igual, y una expansión sin empezar no tiene arco. */}
                    {/* El patrón tiene que sumar 100 justo (la circunferencia), o no
                        cierra la vuelta y el anillo queda con un hueco corrido. */}
                    {ownedInExpansion > 0 && (
                      <circle
                        className="arc"
                        cx="18"
                        cy="18"
                        r="15.9155"
                        strokeDasharray={`${donutPct} ${100 - donutPct}`}
                        strokeDashoffset="25"
                      />
                    )}
                    <text x="18" y="18" textAnchor="middle" dominantBaseline="central">
                      {donutLabel}
                    </text>
                  </svg>
                )}
              </div>
              {(!isCollapsed || closingId === exp.id) && (
              /* El envoltorio .unfold anima la apertura (0fr → 1fr) SÓLO cuando la
                 abrió un toque —al montar la página no anima nadie— y el cierre al
                 revés: plegada pero con closingId, la grilla sigue montada con
                 .closing hasta que el animationend la desmonta. Si el catálogo trae
                 `detalle` para esta expansión, sus casilleros dejan de ser cuadraditos
                 de 54 px y pasan a fichas anchas: adentro entran el personaje y la
                 tirada. Lo decide el DATO, no una lista de expansiones especiales
                 escrita en el código. */
              <div
                className={`unfold${justOpened === exp.id && !isCollapsed ? ' opening' : ''}${isCollapsed ? ' closing' : ''}`}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget && isCollapsed) setClosingId(null)
                }}
              >
              <div className="unfold-inner">
              <div className={`grid${exp.detalle ? ' detailed' : ''}`}>
                {visibleNumbers.flatMap((n) =>
                  slotsOf(exp, n, drawableByExpansion[exp.id], quantities).map(({ cardKey, variant }) => (
                    <Card
                      key={cardKey}
                      cardKey={cardKey}
                      number={n}
                      label={cardLabel(exp, n)}
                      detail={cardDetail(exp, n)}
                      variant={variant}
                      condition={conditions[cardKey]}
                      quantity={quantities[cardKey] ?? 0}
                      unsaved={failedKeys.has(cardKey)}
                      onTap={handleTap}
                      onHold={handleHold}
                    />
                  ))
                )}
              </div>
              </div>
              </div>
              )}
            </section>
          )
        })}
        </div>

        {summary.byFilter[effectiveFilter] === 0 && (
          <p className="empty">No hay ninguna carta en este listado.</p>
        )}

        {exportOpen && (
          <ExportDialog
            /* Sin los Manuales: el «ME FALTAN (N)» que se pega en un grupo es una cuenta
               de cartas, y meterles diez renglones que no lo son la infla. Si algún día
               hace falta intercambiar manuales por acá, es sacar este filtro. */
            catalog={catalog.filter(countsInTally)}
            collectionData={collectionData}
            /* Las mismas que dibuja la grilla, no sólo las declaradas: una variante que
               tenés cargada con un id que el catálogo dejó de declarar sigue siendo una
               carta que tenés, y el texto no puede pedirla. */
            variantsByExpansion={drawableByExpansion}
            /* Leyenda no usa condición: ahí «las que ya tengo» no pregunta en qué estado,
               porque habría una sola respuesta posible. */
            usesCondition={album?.condicion !== false}
            /* Sólo las colecciones que NO son la de siempre se anuncian. Cromeros sigue
               exportando exactamente el mismo texto que antes. */
            heading={shownCollectionId === DEFAULT_COLLECTION ? null : (album?.coleccion ?? null)}
            onClose={() => setExportOpen(false)}
          />
        )}

        {variantPrompt && (
          <AskVariant
            label={cardLabel(variantPrompt.exp, variantPrompt.n)}
            variants={variantsFor(variantPrompt.exp, variantPrompt.n)}
            counts={Object.fromEntries([
              ...variantsFor(variantPrompt.exp, variantPrompt.n).map((v) => [
                v.id,
                quantities[slotKey(variantPrompt.exp.id, variantPrompt.n, v.id)] ?? 0,
              ]),
            ])}
            onPick={pickVariant}
            onClose={() => setVariantPrompt(null)}
          />
        )}

        {orphansDialogOpen && orphans.length > 0 && (
          <OrphansDialog
            keys={orphans}
            catalogs={catalogs}
            onConfirm={removeOrphans}
            onClose={() => setOrphansDialogOpen(false)}
          />
        )}

        {celebration && (
          <Celebration
            title={celebration.album ? '¡Completaste el álbum!' : '¡Completaste una expansión!'}
            detail={celebration.album
              ? `Ya tenés las ${(summary?.total ?? 0).toLocaleString('es-AR')} cartas de ${availableCollections.find((c) => c.id === shownCollectionId)?.name ?? 'este álbum'}.`
              : `Ya tenés las ${celebration.expansion.cardNumbers.length} cartas de ${celebration.expansion.nombre}.`}
            onClose={() => setCelebration(null)}
          />
        )}

        {pendingRestore && (
          <RestoreDialog
            currentQuantities={quantities}
            backupQuantities={pendingRestore.cantidades}
            onConfirm={confirmRestore}
            onClose={() => setPendingRestore(null)}
          />
        )}

        {dashboardOpen && account.admin && (
          /* El respaldo dice algo: el chunk son 2 KB y con la red lenta el click puede
             quedarse sin respuesta un segundo. Un botón que no hace nada se vuelve a
             apretar. */
          /* El límite va ADENTRO del `{dashboardOpen && ...}` y alrededor del `Suspense`:
             así un panel que no baja se queda en su diálogo y no se lleva puesta la
             colección. `onReset` cierra el panel, que es volver a donde se estaba. */
          /* LA CÁSCARA TAMBIÉN TIENE QUE SABER QUÉ VISTA ES, y eso lo encontró la
             revisión: el fallback y el límite de error son de antes de que hubiera dos,
             así que decían «Los números» y cerraban el panel entero estuvieras donde
             estuvieras. Con `#panel/users` y el chunk todavía viajando —un F5, o la
             pestaña vieja de antes de un deploy— el título mentía y el primer «Volver»
             no cambiaba NADA en pantalla: te mandaba a los números, que mientras el
             chunk no llega se dibujan igual que la lista. Eso es el botón Atrás preso,
             que es justo lo que el hash existe para evitar. */
          <ErrorBoundary message="No se pudo abrir el panel."
                        onReset={panelView === 'users' ? backToPanelNumbers : closeDashboard}>
          {/* El fallback tiene que tener la MISMA forma que el panel — página, no diálogo —
              o al llegar el chunk la pantalla salta de una caja centrada a una página
              completa. Y dice «Buscando…», que es lo mismo que muestra el panel mientras
              esperan los datos, así que al montar no cambia el texto. */}
          <Suspense fallback={
            <div className="panel-page">
              <header className="panel-head">
                <button className="back" onClick={panelView === 'users' ? backToPanelNumbers : closeDashboard}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Volver
                </button>
                <h1>{panelView === 'users' ? 'Usuarios' : 'Los números'}</h1>
              </header>
              <div className="panel-body stats"><p className="nothing">Buscando…</p></div>
            </div>
          }>
            <Dashboard onClose={closeDashboard} onSessionExpired={handleSessionExpired}
                          collections={dashboardCollections}
                          view={panelView} onOpenView={openPanelView} onBackToNumbers={backToPanelNumbers} />
          </Suspense>
          </ErrorBoundary>
        )}

        {conditionPrompt && (
          <AskCondition
            label={conditionPrompt.label}
            onPick={pickCondition}
            onClose={() => setConditionPrompt(null)}
          />
        )}

        {addByNumberOpen && (
          <AddByNumber
            run={numberRun}
            example={suffixExample}
            onSubmit={addByNumber}
            onClose={() => setAddByNumberOpen(false)}
          />
        )}
      </main>

      {/* Una franja al final, no una línea suelta sobre el papel. Arriba la cuenta y
          Salir, que es la acción de la cuenta; abajo, más callado, lo que se hace con
          la colección, que se usa poco. */}
      <footer className="footer">
        <div className="column">
          <div className="footer-account">
            {/* El role va en un envoltorio que está siempre: si el que apareciera y
                desapareciera fuera el propio role, el lector de pantalla no anunciaría
                nada. Así lo que cambia es el texto de adentro, que sí se lee. */}
            {/* "Fijate la conexión" sólo mientras NO hay conexión. Con la red de vuelta
                el dato seguía siendo cierto —los cambios siguen perdidos— pero como
                instrucción mandaba a mirar donde ya no estaba el problema. */}
            <span className="footer-status" role="status">
              {failedKeys.size ? (
                <span className="notice">
                  {failedKeys.size === 1
                    ? 'No se pudo guardar un cambio.'
                    : `No se pudieron guardar ${failedKeys.size} cambios.`}
                  {' '}
                  {/* CUÁLES, no sólo cuántos. Con diez falladas entre 1936 cartas, la
                      única forma de encontrarlas era acordarse de cuáles tocaste. Ahora
                      se nombran acá y además quedan marcadas en la grilla. */}
                  <b className="which">{failedDescription}</b>
                  {!isOnline && ' Fijate la conexión: se reintentan solos cuando vuelva.'}
                </span>
              ) : (
                <span className="saving">Guardando en tu cuenta, <b>{account.username}</b>, a cada cambio</span>
              )}
            </span>
            <span className="footer-actions">
              <button onClick={() => setPasswordDialogOpen(true)} className="link">Cambiar mi clave</button>
              <button onClick={handleLogout} className="logout" disabled={loggingOut}>
                {loggingOut ? 'Saliendo…' : 'Salir'}
              </button>
            </span>
          </div>
          {/* `aria-live` acá y no un `role="status"` en cada aviso, por lo mismo que la
              nota del diálogo: una región viva tiene que estar puesta ANTES de que
              aparezca lo que hay que leer, y esos dos spans nacían con su texto. Va en el
              contenedor —que siempre está— y no en un envoltorio nuevo, porque esto es un
              flex con `gap: 20px` y un hijo vacío permanente deja un hueco visible.
              Adentro no cambia ninguna otra cosa: los tres botones dicen siempre lo mismo.

              Y es el atributo y no el rol: la fila NO es un mensaje de estado, sólo puede
              contener uno. */}
          <div className="footer-backups" aria-live="polite">
            <span className="footer-label">Tu colección</span>
            <button onClick={openExport} className="link">Exportar</button>
            <button onClick={() => downloadJson(collectionData)} className="link">Bajar una copia</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) loadBackupFile(f)
              ev.target.value = ''
              }}
            />
            <button onClick={() => fileInputRef.current.click()} className="link">Restaurar una copia</button>
            {fileNotice && <span className="notice-file">{fileNotice}</span>}
            {/* Sólo aparece si de verdad hay huérfanas, que hoy es nunca. No es un botón
                más de la app: es la única forma de sacar algo que quedó sin carta a la
                que tocarle. */}
            {orphans.length > 0 && (
              <span className="notice-file">
                {orphans.length === 1
                  ? 'Tenés 1 carta que ya no está en el catálogo.'
                  : `Tenés ${orphans.length} cartas que ya no están en el catálogo.`}{' '}
                <button onClick={() => setOrphansDialogOpen(true)} className="link">Sacarlas</button>
              </span>
            )}
          </div>
          <div className="footer-mark">
            <span className="footer-site">{SITE_URL}</span>
            {/* Lo único que dice dónde está Angel: hasta el 2026-10-05 no había forma de
                escribirle desde adentro. Por WhatsApp y con la cuenta en el mensaje. */}
            <span className="footer-contact">
              ¿Algo no anda o tenés una sugerencia?{' '}
              <a className="link" href={whatsappTo(suggestionText(account?.username))}
                 target="_blank" rel="noopener noreferrer">Escribime</a>
            </span>
            <span className="footer-support">
              ¿Te sirve? Podés apoyar al que la hizo · alias{' '}
              <button onClick={copyAlias} className="alias" title="Tocá para copiarlo">
                {aliasNotice ?? ALIAS}
                {/* Que se copia de un toque lo decía sólo el `title`, que ve quien pasa el
                    mouse: en el teléfono, nadie. El ícono lo dice a la vista. */}
                <svg className="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                     strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </span>
          </div>
        </div>
      </footer>

      {passwordDialogOpen && !account?.mustChange && (
        <ChangePasswordDialog onClose={() => setPasswordDialogOpen(false)} onSessionExpired={handleSessionExpired} />
      )}
      {profileOpen && !account?.mustChange && (
        <Suspense fallback={
          <ProfileShell onClose={() => setProfileOpen(false)}>
            <p className="dialog-note" role="status">Cargando…</p>
          </ProfileShell>
        }>
          <ProfileDialog onClose={() => setProfileOpen(false)} onSessionExpired={handleSessionExpired} />
        </Suspense>
      )}
      {/* LA CLAVE PROVISORIA: obligatorio y sin salida hasta elegir una propia. Al
          terminar, apaga la marca en la cuenta local — la del servidor ya la apagó
          `/api/clave`. Fuera de `isDialogOpen` a propósito: Atrás no lo cierra. */}
      {account?.mustChange && (
        <ChangePasswordDialog forced onSessionExpired={handleSessionExpired}
                      onClose={() => setAccount((c) => (c ? { ...c, mustChange: false } : c))} />
      )}

      {/* Fuera del pie: es una barra fija abajo, y sólo aparece en teléfono. */}
      {/* Los dos usan la misma barra y NO se pisan: `InstallPrompt` se va apenas `isStandalone()` es
          verdadero y `Reinstall` no aparece si no lo es. Son excluyentes por construcción,
          no por orden — si alguna vez se toca una de las dos condiciones, mirar la otra,
          porque las dos escriben `--install-height` en el body. */}
      <InstallPrompt />
      <Reinstall />
    </>
  )
}
