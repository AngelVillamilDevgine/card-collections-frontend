import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ESTADOS, etiqueta, claseDe } from './estados'
import { atraparFoco, usarEscape, usarAtras } from './foco'
import Entrar from './Entrar'
import Exportar from './Exportar'
/* El panel del administrador se baja aparte y recién cuando se abre.

   Lo ven 1 de 40 cuentas, y estaba en el chunk principal: las otras 39 se bajaban el
   componente y sus 26 reglas de CSS en cada visita para no abrirlos nunca. Hoy son 1,1 KB
   comprimidos de los 59 del bundle — poco, y no es por eso que se hace. Es porque el
   panel va a crecer, y con el corte puesto puede crecer sin que nadie tenga que discutir
   cuántos kilobytes le cuesta al que sólo marca cartas. */
const Estadisticas = lazy(() => import('./Estadisticas'))
import Instalar from './Instalar'
import Reinstall from './Reinstall'
import { pathFor, syncPath } from './routes'
import { whatIsStale, staleText } from './health'
import { ErrorBoundary } from './boundary'
import { COLLECTIONS, DEFAULT_COLLECTION, readCollection, rememberCollection, loadCatalogs, slotKey, slotsOf, variantsFor, drawableVariants, pointsToASlot, cardLabel, cardDetail, albumPercent, slotOf, slotName, orphanName } from './collections'
import {
  ErrorApi,
  descargar, restaurar, quienSoy, salir,
  leerColeccion, guardarCarta, reemplazarColeccion,
  cambiarClave, token, CLAVE_TOKEN, getProfile, saveProfile,
} from './almacenamiento'

/* Los tres listados que un coleccionista realmente necesita: qué buscar,
   qué puede cambiar y qué le conviene reemplazar. */
/* `corto` es el rótulo para la barra de abajo del teléfono, donde cada lugar mide unos
   82 px y «Para reemplazar» no entra. Los dos textos se dibujan siempre y el CSS muestra
   el que corresponde: así el layout lo decide una media query y no un `if` sobre el
   ancho, que parpadearía al cargar y habría que volver a calcular al rotar. */
export const FILTROS = [
  { id: 'todas',      label: 'Todas',           corto: 'Colección',  pasa: () => true },
  { id: 'falta',      label: 'Me faltan',       corto: 'Faltan',     pasa: (cant) => cant === 0 },
  { id: 'repetidas',  label: 'Repetidas',       corto: 'Repetidas',  pasa: (cant) => cant > 1 },
  { id: 'reemplazar', label: 'Para reemplazar', corto: 'Reemplazar', pasa: (cant, est) => cant > 0 && est === 'reemplazar' },
]

/* Los íconos de esa barra. Trazo de 2, sin relleno y con `currentColor`, igual que los
   tres que ya había (exportar, plegar, completa): así heredan solos el color del filtro
   elegido y no hace falta ninguna regla aparte. Son líneas, no emojis — un emoji se ve
   distinto en cada teléfono y encima es justo lo que hacía que la primera versión de la
   app gritara «hecho con IA».

   En un teléfono el ícono no es decoración: con cinco lugares de 82 px, es lo que se
   reconoce de un vistazo antes de leer. */
const ICONOS = {
  // Cuatro cartas: la colección entera.
  todas: <><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.5" /></>,
  // Un hueco: el lugar vacío del álbum.
  falta: <rect x="4.5" y="3.5" width="15" height="17" rx="2" strokeDasharray="3.2 3" />,
  // Una carta encima de otra.
  repetidas: <><rect x="8.5" y="3.5" width="12" height="14" rx="2" /><path d="M15.5 20.5H5.5a2 2 0 0 1-2-2v-11" /></>,
  // Dos flechas que se cruzan: cambiarla por otra.
  reemplazar: <><path d="M3.5 8.5h13l-3.5-3.5" /><path d="M20.5 15.5h-13l3.5 3.5" /></>,
}

const CLARO = '#ffffff'
const OSCURO = '#1f1c19'

/* Luminancia relativa (WCAG). */
function luz(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a, b) {
  const [alta, baja] = [luz(a), luz(b)].sort((x, y) => y - x)
  return (alta + 0.05) / (baja + 0.05)
}

/* Se elige el que mida más contraste, no el que caiga de un lado de un umbral:
   con umbral fijo, el naranja de Expansión 1 quedaba con texto blanco a 2.47. */
function textoSobre(fondo) {
  return contraste(fondo, CLARO) >= contraste(fondo, OSCURO) ? CLARO : OSCURO
}

/* ---------------------------------- carta --------------------------------- */

const MANTENIDO = 420 // ms a partir de los cuales deja de ser un toque

/* Píxeles de movimiento a partir de los cuales el gesto deja de ser un mantenido y pasa
   a ser el arranque de un scroll. Diez es poco a propósito: el dedo tiembla, pero si se
   desplaza ya no está "apretando ahí". */
const DESLIZ = 10

/* memo: sin esto, cada toque volvía a renderizar las 1936 cartas — 10 ms en la compu y
   125 ms en un teléfono de gama baja, cuando lo que el DOM necesita de verdad son tres
   mutaciones sobre un solo elemento.

   Para que el memo sirva, `onTocar` y `onMantener` tienen que ser los mismos objetos en
   cada render. Por eso la carta les pasa su clave al llamarlos, en vez de recibir dos
   flechas que ya la tengan adentro: una flecha nueva por carta es una prop nueva por
   carta, y el memo no ahorraría nada. */
const Carta = memo(function Carta({ clave, numero, nombre, detalle, variante, estado, cantidad, sinGuardar, onTocar, onMantener }) {
  const reloj = useRef(null)
  const fueLargo = useRef(false)  // ya pasaron los 420 ms: el click que venga no cuenta
  const cobrable = useRef(false)  // ...y además todavía se puede cobrar al soltar
  const origen = useRef(null)
  /* EL AVISO VISUAL SE ADELANTA AL COBRO, y es todo lo que este estado hace.
     Lo reportó Angel: «uno se queda apretando una casilla esperando que se descuente un
     número de repetida y nunca pasa, pasa recién cuando uno suelta». Tenía razón y el gesto
     igual no se puede mover — cobrar al soltar es lo que impide que un scroll reste una
     carta, y eso está medido—. Lo que faltaba era decirlo: a los 420 ms la carta muestra
     CÓMO VA A QUEDAR, y si el gesto se cancela se deshace sin haber tocado nada. */
  const [restando, setRestando] = useState(false)

  function apretar(e) {
    fueLargo.current = false
    cobrable.current = false
    origen.current = { x: e.clientX, y: e.clientY }
    reloj.current = setTimeout(() => {
      fueLargo.current = true
      cobrable.current = true
      /* Sólo si hay algo que restar. Con cantidad 0 el mantenido no hace nada —la guarda
         está en `restar`— así que anunciar una resta que no va a pasar es peor que no
         anunciar nada. */
      if (cantidad > 0) setRestando(true)
    }, MANTENIDO)
  }

  /* Si el dedo se corre, no era un mantenido: era el arranque de un scroll. */
  function mover(e) {
    if (!origen.current) return
    const corrido = Math.abs(e.clientX - origen.current.x) + Math.abs(e.clientY - origen.current.y)
    if (corrido > DESLIZ) cancelar()
  }

  /* El mantenido se cobra al SOLTAR, no al cumplirse los 420 ms.

     Medido con toques reales: apoyar el dedo sobre la grilla mientras mirás el álbum y
     después arrastrar para seguir bajando restaba una carta —de 7 a 6— y se guardaba.
     El navegador avisa que se quedó con el gesto (`pointercancel`) recién DESPUÉS del
     disparo, así que cancelar por movimiento llega tarde: a los 420 ms ya estaba hecho.

     Cobrando al soltar, un scroll no resta nunca, porque termina en `pointercancel` y
     no en `pointerup`. El gesto sigue siendo el mismo para quien lo hace a propósito. */
  function soltar() {
    clearTimeout(reloj.current)
    origen.current = null
    setRestando(false)
    if (!cobrable.current) return
    cobrable.current = false
    onMantener(clave)
  }

  /* El gesto se fue a otro lado: ni resta ni cuenta como toque. Y el aviso se deshace, que
     es justamente lo que lo hace honesto: si al final no se cobra, no se vio una mentira
     sino lo que HABRÍA pasado. */
  function cancelar() {
    clearTimeout(reloj.current)
    origen.current = null
    cobrable.current = false
    setRestando(false)
  }

  useEffect(() => () => clearTimeout(reloj.current), [])

  /* Con el teclado, Enter y Espacio suman. Para restar no había ningún camino — el
     único era mantener apretado con el dedo o el mouse —, y como cambiar el estado
     exige bajar hasta cero, quien se equivocaba de estado quedaba encerrado. */
  function alTeclado(e) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return
    // Con Ctrl, Alt o Meta son atajos del sistema —borrar palabra, volver atrás—, y no
    // tienen que sacar una carta.
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    const grilla = e.currentTarget.parentElement
    onMantener(clave) // si está en cero, `restar` no hace nada

    /* Si la carta sale del filtro puesto —restar la última repetida con «Repetidas»
       elegido— el botón se desmonta y el foco cae en `body`, así que el Backspace
       siguiente no hace nada y parece que la app se colgó. Se mueve el foco a la carta
       que ocupó su lugar, o a la barra de filtros si la grilla entera desapareció.

       setTimeout y no rAF: tiene que correr DESPUÉS de que React aplique el cambio. */
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const vecina = grilla?.isConnected && grilla.querySelector('.carta')
      if (vecina) vecina.focus()
      else document.querySelector('.filtro.activo')?.focus()
    }, 0)
  }

  /* Lo que se DIBUJA mientras el mantenido está armado: cómo va a quedar la carta si soltás
     ahora. Bajar de 1 a 0 se lleva también la condición, igual que hace `restar`, así que la
     carta entera cambia de color — que es exactamente la respuesta que se estaba esperando.

     El `aria-label` NO usa estos valores, y es a propósito: la etiqueta dice lo que la carta
     ES, no lo que va a ser. Esto es un aviso visual de un gesto en curso, y un `aria-label`
     que se mueve y vuelve durante un mantenido sólo confunde a quien lo lee al enfocar. */
  const cantidadVista = restando ? cantidad - 1 : cantidad
  const estadoVista = restando && cantidad === 1 ? null : estado

  const titulo = cantidad
    ? `${etiqueta(estado, cantidad)} · tenés ${cantidad}`
    : 'Me falta'
  /* El nombre de la variante va en la etiqueta hablada y el rótulo corto en la esquina.
     Con lector de pantalla, «Carta 551» dos veces seguidas no distingue nada.

     Y el número va con el prefijo de su expansión (`nombre`), no pelado: mirando la
     pantalla la banda de arriba dice de qué expansión es, pero hablado no hay banda, y
     en Leyenda hay 19 huecos donde el mismo número es dos cartas distintas. En la CARA de
     la carta sigue yendo pelado: ahí la banda está a la vista y «Leyenda 1» no entra. */
  /* Y si el catálogo sabe cómo se llama esa carta, se dice: en las «Cartas únicas» el
     número es una etiqueta nuestra —esas nueve no llevan número impreso— y lo que la
     identifica de verdad es el personaje. */
  /* La tirada va también en la etiqueta hablada, no sólo pintada: es la mitad del dato
     —lo que separa a Shenron de las otras ocho— y sin esto quien usa lector de pantalla
     oye el personaje y no se entera de que una es de 500. */
  const quien = detalle
    ? `${nombre}, ${detalle.nombre}${detalle.copias > 0 ? `, ${detalle.copias} copias` : ''}`
    : nombre
  const comoSeLlama = variante ? `Carta ${quien}, ${variante.nombre}` : `Carta ${quien}`

  /* Sin `title`: decía lo mismo que el aria-label, y varios lectores de pantalla leen la
     etiqueta y después la descripción, o sea «Carta 5. Me falta. Me falta» — 1936 veces.
     Lo que el title aportaba a la vista ya está pintado en la carta: el color es el
     estado y el número chico de la esquina es la cantidad. */
  return (
    <button
      className={`carta ${claseDe(estadoVista, cantidadVista)}${sinGuardar ? ' sin-guardar' : ''}${variante ? ' variante' : ''}${restando ? ' restando' : ''}`}
      aria-label={`${comoSeLlama}. ${titulo}${sinGuardar ? '. Sin guardar' : ''}`}
      /* La forma estándar de anunciar un atajo de teclado. Restar con Backspace no
         estaba dicho en ningún lado: ni en la ayuda, ni en la etiqueta. Para quien usa
         el teclado, el camino era invisible. */
      aria-keyshortcuts="Backspace" 
      onPointerDown={apretar}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerLeave={cancelar}
      onPointerCancel={cancelar}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={alTeclado}
      onClick={() => { if (!fueLargo.current) onTocar(clave, numero) }}
    >
      {/* Con detalle la carta muestra tres cosas y no una: el rótulo chico arriba —que
          acá es «Leyenda 3» y no un número pelado—, el personaje, que es lo que de verdad
          la identifica, y la tirada, que es lo que separa a Shenron (500) de las otras
          ocho (1500). Sin detalle no cambia nada: el número solo, como siempre. */}
      {detalle ? (
        <>
          <span className="rotulo-detalle">{nombre}</span>
          <span className="nombre-detalle">{detalle.nombre}</span>
          {detalle.copias > 0 && <span className="copias-detalle">{detalle.copias.toLocaleString('es-AR')} copias</span>}
        </>
      ) : numero}
      {variante && <b className="marca-variante">{variante.corto ?? variante.id.toUpperCase()}</b>}
      {cantidadVista > 1 && <b className="repes">{cantidadVista}</b>}
    </button>
  )
})

/* -------------------------------- diálogo --------------------------------- */

function Pregunta({ nombre, onElegir, onCerrar }) {
  const caja = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)

  /* Una sola vez, al abrir. Si dependiera de `onCerrar` —que es una flecha nueva en
     cada render— volvería a capturar el "foco de antes" en cada vuelta, y al cerrar lo
     devolvería a un botón de este mismo diálogo, que para entonces ya no existe. */
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={`Carta ${nombre}`} ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {nombre}</h3>
        <p>¿En qué estado está?</p>
        {ESTADOS.map((e) => (
          <button key={e.id} className={`opcion ${e.id}`} onClick={() => onElegir(e.id)} autoFocus={e.id === 'bien'}>
            {e.label}
          </button>
        ))}
        <button className="cancelar" onClick={onCerrar}>Cancelar</button>
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
function AskVariant({ nombre, variantes, cuentas, onElegir, onCerrar }) {
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  const fila = (id, nombre, autoFoco) => (
    <button key={id ?? 'base'} className="opcion simple" onClick={() => onElegir(id)} autoFocus={autoFoco}>
      {nombre}
      {(cuentas[id ?? ''] ?? 0) > 0 && <b>{cuentas[id ?? '']}</b>}
    </button>
  )

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={`Carta ${nombre}`}
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {nombre}</h3>
        <p>¿Cuál tenés?</p>
        {variantes.map((v, i) => fila(v.id, v.nombre, i === 0))}
        <p className="salidas">
          <button className="cancelar" onClick={onCerrar}>Cancelar</button>
        </p>
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
function OrphansDialog({ keys, catalogos, onConfirmar, onCerrar }) {
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  /* El `corto` de la expansión y no el número pelado: con dos colecciones, «551» no dice
     de cuál álbum es, y el diálogo existe justamente para que se vea de un vistazo que el
     problema es el catálogo y no la colección.

     Va por `orphanName` y no partiendo la clave por los dos puntos: con un sufijo de
     variante, `ley-6-dor:99999` no encontraba rótulo —la tabla sólo tenía ids de
     expansión— y se imprimía la clave cruda. Acá eso pesa más que en el pie, porque **este
     es el diálogo que borra**: la lista es con lo que se decide. */
  const numeros = keys.map((c) => orphanName(c, catalogos))
  const MUESTRA = 24
  const lista = numeros.slice(0, MUESTRA).join(', ')

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label="Sacar las que no están en el catálogo"
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Sacar {keys.length} carta{keys.length === 1 ? '' : 's'}</h3>
        <p>
          Estas cartas están marcadas en tu colección pero no están en el catálogo:
          <br />
          <b>{lista}</b>{numeros.length > MUESTRA && <> y {numeros.length - MUESTRA} más</>}.
        </p>
        <p className="ojo">
          Si son muchas y seguidas, capaz que lo que está mal es el catálogo y no tu
          colección. Antes se baja sola una copia de lo que tenés ahora, por las dudas.
        </p>
        <button className="opcion reemplazar" onClick={onConfirmar} autoFocus>
          Sacarlas igual
        </button>
        <p className="salidas">
          <button className="cancelar" onClick={onCerrar}>Cancelar</button>
        </p>
      </div>
    </div>
  )
}

function Reemplazar({ mias, copia, onConfirmar, onCerrar }) {
  /* Se cuentan CARTAS y no claves, igual que `revisarReemplazo` del servidor: una clave
     con cantidad 0 no es una carta, y una copia armada a mano puede traerlas. */
  const conCarta = (m) => Object.keys(m).filter((c) => Number(m[c]) > 0)
  const claves = conCarta(mias)
  const traidas = new Set(conCarta(copia))
  const tengo = claves.length
  const trae = traidas.size
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)

  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  /* CUÁNTAS DE LAS TUYAS NO ESTÁN EN LA COPIA, que no es lo mismo que restar totales.
     Con `tengo - trae`, un respaldo viejo de 600 cartas que sólo comparte 480 con tus 546
     daba -54: la frase no se dibujaba y el diálogo se leía como que ganabas, cuando en
     realidad perdías 66. Justo el caso típico de restaurar desde otro aparato. */
  const pierde = claves.filter((c) => !traidas.has(c)).length

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label="Restaurar una copia"
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Restaurar una copia</h3>
        <p>
          Ahora tenés <b>{tengo}</b> carta{tengo === 1 ? '' : 's'} marcada{tengo === 1 ? '' : 's'}.
          Esta copia trae <b>{trae}</b>.
        </p>
        <p className="ojo">
          Se reemplaza <b>toda</b> tu colección por la del archivo.
          {pierde > 0 && <> Vas a perder <b>{pierde}</b>.</>}{' '}
          Antes se baja sola una copia de lo que tenés ahora, por las dudas.
        </p>
        <button className="opcion reemplazar" onClick={onConfirmar} autoFocus>
          Reemplazar por la copia
        </button>
        <button className="cancelar" onClick={onCerrar}>Cancelar, dejar todo como está</button>
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
/* «MI PERFIL». Lo pidió Angel el 2026-09-30: con sólo un mail no hay forma de saber quién
   es quién ni de contactar a nadie. NADA ES OBLIGATORIO — un campo vacío es «no lo
   cargué» —, y la nota dice quién ve estos datos, porque pedir un WhatsApp sin decir para
   qué es la forma más rápida de que nadie lo complete.

   Es el mismo diálogo y el mismo formulario que «Cambiar mi clave» (`.dialogo`,
   `.entrar`), con los `autoComplete` estándar para que el teléfono ofrezca los datos que
   ya sabe. El PUT manda los cinco campos y el servidor contesta con cómo quedaron: lo que
   se muestra después de guardar es lo guardado, no lo tipeado. */
const PROFILE_FIELDS = [
  ['firstName', 'Nombre', 'given-name'],
  ['middleName', 'Segundo nombre', 'additional-name'],
  ['lastName', 'Apellido', 'family-name'],
  ['whatsapp', 'WhatsApp', 'tel'],
  ['city', 'Ciudad', 'address-level2'],
]

function ProfileDialog({ onClose, onSesionMuerta }) {
  const [form, setForm] = useState(null) // null mientras llega
  const [account, setAccount] = useState('')
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)

  usarEscape(onClose)
  useEffect(() => atraparFoco(box.current, prevFocus.current), [])
  useEffect(() => {
    getProfile()
      .then(({ usuario, ...fields }) => { setAccount(usuario); setForm(fields) })
      .catch((e) => (e?.sesion ? onSesionMuerta() : setError(e.message)))
  }, [])

  async function submit(ev) {
    ev.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const { usuario, ...fields } = await saveProfile(form)
      setForm(fields)
      setSaved(true)
    } catch (e) {
      if (e?.sesion) return onSesionMuerta()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const change = (key) => (ev) => {
    setForm((f) => ({ ...f, [key]: ev.target.value }))
    setSaved(false)
  }

  return (
    <div className="telon" onClick={onClose}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label="Mi perfil"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Mi perfil</h3>
        {/* Región viva SIEMPRE en el DOM, con el texto cambiando adentro — la regla de
            este proyecto para que el «Guardado» se anuncie. */}
        <p className="nota-dialogo" role="status">
          {form === null && !error
            ? 'Cargando…'
            : saved
              ? 'Guardado.'
              : 'Nada es obligatorio. Lo que completes lo ve sólo el administrador de la app, para poder contactarte.'}
        </p>
        {account && <p className="profile-account">Tu cuenta: <b>{account}</b></p>}
        <form className="entrar" onSubmit={submit}>
          {PROFILE_FIELDS.map(([key, label, autoComplete]) => (
            <label key={key}>
              {label}
              <input
                type={key === 'whatsapp' ? 'tel' : 'text'}
                inputMode={key === 'whatsapp' ? 'tel' : undefined}
                value={form?.[key] ?? ''}
                onChange={change(key)}
                autoComplete={autoComplete}
                disabled={form === null}
                maxLength={key === 'whatsapp' ? 30 : key === 'city' ? 80 : 60}
              />
            </label>
          ))}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="principal" disabled={saving || form === null}>
            {saving ? 'Un segundo…' : 'Guardar'}
          </button>
          <button type="button" className="secundario" onClick={onClose}>Cerrar</button>
        </form>
      </div>
    </div>
  )
}

const queSeCerro = (n) =>
  n === 0 ? 'No había ninguna otra sesión abierta.'
    : n === 1 ? 'Se cerró la sesión que había en otro aparato.'
      : `Se cerraron las ${n} sesiones que había en otros aparatos.`

/* `forced`: entró con una clave provisoria (`bin/reset-password.js` del backend) y no
   puede seguir hasta elegir la suya. Es el mismo diálogo —la ruta es la misma y ya cierra
   las otras sesiones— pero sin salida: ni «Mejor no», ni Escape, ni el telón, y tampoco
   Atrás (no entra en `hayDialogo`). La marca vive en el SERVIDOR y viaja en /api/yo, así
   que recargar o cerrar la app lo vuelve a traer acá. */
function CambiarClave({ onCerrar, onSesionMuerta, forced = false }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState(null)
  const [listo, setListo] = useState(null)
  const [yendo, setYendo] = useState(false)
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)
  /* Obligatorio: antes de elegir la clave no hay forma de cerrar. Después sí — el
     «Listo» es lo que le avisa a la app que ya está. */
  const closable = !forced || listo !== null

  usarEscape(() => { if (closable) onCerrar() })
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  async function enviar(ev) {
    ev.preventDefault()
    setError(null)
    setYendo(true)
    try {
      const { echadas } = await cambiarClave(actual, nueva)
      setListo(echadas)
    } catch (e) {
      if (e?.sesion) return onSesionMuerta()
      setError(e.message)
    } finally {
      setYendo(false)
    }
  }

  return (
    <div className="telon" onClick={() => { if (closable) onCerrar() }}>
      <div className="dialogo" role="dialog" aria-modal="true"
           aria-label={forced ? 'Elegí una clave nueva' : 'Cambiar mi clave'}
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>{forced ? 'Elegí una clave nueva' : 'Cambiar mi clave'}</h3>
        {/* UNA SOLA nota, siempre en el DOM, y lo que cambia es el texto de adentro. Es el
            mismo patrón que el pie, y por el mismo motivo: un `role="status"` que NACE con
            su texto no se anuncia. Una región viva se anuncia cuando CAMBIA, y para eso
            tiene que estar puesta de antes; un nodo que aparece ya escrito muchas veces no
            se lee. Acá eso importaba: el aviso de que la clave cambió y cuántas sesiones se
            cerraron —el resultado de una acción de seguridad— aparecía junto con el botón
            «Listo», que es lo único que se llevaba el foco y lo único que se leía. */}
        <p className="nota-dialogo" role="status">
          {listo === null
            ? forced
              ? 'Entraste con una clave provisoria. Elegí la tuya para seguir; tus cartas están todas.'
              : 'Al cambiarla se cierran las sesiones abiertas en otros aparatos. En éste seguís adentro.'
            : `Listo, ya es la nueva. ${queSeCerro(listo)}`}
        </p>
        {listo === null ? (
          <form className="entrar" onSubmit={enviar}>
            <label>
              {forced ? 'La clave provisoria que te pasaron' : 'Tu clave de ahora'}
              <input type="password" value={actual} onChange={(e) => setActual(e.target.value)}
                     autoComplete="current-password" autoFocus required />
            </label>
            <label>
              La nueva
              <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)}
                     autoComplete="new-password" required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="principal" disabled={yendo}>
              {yendo ? 'Un segundo…' : forced ? 'Guardar mi clave' : 'Cambiarla'}
            </button>
            {!forced && <button type="button" className="secundario" onClick={onCerrar}>Mejor no</button>}
          </form>
        ) : (
          <button className="principal" onClick={onCerrar} autoFocus>Listo</button>
        )}
      </div>
    </div>
  )
}

const VACIA = { estados: {}, cantidades: {} }

/* Para el pie: de dónde es la app y cómo apoyar al que la hizo. */
const SITIO = 'www.cromeros.com.ar'
const ALIAS = 'angel.villamil'

/* Cuántas veces se reintenta un guardado que falló, y cuánto se espera entre intentos
   (crece: 900 ms, 1800 ms). Dos alcanzan para tapar un bache de red sin que el usuario
   note nada; más que eso ya es que no hay internet, y ahí sí conviene avisar. */
const REINTENTOS = 2
const ESPERA_REINTENTO = 900

/* Lo máximo que Salir espera a que salga lo pendiente. Un pedido colgado no puede
   dejarte atrapado adentro de la app. */
const TECHO_SALIR = 4000
/* Cuánto espera una restauración a que aterricen los guardados que ya salieron. Más que
   el de Salir —ahí la persona se quiere ir y cada segundo pesa— porque restaurar ya son
   dos viajes y la espera se nota menos; y alcanza para un PUT normal más su primer
   reintento. Ver `confirmarReemplazo`. */
const TECHO_RESTAURAR = 8000

/* Cuánto tiene que haber pasado para que, al volver a la pestaña, se vuelva a pedir la
   colección. Cambiar de app un rato en el teléfono es lo normal; lo que hay que atrapar
   es la pestaña abierta desde ayer. */
const REFRESCO = 60 * 1000

/* Lo que tarda en mandarse una carta después del último toque. Existe por el orden:
   si tocás tres veces rápido y salen tres pedidos, pueden llegar desordenados y
   quedar guardado el 2 después del 3. Esperando, sale uno solo con el número final. */
const ESPERA = 250

/* Las expansiones que dejaste cerradas. Se guardan en el navegador y no en la cuenta:
   es cómo te gusta ver la lista en este aparato, no un dato de la colección. Por eso
   la compu y el celular se acuerdan cada uno de lo suyo. */
const CLAVE_PLEGADAS = 'dbz-cromeros-plegadas'

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
const CLAVE_EXPORTO = 'dbz-cromeros-exporto'
const DESCANSO = 15 * 24 * 60 * 60 * 1000 // dos semanas largas
const GUINOS = 3
const PRIMERO = 20000
const CADA = 70000

function leerExporto() {
  try { return Number(localStorage.getItem(CLAVE_EXPORTO) ?? 0) } catch { return 0 }
}

function leerPlegadas() {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE_PLEGADAS)) ?? []) }
  catch { return new Set() }
}

export default function App() {
  /* Todos los catálogos, por id. Un `null` adentro es «no cargó», que NO es lo mismo que
     «cargó vacío»: de esa distinción depende que el pie no ofrezca borrar 1936 cartas. */
  const [catalogos, setCatalogos] = useState(null)
  const [collection, setCollection] = useState(readCollection)
  const [error, setError] = useState(null)
  // La cuenta entera, no el nombre: trae además si es administrador.
  const [cuenta, setCuenta] = useState(undefined) // undefined = todavía no sé
  const [datos, setDatos] = useState(VACIA)

  /* LA DIRECCIÓN SIGUE AL ESTADO, y ése es todo el ruteo que hay del lado de la app.
     Quién se dibuja lo sigue decidiendo `cuenta` tres pantallas más abajo, exactamente
     igual que antes de que existieran las rutas — así que esto no puede cambiar lo que
     ves, sólo lo que dice la barra de direcciones. Al revés habría que reescribir el
     árbol de decisión, que es donde viven los tres estados de carga que ya costaron sus
     bugs. El porqué de `replaceState` y de que no haya `pushState` está en `routes.js`. */
  useEffect(() => { syncPath(pathFor(cuenta)) }, [cuenta])

  /* Hace falta aparte de `datos` porque `VACIA` es ambiguo: no distingue «todavía no
     llegó» de «este usuario no tiene ninguna carta», y las dos son un objeto vacío. */
  const [coleccionLista, setColeccionLista] = useState(false)
  const [filtro, setFiltro] = useState('todas')
  const [preguntando, setPreguntando] = useState(null)
  /* Las cartas que no se pudieron guardar, no un sí/no. Era un booleano, y entonces el
     primer guardado bueno de CUALQUIER carta lo apagaba: marcabas cuarenta sin señal,
     volvía la señal, tocabas una más, salía bien y el cartel desaparecía diciendo que
     todo se estaba guardando. Con un conjunto, el aviso se va cuando de verdad no queda
     ninguna, y de paso puede decir cuántas son. */
  const [fallidas, setFallidas] = useState(() => new Set())
  const [saliendo, setSaliendo] = useState(false)
  /* Por qué estás en la pantalla de entrada. Sin esto, la colección desaparecía de golpe
     y sin explicación cuando se vencía la sesión. */
  const [avisoSesion, setAvisoSesion] = useState(null)
  /* Un archivo de copia que no se puede leer no puede tirar abajo la app entera: ese
     aviso va al pie, al lado del botón que lo abrió. */
  const [avisoArchivo, setAvisoArchivo] = useState(null)
  /* La copia leída del archivo, esperando que la confirmes. */
  const [porRestaurar, setPorRestaurar] = useState(null)
  /* Se incrementa para volver a pedir el catálogo y la colección desde cero. */
  const [intento, setIntento] = useState(0)
  /* No se pudo ni averiguar quién sos. Es un estado aparte de `error` porque se decide
     ANTES de saber si hay cuenta, y aparte de `cuenta = null` porque no es lo mismo:
     mandar al formulario de entrada cuando el servidor está caído hace creer que se
     venció la sesión y que hay que volver a escribir la clave. */
  const [arranque, setArranque] = useState(null)
  /* `navigator.onLine` miente en un sentido —dice que sí cuando estás colgado de un wifi
     sin salida— pero nunca en el otro: si dice que no, no hay red. Alcanza para no
     mandar a mirar la conexión cuando la conexión ya volvió. */
  const [enLinea, setEnLinea] = useState(() => navigator.onLine !== false)
  const [exportando, setExportando] = useState(false)
  /* El panel vive en el hash `#panel`, y no en un booleano suelto, por una razón muy
     concreta de teléfono: ATRÁS TIENE QUE CERRARLO. Con un booleano, el primer botón que
     aprieta cualquiera para cerrar algo que ocupa la pantalla te saca de la app. De paso
     sobrevive a un F5 y se puede pasar el link.

     `#cartas` ya existía para el enlace de saltar, así que esto convive: cualquier hash
     que no sea `#panel` lo cierra. */
  const [viendoNumeros, setViendoNumeros] = useState(() =>
    typeof location !== 'undefined' && location.hash === '#panel')
  /* Si la entrada la empujamos nosotros, cerrar es `history.back()`. Si en cambio llegó
     con `#panel` en la dirección, no hay a dónde volver y un `back()` se va del sitio.

     ESO SE PREGUNTA AL HISTORIAL, NO A UN REF. Con un `useRef` se perdía al recargar:
     abrías el panel con el botón, apretabas F5 —la página vuelve con `#panel` y el panel
     abierto— y al cerrar tomaba la rama equivocada, dejando dos entradas idénticas sin
     hash. El Atrás siguiente navegaba de `.../` a `.../`: no pasaba nada en pantalla, que
     es justo lo que este diseño existe para evitar. `history.state` sobrevive al F5. */
  const loEmpujamosNosotros = () => !!(history.state && history.state.dbzPanel)
  const [guiñando, setGuiñando] = useState(false)
  /* Cuándo exportó por última vez vive en un estado y no sólo en localStorage: así,
     al usarlo, el efecto de abajo se vuelve a correr y cancela los guiños que quedaban
     programados. Guardándolo sólo en localStorage seguía guiñando después de usarlo. */
  const [ultimoExporto, setUltimoExporto] = useState(leerExporto)
  const [plegadas, setPlegadas] = useState(leerPlegadas)
  const [avisoAlias, setAvisoAlias] = useState(null)
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [sacando, setSacando] = useState(false)
  const [preguntandoVariante, setPreguntandoVariante] = useState(null)

  /* Los seis diálogos, con un solo mecanismo: en esta app no hay dos abiertos a la vez
     —el telón se come los clicks de atrás— así que alcanza con «hay alguno» y «cerrá el
     que sea». Si algún día se pueden apilar, esto pasa a ser uno por diálogo. */
  const hayDialogo =
    exportando || cambiandoClave || profileOpen || sacando ||
    !!preguntando || !!preguntandoVariante || !!porRestaurar
  const cerrarDialogo = useCallback(() => {
    setExportando(false)
    setCambiandoClave(false)
    setProfileOpen(false)
    setSacando(false)
    setPreguntando(null)
    setPreguntandoVariante(null)
    setPorRestaurar(null)
  }, [])
  usarAtras(hayDialogo, cerrarDialogo)

  /* Atrás y adelante del navegador mueven el hash, y de ahí sale si el panel está
     abierto. Un solo oyente para los dos sentidos. */
  /* Los dos eventos, y hacen falta los dos: `popstate` cubre Atrás y Adelante (incluido
     el que vuelve de una entrada puesta con `pushState`), y `hashchange` cubre el enlace
     de saltar a `#cartas`, que cierra el panel. Es idempotente, así que que disparen los
     dos no molesta. */
  useEffect(() => {
    const mirar = () => setViendoNumeros(location.hash === '#panel')
    window.addEventListener('popstate', mirar)
    window.addEventListener('hashchange', mirar)
    return () => {
      window.removeEventListener('popstate', mirar)
      window.removeEventListener('hashchange', mirar)
    }
  }, [])

  /* `pushState` y no `location.hash = ...` porque hay que dejar la marca en el estado.
     Ojo: `pushState` NO dispara `hashchange`, así que el estado se prende acá a mano. */
  const openDashboard = () => {
    history.pushState({ dbzPanel: true }, '', '#panel')
    setViendoNumeros(true)
  }
  const closeDashboard = () => {
    if (loEmpujamosNosotros()) { history.back(); return }
    history.replaceState(null, '', location.pathname + location.search)
    setViendoNumeros(false)
  }

  useEffect(() => {
    try { localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...plegadas])) }
    catch { /* modo privado o sin lugar: se pierde al recargar, nada más */ }
  }, [plegadas])
  const archivoRef = useRef(null)
  /* El reloj del aviso del alias, para poder apagarlo al desmontar y no dejar un
     setState apuntando a un componente que ya no está. */
  const relojAlias = useRef(null)
  /* Lo tocado que todavía no salió, por carta: el valor final y el reloj de la espera. */
  const pendientes = useRef(new Map())
  /* El último envío en vuelo de cada carta. El siguiente se encadena atrás de ése en vez
     de salir suelto: cuando el viaje tarda más que la espera —un celular con datos—
     quedaban dos PUT de la misma carta viajando juntos, y si llegaban al revés se
     guardaba el viejo después del nuevo. */
  const enVuelo = useRef(new Map())
  /* El último valor conocido de cada carta, esperando que le toque salir. Es lo que hace
     que cinco toques encolados no sean cinco viajes: el envío que llega a la línea de
     largada lee acá el número final, y los que venían atrás con números ya viejos se
     encuentran el casillero vacío y no salen a la red. */
  const porSalir = useRef(new Map())
  /* Cuándo se leyó la colección por última vez, para el refresco de abajo. */
  const ultimaLectura = useRef(0)

  const { estados, cantidades } = datos

  /* Las que de verdad se pueden mostrar: si un archivo no cargó, su píldora no existe. */
  const disponibles = useMemo(
    () => (catalogos ? COLLECTIONS.filter((c) => catalogos[c.id]) : []),
    [catalogos]
  )
  /* Si la guardada no cargó, se cae a la primera que sí: mejor mostrar algo que nada. */
  const coleccionViva = disponibles.some((c) => c.id === collection)
    ? collection
    : disponibles[0]?.id
  const album = coleccionViva ? catalogos[coleccionViva] : null
  const catalogo = album?.expansiones ?? null

  function pickCollection(id) {
    setCollection(id)
    rememberCollection(id)
  }

  /* Espejo de `datos` que se actualiza en el mismo instante del toque y no en el próximo
     render. `cantidades` sale del render anterior: dos toques en el mismo frame leen los
     dos el mismo número y el segundo pisa al primero — un toque perdido. Se resincroniza
     solo cuando los datos cambian por otro lado (la lectura del servidor, restaurar). */
  const vivo = useRef(datos)
  useEffect(() => { vivo.current = datos }, [datos])

  /* Sube de a uno en cada restauración. `despachar` la captura al empezar y se rinde si
     cambió: un reintento programado a 900 o 1800 ms no puede aterrizar DESPUÉS de que se
     reemplazó la colección entera y reponer una carta que la copia no traía. */
  const generacion = useRef(0)

  /* Para leer las fallidas desde un efecto que no depende de ellas. */
  const fallidasRef = useRef(fallidas)
  fallidasRef.current = fallidas
  /* Cómo se llaman esas cartas. Se asigna más abajo, cuando el catálogo ya está resuelto;
     `sesionMuerta` la lee de acá porque se declara antes. */
  const nombrarRef = useRef(null)

  useEffect(() => {
    /* Con corte, igual que todos los pedidos de `almacenamiento.js`. Era el unico
       `fetch` de la app sin techo de tiempo, y un pedido COLGADO no es lo mismo que uno
       que falla: sin corte se quedaba para siempre en la pantalla de espera, que no tiene
       ni botón de reintentar ni forma de salir. Con el corte cae en el `catch` de abajo,
       que sí lo tiene. Los 15 s son los mismos que usa `pedir`. */
    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), 15000)

    loadCatalogs(corte.signal)
      .then((todos) => {
        /* Sólo es un error si no cargó NINGUNO. Que falte Leyenda no puede dejar sin app a
           quien viene a marcar Cromeros: el selector muestra lo que haya. */
        if (!Object.values(todos).some(Boolean)) throw new Error('ninguno')
        setCatalogos(todos)
      })
      .catch(() => setError('No se pudo cargar el catálogo de cartas.'))
      .finally(() => clearTimeout(reloj))
  }, [intento])

  /* ¿El token guardado sigue sirviendo? Si no, se muestra la pantalla de entrada.

     Un 401 vuelve como `null` y va al formulario. Cualquier otra cosa —el servidor
     caído, un deploy a medio terminar, el teléfono sin datos— NO es eso, y antes
     terminaba en el mismo lugar: parecía que se te había vencido la sesión y que había
     que volver a escribir la clave, cuando lo único que hacía falta era esperar. */
  useEffect(() => {
    setArranque(null)
    quienSoy()
      .then((c) => setCuenta(c))
      /* Texto propio y no el del error: acá el mensaje de la API es genérico («No se
         pudo completar la operación») y no dice lo único que el usuario necesita saber,
         que es que el problema no es suyo y que su sesión sigue abierta. */
      .catch(() => setArranque('No se pudo conectar con el servidor. Tu sesión sigue abierta: probá de nuevo en un momento.'))
  }, [intento])

  /* La colección es la del usuario: se pide al entrar y se olvida al salir.

     LA CONDICIÓN ES EL TOKEN Y NO `cuenta`, Y ESO VALE UN VIAJE ENTERO. Esperando a
     `cuenta` los dos pedidos salían en fila —primero `/api/yo`, y recién cuando
     contestaba, `/api/coleccion`—, y en 3G cada viaje son varios cientos de
     milisegundos. Pero los dos necesitan lo mismo y nada más: el token, que ya está en
     `localStorage` antes de que arranque nada. Así que salen juntos.

     No cambia lo que se ve cuando algo falla: un 401 de cualquiera de los dos termina
     en la pantalla de entrada igual, y `pedir` ya borró el token antes de avisar.

     El ref es lo que evita el pedido repetido: el efecto se vuelve a correr cuando
     `cuenta` pasa de `undefined` al usuario, y sin él serían dos lecturas de la
     colección en cada carga. Lleva el `intento` adentro para que el botón de reintentar
     sí vuelva a pedir. */
  const coleccionPedidaPara = useRef(null)
  useEffect(() => {
    setFallidas(new Set())
    const t = token()
    /* `!t && !cuenta` y no sólo `!t`: hay un navegador con el almacenamiento bloqueado
       donde `recordarToken` no puede escribir, se lo traga a propósito, y entonces el
       login anda pero `token()` sigue devolviendo null. Mirando sólo el token, ese
       usuario entraba a un álbum VACÍO con el pie jurándole que se estaba guardando.
       Pidiendo igual, el 401 lo manda a la pantalla de entrada, que es feo pero honesto. */
    if (!t && !cuenta) {
      coleccionPedidaPara.current = null
      return setDatos(VACIA)
    }
    const marca = `${t ?? 'sin-token'}|${intento}`
    if (coleccionPedidaPara.current === marca) return
    coleccionPedidaPara.current = marca
    leerColeccion()
      .then((d) => { ultimaLectura.current = Date.now(); setDatos(d); setColeccionLista(true) })
      // Si el token ya no sirve, a la pantalla de entrada: un cartel de error con un
      // solo botón de Salir no le sirve a nadie.
      .catch((e) => (e?.sesion ? sesionMuerta() : setError(e.message)))
  }, [cuenta, intento])

  /* Se mira la red para dos cosas: no mandar a revisar la conexión cuando ya volvió, y
     reintentar solo lo que había quedado sin guardar. Lo segundo hace falta de verdad:
     volver a tocar la carta NO reintenta, le suma una, así que sin esto el usuario no
     tenía ninguna forma de recuperar esos cambios. Y reintentar solo es más fiel al
     "cero ceremonia" que ponerle un botón. */
  useEffect(() => {
    const marcar = () => setEnLinea(navigator.onLine !== false)
    addEventListener('online', marcar)
    addEventListener('offline', marcar)
    return () => { removeEventListener('online', marcar); removeEventListener('offline', marcar) }
  }, [])

  useEffect(() => {
    if (!enLinea) return
    for (const clave of fallidasRef.current)
      mandar(clave, vivo.current.cantidades[clave] ?? 0, vivo.current.estados[clave] ?? null)
  }, [enLinea])

  /* #91: irse con cambios que no se pudieron guardar los pierde para siempre, y hasta
     acá en silencio — al recargar volvía el número del servidor y el pie decía que todo
     se estaba guardando. No hay dónde dejarlos (la colección no se guarda en el aparato,
     y es a propósito), así que lo único honesto es avisar antes de que se vaya. Sólo se
     engancha cuando hay algo perdido: en el camino normal no molesta nunca. */
  useEffect(() => {
    if (!fallidas.size) return
    const preguntar = (e) => { e.preventDefault(); e.returnValue = '' }
    addEventListener('beforeunload', preguntar)
    return () => removeEventListener('beforeunload', preguntar)
  }, [fallidas.size])

  function anotarFallo(clave, hubo) {
    setFallidas((antes) => {
      if (hubo === antes.has(clave)) return antes
      const ahora = new Set(antes)
      if (hubo) ahora.add(clave); else ahora.delete(clave)
      return ahora
    })
  }

  /* Un guardado que falla se reintenta un par de veces antes de darse por perdido. Es
     más fiel al "cero ceremonia" que un cartel: casi todos los fallos son un bache de
     red de un segundo, y de eso el usuario no tiene por qué enterarse.

     `seVa` es la página yéndose: ahí no se reintenta nada, no hay tiempo. */
  async function despachar(clave, cantidad, estado, seVa) {
    const gen = generacion.current
    for (let intento = 0; ; intento++) {
      try {
        // keepalive también acá, no sólo al cerrar: lo que hay que proteger no son los
        // 250 ms de espera —eso ya lo cubría el vaciado— sino el viaje entero, que en un
        // teléfono con datos son entre 300 y 3000 ms. Si la pestaña se cierra en el
        // medio, sin esto el navegador aborta el pedido y ese toque se pierde.
        await guardarCarta(clave, cantidad, estado, { keepalive: true })
        return true
      } catch (e) {
        // La sesión murió: no hay nada que reintentar, hay que volver a entrar. Antes
        // esto pintaba el cartel de "fijate la conexión" y la app seguía andando: podías
        // marcar media hora al vacío y perder todo sin enterarte.
        /* Hubo una restauración mientras esto viajaba: este valor es de la colección
           ANTERIOR y ya no significa nada. No se reintenta y no se marca como fallado
           —no se perdió un cambio: se reemplazó a propósito—. `null` es justamente
           «no mandé nada» y quien llama ya lo distingue. */
        if (generacion.current !== gen) return null
        if (e?.sesion) { sesionMuerta(undefined, clave); return false }
        if (seVa || intento >= REINTENTOS) return false
        await new Promise((r) => setTimeout(r, ESPERA_REINTENTO * (intento + 1)))
        if (generacion.current !== gen) return null
      }
    }
  }

  /* Saca de la cola lo último que se sabe de esa carta y lo manda, encadenado atrás del
     envío anterior de la MISMA carta, para que dos no se pisen. */
  function enviar(clave, seVa) {
    const ultimo = pendientes.current.get(clave)
    if (!ultimo) return null
    clearTimeout(ultimo.reloj)
    pendientes.current.delete(clave)

    /* Yéndose la página no se encadena ni se espera nada: el fetch tiene que salir
       DENTRO del manejador de pagehide, o el navegador descarta el documento antes de
       que corra ningún .then(). Si esperáramos al envío anterior de esta carta —que
       puede no volver nunca— el valor nuevo no saldría jamás, y es justo el que hay que
       salvar. Se acepta el riesgo chico de que el anterior llegue último: mucho mejor
       que perderlo seguro. Medido: sin esto, irse con un PUT en vuelo hacía que el
       último toque ni siquiera saliera a la red. */
    if (seVa) {
      /* Y lo que esperaba turno en el casillero queda descartado: lo que sale acá es más
         nuevo. `pagehide` no siempre termina en documento descartado —con bfcache la
         página vuelve—, así que si el encadenado despertara, mandaría el número viejo
         encima del que acabamos de mandar. */
      porSalir.current.delete(clave)
      guardarCarta(clave, ultimo.cantidad, ultimo.estado, { keepalive: true })
        .catch(() => anotarFallo(clave, true))
      return null
    }

    /* El valor queda en el casillero y el envío lo lee recién cuando le toca salir. */
    porSalir.current.set(clave, { cantidad: ultimo.cantidad, estado: ultimo.estado })

    const antes = enVuelo.current.get(clave) ?? Promise.resolve()
    const ahora = antes
      .catch(() => {})
      .then(() => {
        /* Si otro envío encadenado ya se llevó el valor final, éste saldría con un
           número viejo: no sale. Medido antes de esto: con el primer envío retenido,
           cinco toques daban cinco viajes seguidos aunque sólo importara el último. */
        const v = porSalir.current.get(clave)
        if (!v) return null
        porSalir.current.delete(clave)
        return despachar(clave, v.cantidad, v.estado, seVa)
      })
      .then((bien) => {
        // null es "no mandé nada", y entonces no puede apagar el aviso de un fallo ajeno.
        if (bien !== null) anotarFallo(clave, !bien)
        if (enVuelo.current.get(clave) === ahora) enVuelo.current.delete(clave)
        // Con la clave adentro, así quien espera el vaciado sabe QUÉ falló y no sólo
        // cuántos: al salir hay que juntarlo con lo que ya venía fallado de antes.
        return { clave, bien }
      })
    enVuelo.current.set(clave, ahora)
    return ahora
  }

  /* Manda una carta sola, esperando por si vienen más toques de la misma. */
  function mandar(clave, cantidad, estado) {
    const previo = pendientes.current.get(clave)
    if (previo) clearTimeout(previo.reloj)
    const reloj = setTimeout(() => enviar(clave, false), ESPERA)
    pendientes.current.set(clave, { cantidad, estado, reloj })
  }

  /* Vaciar todo lo pendiente de una. Sólo toca refs y setters de React, así que no se
     queda vieja aunque la capture un efecto con dependencias vacías.

     Espera también lo que YA salió y sigue viajando (`enVuelo`), no sólo la cola: si no,
     tocar una carta, mirarla medio segundo y recién ahí salir dejaba el PUT en el aire y
     el DELETE de la sesión le ganaba de mano. Ese caso es más probable que el que se
     cubría antes. */
  function vaciar(seVa) {
    for (const clave of [...pendientes.current.keys()]) enviar(clave, seVa)
    if (seVa) {
      /* Y NO ALCANZA CON `pendientes`: el último toque puede no estar ahí. Cuando ya
         había un PUT de esa carta en vuelo, `enviar` le cumplió la espera de 250 ms, lo
         sacó de `pendientes` y lo dejó en el casillero encadenado atrás de ese viaje —que
         en un teléfono con datos son entre 300 y 3000 ms—. Yéndose la página, ese
         `.then()` no corre nunca: el valor se quedaba en el casillero y NI SIQUIERA SALÍA
         A LA RED, que es exactamente el bug que el encadenado por carta vino a arreglar y
         que acá volvía por la puerta de al lado. Sale por el mismo camino de emergencia:
         `keepalive` y sin encadenar. */
      /* SI ESE ENVÍO FALLA, SE ANOTA. El camino de emergencia no pasa por `despachar`, o
         sea que no tiene los dos reintentos — no hay tiempo — pero eso no es razón para
         tragarse el fallo. `pagehide` no siempre termina en documento descartado: con
         bfcache la página vuelve, y ahí un `.catch(() => {})` dejaba la carta en pantalla
         con el número nuevo, el pie diciendo «Guardando a cada cambio» y nada en
         `fallidas` — con lo que ni el reintento por `online` ni el refresco al volver la
         tocaban, y a los 60 s el servidor devolvía el número viejo y el cambio desaparecía
         también de la pantalla. Sin rastro.

         Si el documento sí se descarta, el `setState` de `anotarFallo` es un no-op y no
         cuesta nada. No agrega maquinaria: usa el conjunto que el pie ya mira. */
      for (const [clave, v] of [...porSalir.current]) {
        porSalir.current.delete(clave)
        guardarCarta(clave, v.cantidad, v.estado, { keepalive: true })
          .catch(() => anotarFallo(clave, true))
      }
      return Promise.resolve() // la página se va: no hay nada que esperar
    }
    return Promise.all([...enVuelo.current.values()].map((p) => p.catch(() => {})))
  }

  /* La sesión murió: lo encolado ya no se puede mandar, y si se mandara podría salir con
     el token de OTRA cuenta que entre en esta misma pestaña. Se tira.

     Y NO ALCANZA CON VACIAR LA COLA. Un reintento programado a 900 o 1800 ms no vive en
     `pendientes` —vive en el `await` de `despachar`, que ya salió de la cola— así que
     limpiar los tres mapas no lo toca: se despierta, vuelve a leer el token de
     `localStorage`, y si en el medio entró otra cuenta en esta misma pestaña **sale con
     ese token**. El servidor hace lo correcto con la credencial que le llega, así que no
     hay 401 que lo frene: es una carta de una persona escrita en la cuenta de otra.

     Subir `generacion` es justamente el freno que ya existe para eso: `despachar` guarda
     el valor al empezar y se rinde con `null` en los dos puntos donde vuelve del await. */
  function matarCola() {
    generacion.current += 1
    for (const { reloj } of pendientes.current.values()) clearTimeout(reloj)
    pendientes.current.clear()
    porSalir.current.clear()
    enVuelo.current.clear()
  }

  /* SI QUEDABA ALGO SIN GUARDAR, SE DICE CUÁL. Al volver a entrar, el efecto que lee la
     colección hace `setFallidas(new Set())` —tiene que hacerlo: la colección se relee del
     servidor y podría ser otra cuenta— así que esos cambios desaparecían **en silencio**.
     El pie dejaba de avisar y no quedaba rastro de qué cartas habían sido.

     No se reintentan a propósito: después de una sesión muerta el que vuelve a entrar
     puede ser OTRA persona en la misma compu, y mandar las cartas de uno a la cuenta de
     otro es exactamente lo que el oyente de `storage` vino a evitar. Lo único honesto es
     decir cuáles fueron, que es lo mismo que hace `beforeunload` al irse con algo perdido. */
  function sesionMuerta(aviso, tambien) {
    const perdidas = new Set(fallidasRef.current)
    /* La carta cuyo 401 mató la sesión también se perdió, y todavía no está en el
       conjunto: `despachar` llama acá ANTES de anotar el fallo, y después `matarCola` se
       lleva la cola. Sin esto, el toque que destapó el problema era justo el que no se
       nombraba. */
    if (tambien) perdidas.add(tambien)
    matarCola()
    const base = aviso ?? 'Se venció tu sesión. Entrá de nuevo para seguir.'
    const cuales = perdidas.size ? nombrarRef.current?.(perdidas) ?? '' : ''
    setAvisoSesion(
      perdidas.size
        ? `${base} Quedaron ${perdidas.size} ${perdidas.size === 1 ? 'cambio' : 'cambios'} sin guardar${cuales ? `: ${cuales.replace(/^Son la /, 'la ').replace(/\.$/, '')}` : ''}. Vas a tener que marcar${perdidas.size === 1 ? 'la' : 'las'} de nuevo.`
        : base
    )
    setCuenta(null)
  }

  /* DOS PESTAÑAS EN LA MISMA COMPU NO PUEDEN SER DOS CUENTAS.
     El token vive en `localStorage`, que es de todo el origen, pero `cuenta` es estado de
     React y por lo tanto de esta pestaña sola. Sin esto: tenés abierta la colección de
     angel, alguien entra como lucas en otra pestaña, y la primera sigue dibujando las
     cartas de angel y diciendo «Guardando en tu cuenta, angel» — pero el próximo toque
     sale con el token de lucas y se guarda en la cuenta equivocada. No hay 401 que lo
     frene, porque el token es válido: el servidor hace lo correcto con la credencial que
     le llega.

     El evento `storage` NO se dispara en la pestaña que hizo el cambio, que es justo lo
     que hace falta. `e.key === null` es un `clear()` entero y también cuenta. */
  useEffect(() => {
    const mio = token()
    const alCambiar = (e) => {
      if (e.key !== null && e.key !== CLAVE_TOKEN) return
      if (token() !== mio) sesionMuerta('Entraste con otra cuenta en otra pestaña. Entrá de nuevo acá.')
    }
    addEventListener('storage', alCambiar)
    return () => removeEventListener('storage', alCambiar)
  }, [cuenta])

  const vaciarRef = useRef(null)
  vaciarRef.current = vaciar

  /* Lo que el servidor manda, pero conservando lo que NO se pudo guardar.

     Sin esto, el refresco al volver a la pestaña pisaba `datos` con lo del servidor y no
     tocaba `fallidas`: tu cambio desaparecía de la pantalla sin que nada lo dijera, la
     carta seguía marcada como «sin guardar» pero mostrando el número VIEJO, y no había
     forma de destrabarlo —volver a tocarla no reintenta, le suma una—.

     Y lo peor venía después: el reintento por `online` lee `vivo.current`, que tras el
     refresco ya era el valor del servidor, así que mandaba el número viejo, salía bien y
     apagaba el aviso. El mecanismo que existe para recuperar un cambio perdido terminaba
     certificando que se había guardado. */
  function conLoFallado(d) {
    const perdidas = fallidasRef.current
    if (!perdidas.size) return d
    const cantidades = { ...d.cantidades }
    const estados = { ...d.estados }
    for (const clave of perdidas) {
      const n = vivo.current.cantidades[clave] ?? 0
      if (n > 0) {
        cantidades[clave] = n
        estados[clave] = vivo.current.estados[clave] ?? null
      } else {
        // Lo que quiso borrar y no se pudo: tampoco vuelve.
        delete cantidades[clave]
        delete estados[clave]
      }
    }
    return { estados, cantidades }
  }

  /* Volver a pedir la colección al volver a la pestaña, si pasó un rato.

     Antes se pedía UNA sola vez y nunca más. El teléfono con la pestaña abierta desde
     hace una semana mostraba la carta 700 en 0; si mientras tanto la pusiste en 2 desde
     la compu, el próximo toque en el teléfono calculaba sobre ESA instantánea vieja y
     mandaba 1: la base retrocedía, y no había ningún error que lo delatara.

     Lo pendiente se manda ANTES de releer, o la respuesta del servidor lo pisaría. */
  useEffect(() => {
    if (!cuenta) return
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimaLectura.current < REFRESCO) return
      ultimaLectura.current = Date.now()
      Promise.resolve(vaciarRef.current(false))
        .catch(() => {})
        .then(() => leerColeccion())
        .then((d) => {
          const con = conLoFallado(d)
          vivo.current = con
          setDatos(con)
          /* Y se reintenta lo que había quedado sin guardar, que acá tiene más sentido
             que en ningún lado: acabamos de leer del servidor, o sea que la red anda. */
          for (const clave of fallidasRef.current)
            mandar(clave, con.cantidades[clave] ?? 0, con.estados[clave] ?? null)
        })
        .catch(() => { /* si falla, se sigue con lo que ya había en pantalla */ })
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cuenta])

  useEffect(() => () => clearTimeout(relojAlias.current), [])

  /* Si cerrás la pestaña justo después de un toque, eso todavía no salió. */
  useEffect(() => {
    const alIrse = () => vaciarRef.current(true)
    addEventListener('pagehide', alIrse)
    return () => { removeEventListener('pagehide', alIrse); alIrse() }
  }, [])

  /* Cambiar una carta: primero se ve en pantalla, después sale para el servidor. */
  function aplicar(clave, cantidad, estado) {
    const d = vivo.current
    const cant = { ...d.cantidades }
    const est = { ...d.estados }
    if (cantidad > 0) {
      cant[clave] = cantidad
      if (estado) est[clave] = estado; else delete est[clave]
    } else {
      // Cantidad 0 es no tenerla, y entonces tampoco tiene condición.
      delete cant[clave]
      delete est[clave]
    }
    /* Se escribe el espejo ANTES del setDatos, así el toque siguiente —aunque caiga en
       el mismo frame, antes de que React vuelva a dibujar— calcula sobre este número y
       no sobre el del render viejo. */
    vivo.current = { estados: est, cantidades: cant }
    setDatos(vivo.current)
    mandar(clave, cantidad, cantidad > 0 ? estado : null)
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
     `cantidades` son las filas de la cuenta ENTERA, las dos colecciones juntas. Mirando
     sólo el catálogo elegido, apenas cambiás a Leyenda las 1936 de Cromeros figuran como
     huérfanas y el pie ofrece borrarlas de un click.

     Y devuelve `[]` mientras falte cargar alguno: si `leyenda.json` no bajó, no hay nada
     que declarar. Un archivo que no llegó no es un catálogo vacío. */
  const huerfanas = useMemo(() => {
    if (!catalogos) return []
    if (COLLECTIONS.some((c) => !catalogos[c.id])) return []
    return Object.keys(cantidades).filter((c) => !pointsToASlot(c, catalogos))
  }, [catalogos, cantidades])

  /* Se borran de a una, con el mismo camino que usa cada toque (cantidad 0 = no tener
     fila). A propósito NO va por el reemplazo masivo: ése es el único camino que borra
     en masa y no hace falta abrirlo para esto. */
  /* La copia se baja ANTES de tocar nada, igual que al restaurar: si el catálogo estaba
     mal, es lo único que permite volver. */
  function sacarHuerfanas() {
    descargar(datos, 'mi-coleccion-dbz-antes-de-sacar.json')
    for (const clave of huerfanas) aplicar(clave, 0, null)
    setSacando(false)
  }

  /* Las variantes que se DIBUJAN por expansión, que no son las mismas que se ofrecen:
     acá entra también lo que ya tenés cargado con un id que el catálogo dejó de declarar.
     Se calcula una vez por cambio de colección y no por carta. */
  const dibujables = useMemo(() => drawableVariants(catalogo, cantidades), [catalogo, cantidades])

  const resumen = useMemo(() => {
    if (!catalogo) return null
    let total = 0, tengo = 0, sobrantes = 0
    const cuenta = { bien: 0, perfecta: 0, reemplazar: 0 }
    const porFiltro = Object.fromEntries(FILTROS.map((f) => [f.id, 0]))

    /* `total` son los HUECOS del álbum: las variantes nunca son huecos, porque nadie sabe
       cuántas existen. `tengo` es cuántos huecos tienen algo — si no, tener la 551 en dos
       fondos daría «1079 de 1078». Y `sobrantes` se cuenta POR CASILLERO: la 551 mate una
       y la 551 estrellada una son cero sobrantes, que es la verdad — no te sobra nada,
       tenés las dos.

       Con un solo casillero por hueco (o sea, todo Cromeros para siempre) las tres
       fórmulas dan exactamente el número de antes, sin ninguna rama especial. */
    for (const exp of catalogo) {
      for (const n of exp.lista) {
        total++
        let algo = false
        /* LOS CONTADORES DE LOS FILTROS SON DE HUECOS, NO DE CASILLEROS, y hace falta
           para que los números cierren entre sí. Contando casilleros, teniendo la 2 en
           dos fondos el chip «Todas» decía «Colección 1099» al lado de un «4 de 1097»,
           y 1093 + 4 no daba 1099. Un hueco cuenta para un filtro si ALGUNO de sus
           casilleros pasa, que además es lo que se ve: la carta aparece en el listado. */
        const pasaElHueco = Object.fromEntries(FILTROS.map((f) => [f.id, false]))
        for (const { clave } of slotsOf(exp, n, dibujables[exp.id], cantidades)) {
          const cant = cantidades[clave] ?? 0
          const est = estados[clave]
          if (cant > 0) {
            algo = true
            sobrantes += cant - 1
            cuenta[est ?? 'bien']++
          }
          for (const f of FILTROS) if (f.pasa(cant, est)) pasaElHueco[f.id] = true
        }
        for (const f of FILTROS) if (pasaElHueco[f.id]) porFiltro[f.id]++
        if (algo) tengo++
      }
    }
    return { total, tengo, sobrantes, porFiltro, ...cuenta }
  }, [catalogo, dibujables, estados, cantidades])

  /* La columna «Álbum» del panel es cuánto lleva cada uno de TODO lo que hay para
     marcar, no de la colección que yo esté mirando: `g.cartas` cuenta las filas de esa
     persona, que son las dos colecciones juntas. Con `resumen.total` dividiría 1936
     cartas por los 1097 huecos de Leyenda y daría 176%. */
  /* LO QUE EL PANEL NECESITA SABER DE LOS CATÁLOGOS, y que el servidor no puede saber.
     Cada colección con su nombre, cuántos huecos tiene y qué prefijos de clave son suyos.
     Sin esto la columna «Álbum» divide por la suma de los dos: el que tiene Cromeros
     entero —1936 de 1936— se dibujaba con 64%. */
  const coleccionesDelPanel = useMemo(() => {
    const salida = []
    for (const c of COLLECTIONS) {
      const col = catalogos?.[c.id]
      if (!col) continue
      salida.push({
        id: c.id,
        nombre: c.nombre,
        total: col.expansiones.reduce((a, e) => a + e.lista.length, 0),
        prefijos: col.expansiones.map((e) => e.id),
      })
    }
    return salida
  }, [catalogos])

  const hayQueExportar = (resumen?.tengo ?? 0) > 0

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
  const nombrarFallidas = useCallback((claves) => {
    if (!claves.size) return ''
    const deAca = new Set((catalogo ?? []).map((e) => e.id))
    const nombres = [...claves]
      .map((c) => {
        const hueco = slotOf(c, catalogos)
        /* Si no apunta a ningún hueco conocido —un catálogo que no cargó— se cae al
           número, que es lo único seguro. Nunca a la clave. */
        if (!hueco) {
          const n = Number(c.slice(c.lastIndexOf(':') + 1))
          return Number.isFinite(n) && c.includes(':') ? { n, texto: String(n) } : null
        }
        /* El «de dónde es» lo resuelve `slotName`, que sabe que el `corto` y el `prefijo`
           hacen el mismo trabajo. Acá se apilaban: «Son la F F504». */
        return { n: hueco.n, texto: slotName(c, catalogos, deAca.has(hueco.exp.id)) }
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n)
      .map((x) => x.texto)
    if (!nombres.length) return ''
    if (nombres.length <= 6) return `Son la ${nombres.join(', la ')}.`
    return `Son la ${nombres.slice(0, 6).join(', la ')} y ${nombres.length - 6} más.`
  }, [catalogo, catalogos])

  const listaFallidas = useMemo(() => nombrarFallidas(fallidas), [fallidas, nombrarFallidas])
  /* Por ref, como `vaciarRef`: `sesionMuerta` se declara más arriba y la necesita. */
  nombrarRef.current = nombrarFallidas

  useEffect(() => {
    if (!hayQueExportar) return
    if (Date.now() - ultimoExporto < DESCANSO) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let quedan = GUINOS
    let relojes = []
    const guiñar = () => {
      setGuiñando(true)
      relojes.push(setTimeout(() => setGuiñando(false), 1500))
      if (--quedan > 0) relojes.push(setTimeout(guiñar, CADA))
    }
    relojes.push(setTimeout(guiñar, PRIMERO))
    return () => relojes.forEach(clearTimeout)
  }, [hayQueExportar, ultimoExporto])

  /* Se abrió el diálogo: ya sabe que el botón está. Se anota y no se mueve más. */
  function exportar() {
    const ahora = Date.now()
    setGuiñando(false)
    setUltimoExporto(ahora)
    try { localStorage.setItem(CLAVE_EXPORTO, String(ahora)) } catch { /* modo privado */ }
    setExportando(true)
  }

  /* Contraer una expansión: deja de dibujarse su grilla y queda sólo la banda. Queda
     guardado: lo que dejaste cerrado sigue cerrado cuando volvés. */
  function plegar(id) {
    setPlegadas((antes) => {
      const ahora = new Set(antes)
      if (ahora.has(id)) ahora.delete(id)
      else ahora.add(id)
      return ahora
    })
  }

  /* Un toque: si no la tenés, pregunta la condición. Si ya la tenés, suma una. */
  function tocar(clave, numero) {
    const tiene = vivo.current.cantidades[clave] ?? 0

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
    const hueco = huecoDe(clave)
    if (hueco && variantsFor(hueco.exp, hueco.n).length) return setPreguntandoVariante(hueco)

    if (!tiene) {
      /* Sin variantes y sin condición —el resto de Leyenda— hay una sola respuesta
         posible, así que no se pregunta: la deja en 1. */
      if (!album?.condicion) return aplicar(clave, 1, null)
      return setPreguntando({ clave, nombre: cardLabel(hueco?.exp, numero) })
    }
    aplicar(clave, tiene + 1, vivo.current.estados[clave])
  }

  /* De qué hueco del álbum es este casillero. La parte de la clave anterior a los dos
     puntos puede ser el id de la expansión o ese id con el sufijo de una variante, y los
     ids de expansión llevan guiones (`ley-2-3`), así que no se puede partir por guion: se
     busca contra el catálogo, que es quien sabe. */
  function huecoDe(clave) {
    const corte = clave.lastIndexOf(':')
    const expParte = clave.slice(0, corte)
    const n = Number(clave.slice(corte + 1))
    for (const exp of catalogo ?? []) {
      if (expParte === exp.id || expParte.startsWith(exp.id + '-')) return { exp, n }
    }
    return null
  }

  /* Elegiste una variante: se le suma una a ESE casillero. */
  function elegirVariante(id) {
    const hueco = preguntandoVariante
    setPreguntandoVariante(null)
    if (!hueco) return
    const clave = slotKey(hueco.exp.id, hueco.n, id)
    aplicar(clave, (vivo.current.cantidades[clave] ?? 0) + 1, vivo.current.estados[clave] ?? null)
  }

  /* Mantener apretado: resta una. Al llegar a cero se olvida también la condición. */
  function restar(clave) {
    /* Si no la tenés no hay nada que restar. Sin esto salía un PUT con cantidad -1, el
       servidor lo rechazaba con un 400 y el pie pintaba "No se pudo guardar el último
       cambio. Fijate la conexión." por un gesto que la propia app sugiere —y sobre
       1597 de las 1936 cartas, que es el estado más común. Una falsa alarma de pérdida
       de datos hace que el usuario desconfíe de todo lo demás. */
    const tiene = vivo.current.cantidades[clave] ?? 0
    if (!tiene) return
    aplicar(clave, tiene - 1, vivo.current.estados[clave])
  }

  /* Las dos de arriba son distintas en cada render, porque leen `cantidades`. Estas dos
     no cambian nunca, y son las que reciben las 1936 cartas: si a cada una le pasáramos
     una flecha nueva, el memo de Carta no serviría de nada. El ref guarda siempre la
     versión fresca, y estas la leen recién cuando el dedo toca. */
  const ultimo = useRef(null)
  ultimo.current = { tocar, restar }
  const alTocar = useCallback((clave, numero) => ultimo.current.tocar(clave, numero), [])
  const alMantener = useCallback((clave) => ultimo.current.restar(clave), [])

  function responder(estado) {
    aplicar(preguntando.clave, 1, estado)
    setPreguntando(null)
  }

  /* El alias se copia de un toque: es para pegarlo en el homebanking, no para leerlo. */
  async function copiarAlias() {
    let listo = false
    try {
      await navigator.clipboard.writeText(ALIAS)
      listo = true
    } catch {
      // El portapapeles moderno pide pestaña con foco y sitio seguro. Donde no se
      // puede, el de toda la vida todavía anda.
      const caja = document.createElement('textarea')
      caja.value = ALIAS
      caja.setAttribute('readonly', '')
      caja.style.position = 'fixed'
      caja.style.opacity = '0'
      document.body.appendChild(caja)
      caja.select()
      listo = document.execCommand?.('copy') ?? false
      caja.remove()
    }
    // Un botón que no hace nada es peor que uno que avisa que no pudo.
    setAvisoAlias(listo ? 'copiado' : 'copialo a mano')
    clearTimeout(relojAlias.current)
    relojAlias.current = setTimeout(() => setAvisoAlias(null), 2500)
  }

  async function cerrar() {
    /* Guarda de reentrada: sin esto, dos clicks seguidos reproducían el bug original
       entero y en silencio — el segundo encontraba la cola ya vacía, resolvía al toque y
       mandaba el DELETE con el PUT todavía viajando. */
    if (saliendo) return
    setSaliendo(true)
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
    const perdidas = new Set(fallidasRef.current)
    let termino = false
    const vaciando = vaciar(false)
      .then((r) => {
        termino = true
        for (const x of r ?? []) {
          if (!x || x.bien === null || x.bien === undefined) continue
          if (x.bien) perdidas.delete(x.clave); else perdidas.add(x.clave)
        }
      })
      .catch(() => { termino = true })
    await Promise.race([vaciando, new Promise((r) => setTimeout(r, TECHO_SALIR))])
    await salir()
    matarCola()
    const perdidos = perdidas.size
    /* Sin red, Salir se llevaba el toque y no lo decía en ningún lado: el aviso del pie
       se iba junto con la pantalla. Se cuenta lo que no llegó a entrar y se dice en la
       pantalla de entrada, que es la única que el usuario va a estar mirando. Si venció
       el techo no sabemos cuántos fueron, y decirlo así es más honesto que callarlo. */
    if (perdidos)
      setAvisoSesion(perdidos === 1
        ? 'Saliste, pero un cambio no se pudo guardar: quedó sin registrar en tu cuenta.'
        : `Saliste, pero ${perdidos} cambios no se pudieron guardar: quedaron sin registrar en tu cuenta.`)
    else if (!termino)
      setAvisoSesion('Saliste sin que terminara de guardarse el último cambio. Fijate la conexión.')
    setCuenta(null)
    setError(null)
    setSaliendo(false)
  }

  /* Restaurar un respaldo: se manda entera y se pisa lo que había en la cuenta. */
  /* Leer el archivo NO reemplaza nada: sólo abre la confirmación. */
  function restaurarCopia(archivo) {
    setAvisoArchivo(null)
    restaurar(archivo)
      .then((d) => {
        // El servidor también lo rechaza, pero es mejor decirlo acá que dejar confirmar
        // algo que va a fallar.
        if (!Object.keys(d.cantidades).length)
          return setAvisoArchivo('Esa copia no tiene ninguna carta. No se cambió nada.')
        setPorRestaurar(d)
      })
      .catch((e) => {
        if (e?.sesion) return sesionMuerta()
        /* Los errores del navegador al leer un archivo vienen en inglés y hablan de
           permisos del sistema: no le dicen nada a nadie. Sólo se muestran los nuestros,
           que están escritos para leerse. */
        setAvisoArchivo(e instanceof ErrorApi
          ? e.message
          : 'No pude leer ese archivo. ¿Es una copia de tu colección?')
      })
  }

  /* Confirmado. Primero se baja sola una copia de lo que había —la red por si el archivo
     elegido no era el que creías— y recién después se reemplaza. */
  function confirmarReemplazo() {
    const nueva = porRestaurar
    setPorRestaurar(null)
    if (!nueva) return
    descargar(datos, 'mi-coleccion-dbz-antes-de-restaurar.json')

    /* PRIMERO SE ESPERA A LO QUE YA SALIÓ, Y RECÉN DESPUÉS SE REEMPLAZA.
       Restaurar es el único camino que borra en masa y el CLAUDE.md lo protege con tres
       capas para que el resultado sea exactamente el archivo. Pero un PUT de carta que
       salió hace 200 ms puede aterrizar DESPUÉS del reemplazo y reponer una carta que la
       copia no traía: la colección queda contaminada, sin ningún aviso, y no se descubre
       hasta la próxima carga.

       Cancelarlo desde el navegador no sirve: un `abort` corta la espera del cliente, no
       impide que el servidor procese lo que ya le llegó. Lo único que ORDENA de verdad es
       esperar. Con techo, porque un pedido colgado no puede dejar la restauración
       trabada; y lo que sobreviva al techo lo frena la `generacion`, que corta los
       reintentos. Queda una ventana chica —un PUT colgado que conteste entre el techo y
       su propio corte de 15 s— y se acepta: cerrarla del todo pediría que el servidor
       supiera ordenar, que es mucho más caro que el problema. */
    generacion.current += 1
    for (const { reloj } of pendientes.current.values()) clearTimeout(reloj)
    pendientes.current.clear()
    porSalir.current.clear()
    const aterrizando = Promise.all([...enVuelo.current.values()].map((pp) => pp.catch(() => {})))

    Promise.race([aterrizando, new Promise((r) => setTimeout(r, TECHO_RESTAURAR))])
      .then(() => reemplazarColeccion(nueva))
      /* Se relee del servidor en vez de pintar lo que venía en el archivo. El servidor
         es la única fuente y puede haber descartado claves que no reconoce: antes la
         pantalla te mostraba cartas que en tu cuenta no habían quedado, y no había forma
         de darse cuenta hasta la próxima visita. Si la relectura falla, se muestra lo
         del archivo, que es lo que se hacía siempre. */
      .then(() => leerColeccion().catch(() => nueva))
      .then((d) => {
        ultimaLectura.current = Date.now()
        vivo.current = d
        setDatos(d)
        // Se reemplazó todo: lo que no se había podido guardar carta por carta ya no
        // tiene sentido. (La cola ya se vació arriba, antes de esperar.)
        pendientes.current.clear()
        porSalir.current.clear()
        enVuelo.current.clear()
        setFallidas(new Set())
      })
      .catch((e) => {
        if (e?.sesion) return sesionMuerta()
        setAvisoArchivo(e.message ?? 'No se pudo reemplazar la colección.')
      })
  }

  /* Va ANTES del formulario de entrada a propósito: si el servidor no contesta, mandar
     a alguien a escribir usuario y clave es mentirle sobre lo que pasó y encima no le
     sirve de nada, porque tampoco va a poder entrar. */
  if (arranque) return (
    <div className="hoja">
      <p className="cargando">{arranque}</p>
      <p className="acciones-error">
        <button className="reintentar" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
      </p>
    </div>
  )
  if (cuenta === undefined) return <div className="hoja"><p className="cargando">Cargando…</p></div>
  if (!cuenta) return <Entrar aviso={avisoSesion} onEntro={(c) => { setAvisoSesion(null); setCuenta(c) }} />

  /* Un corte de dos segundos al abrir, o el servidor reiniciándose durante un deploy,
     dejaban una pantalla con un texto y un único botón de Salir: la única salida era
     desloguearse. Ahora se puede volver a intentar sin perder la sesión. */
  if (error) return (
    <div className="hoja">
      <p className="cargando">{error}</p>
      <p className="acciones-error">
        <button className="reintentar" onClick={() => { setError(null); setIntento((n) => n + 1) }}>
          Reintentar
        </button>
        <button className="secundario" onClick={cerrar}>Salir</button>
      </p>
    </div>
  )
  /* LA GRILLA NO SE DIBUJA HASTA QUE LLEGÓ LA COLECCIÓN, y no es cosmético.
     `datos` arranca en `VACIA`, así que apenas contestan `/api/yo` y el catálogo se
     dibujaban las 1936 cartas en «me falta» mientras `/api/coleccion` seguía viajando.
     Esa grilla se podía tocar: `tocar` lee `vivo.current.cantidades[clave] ?? 0`, ve un 0
     que en realidad es «no sé», abre el diálogo de condición y manda un PUT con
     cantidad 1 PISANDO en el servidor la cantidad de verdad. Y después la colección
     llegaba y devolvía el número bueno a la pantalla, así que no quedaba ni rastro: el
     usuario se entera la próxima vez que abre la app, o nunca. */
  if (!catalogo || !coleccionLista) return <div className="hoja"><p className="cargando">Cargando…</p></div>

  /* Qué está viejo de lo que corre afuera de la app. Vacío para todo el mundo menos el
     admin, porque `/api/yo` sólo le manda `salud` a él. */
  const enFalta = whatIsStale(cuenta?.salud)

  const pct = (n) => (n / resumen.total) * 100

  return (
    <>
      {/* Antes de todo: entre el encabezado y la primera carta hay un logo, el progreso
          y cinco botones de la barra. Con teclado o lector de pantalla eso son varios
          tabuladores en CADA visita antes de llegar a lo único que importa. La pantalla
          de entrada ya tenía su <main>; la app, que es donde se pasa el tiempo, no. */}
      <a className="saltar" href="#cartas">Saltar a las cartas</a>

      {/* Header, barra y footer van fuera de la columna de las cartas: así el fondo
          de cada franja llega de lado a lado y lo de adentro sigue alineado. */}
      <header className="encabezado">
        <div className="columna">
          <div className="marca">
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
            {disponibles.length > 1 && (
              <div className="colecciones" role="group" aria-label="Qué colección estoy mirando">
                {disponibles.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`coleccion${c.id === coleccionViva ? ' activa' : ''}`}
                    aria-pressed={c.id === coleccionViva}
                    onClick={() => pickCollection(c.id)}
                  >
                    {c.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* El botón del panel y el avance comparten la columna derecha: el botón arriba,
              el avance abajo. Antes `.progreso` era el segundo hijo del flex del header;
              ahora lo es `.lado`, y `.progreso` se queda con el ancho de su columna.

              Va acá y NO en la barra de filtros: en teléfono esa barra se convierte en la
              de abajo, con cinco lugares de ancho igual, y un sexto hermano les saca a los
              cuatro filtros el 20% que tienen cada uno. El encabezado es donde vive lo que
              no es la colección. */}
          <div className="lado">
            {/* LOS BOTONES DE LA CUENTA, JUNTOS: «Panel» (sólo el admin) y «Mi perfil»
                (todos). Van en un envoltorio para que en el teléfono ocupen UNA celda de la
                grilla del encabezado —la del renglón del logo— y no se auto-coloque ninguno
                en una fila implícita, que es lo que ya infló este encabezado una vez. */}
            <div className="header-actions">
            {cuenta.admin && (
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
                className={`a-panel${enFalta.length ? ' con-aviso' : ''}`}
                onClick={openDashboard}
                aria-label={enFalta.length
                  ? `Panel · revisá ${staleText(enFalta)}`
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
            <div className="progreso">
              <div className="avance">
                <span className="grande">{resumen.tengo}</span>
                <span className="de">de {resumen.total} cartas</span>
                {/* El porcentaje sale de los mismos dos números que están al lado, así que
                    no puede contradecirlos — y vale igual en los dos álbumes porque los dos
                    cuentan huecos. Ver `albumPercent`. */}
                <span className="pct">{albumPercent(resumen.tengo, resumen.total)}%</span>
                {resumen.sobrantes > 0 && (
                  <span className="sobrantes">
                    {resumen.sobrantes} repetida{resumen.sobrantes > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Con condición, los tres tramos. Sin condición —Leyenda— uno solo y
                  neutro: `cuenta[est ?? 'bien']++` mete TODO en `bien`, así que las tres
                  franjas pintarían «buen estado» sobre un álbum que no tiene estado. */}
              <div className="barra">
                {album?.condicion ? (
                  <>
                    <span className="s-bien" style={{ width: `${pct(resumen.bien)}%` }} />
                    <span className="s-perfecta" style={{ width: `${pct(resumen.perfecta)}%` }} />
                    <span className="s-reemplazar" style={{ width: `${pct(resumen.reemplazar)}%` }} />
                  </>
                ) : (
                  <span className="s-solo" style={{ width: `${pct(resumen.tengo)}%` }} />
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="herramientas">
        <div className="columna">
            <div className="filtros">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  className={`filtro f-${f.id}${filtro === f.id ? ' activo' : ''}`}
                  onClick={() => setFiltro(f.id)}
                  aria-pressed={filtro === f.id}
                >
                  <svg className="icono" width="21" height="21" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                       strokeLinejoin="round" aria-hidden="true">
                    {ICONOS[f.id]}
                  </svg>
                  {/* Los dos rótulos van siempre en el DOM y el CSS elige. Ver la nota
                      de FILTROS: así no hay un `if` sobre el ancho de la pantalla. */}
                  <span className="largo">{f.label}</span>
                  <span className="corto">{f.corto}</span>
                  <b>{resumen.porFiltro[f.id]}</b>
                </button>
              ))}
            </div>

            {/* A mano en la barra fija: el botón del pie queda abajo de las 1936 cartas.
                En el teléfono es el quinto lugar de la barra de abajo, con su rótulo;
                en escritorio sigue siendo el ícono solo. El `title` va sólo cuando NO
                hay rótulo visible: si hubiera los dos, el lector de pantalla leería
                «Exportar. Exportar», que es el mismo problema que tenían las cartas. */}
            <button
              className={`compartir${guiñando ? ' guiña' : ''}`}
              onClick={exportar}
              aria-label="Exportar"
            >
              <svg className="icono" width="21" height="21" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                   strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 8l5-5 5 5" />
                <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              <span className="corto">Exportar</span>
            </button>
        </div>
      </div>

      <main className="hoja" id="cartas" tabIndex={-1}>
        {/* Fuera de la barra fija: son instrucciones, se leen una vez y pueden irse con
            el scroll. Adentro ocupaban dos renglones fijos en el celular. */}
          {/* «otra» y no «otra igual»: en una expansión con variantes el segundo toque
              NO es una repetida de la misma, te pregunta cuál tenés — y la respuesta
              puede ser otro fondo. La palabra «igual» dejó de ser cierta el día que entró
              Leyenda. Se arregla sacándola y no partiendo la frase en dos según el álbum:
              una sola que sea verdad en los dos es mejor que dos que haya que mantener, y
              además en Leyenda sólo 271 de 1097 cartas preguntan, así que ninguna versión
              condicional sería cierta para toda la colección tampoco. */}
          <p className="ayuda">
            Tocá para marcar · de nuevo si tenés otra · mantené apretado para restar
            {/* Con el teclado no hay «mantener apretado», así que si el atajo no se dice
                acá no se entera nadie. Se muestra sólo cuando hay teclado de verdad: en
                un teléfono es ruido. */}
            <span className="solo-teclado"> · con el teclado, Backspace</span>
          </p>

        {catalogo.map((exp) => {
          const activo = FILTROS.find((f) => f.id === filtro)
          /* Un hueco se dibuja si ALGUNO de sus casilleros pasa el filtro. */
          const visibles = exp.lista.filter((n) =>
            slotsOf(exp, n, dibujables[exp.id], cantidades).some((s) =>
              activo.pasa(cantidades[s.clave] ?? 0, estados[s.clave])
            )
          )
          if (!visibles.length) return null

          /* Y la cuenta de la banda es de HUECOS, no de casilleros: «180 de 176» no
             significaría nada. */
          const tengoAca = exp.lista.filter((n) =>
            slotsOf(exp, n, dibujables[exp.id], cantidades).some((s) => (cantidades[s.clave] ?? 0) > 0)
          ).length
          const plegada = plegadas.has(exp.id)
          return (
            <section className={`expansion${plegada ? ' plegada' : ''}`} key={exp.id}>
              <div className="banda" style={{ background: exp.color, color: textoSobre(exp.color) }}>
                <button
                  className={`plegar${plegada ? ' cerrada' : ''}`}
                  onClick={() => plegar(exp.id)}
                  aria-expanded={!plegada}
                  aria-label={`${plegada ? 'Mostrar' : 'Contraer'} ${exp.nombre}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <h2>{exp.nombre}</h2>
                {/* EL RANGO VA SIN PREFIJO, y se probó con prefijo. El prefijo existe para
                    cuando el número se lee FUERA de contexto —la etiqueta hablada, el
                    título del diálogo, el texto que se pega en un grupo—; acá el contexto
                    es el nombre de la expansión, que está a diez píxeles. Y medido a 320,
                    360 y 412 px, «Leyenda 1–Leyenda 9» lleva la banda de 35 a 54 px en los
                    tres, y a 320 se corta. El CLAUDE.md ya avisaba que ahí estaba al
                    límite: hacen falta 311 px de texto en 292 de ancho útil. */}
                <span className="rango">{exp.desde}–{exp.hasta}</span>
                {/* Completa es tener todas, estén en el estado que estén: las "para reemplazar"
                    también cuentan, y ya tienen su propio filtro. */}
                {tengoAca === exp.lista.length ? (
                  <span className="cuenta completa" title={`${tengoAca} de ${exp.lista.length}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    Completa
                  </span>
                ) : (
                  <span className="cuenta">{tengoAca} de {exp.lista.length}</span>
                )}
              </div>
              {!plegada && (
              /* Si el catálogo trae `detalle` para esta expansión, sus casilleros dejan de
                 ser cuadraditos de 54 px y pasan a fichas anchas: adentro entran el
                 personaje y la tirada. Lo decide el DATO, no una lista de expansiones
                 especiales escrita en el código. */
              <div className={`grilla${exp.detalle ? ' con-detalle' : ''}`}>
                {visibles.flatMap((n) =>
                  slotsOf(exp, n, dibujables[exp.id], cantidades).map(({ clave, variante }) => (
                    <Carta
                      key={clave}
                      clave={clave}
                      numero={n}
                      nombre={cardLabel(exp, n)}
                      detalle={cardDetail(exp, n)}
                      variante={variante}
                      estado={estados[clave]}
                      cantidad={cantidades[clave] ?? 0}
                      sinGuardar={fallidas.has(clave)}
                      onTocar={alTocar}
                      onMantener={alMantener}
                    />
                  ))
                )}
              </div>
              )}
            </section>
          )
        })}

        {resumen.porFiltro[filtro] === 0 && (
          <p className="vacio">No hay ninguna carta en este listado.</p>
        )}

        {exportando && (
          <Exportar
            catalogo={catalogo}
            datos={datos}
            /* Las mismas que dibuja la grilla, no sólo las declaradas: una variante que
               tenés cargada con un id que el catálogo dejó de declarar sigue siendo una
               carta que tenés, y el texto no puede pedirla. */
            variantes={dibujables}
            /* Leyenda no usa condición: ahí «las que ya tengo» no pregunta en qué estado,
               porque habría una sola respuesta posible. */
            condicion={album?.condicion !== false}
            /* Sólo las colecciones que NO son la de siempre se anuncian. Cromeros sigue
               exportando exactamente el mismo texto que antes. */
            encabezado={coleccionViva === DEFAULT_COLLECTION ? null : (album?.coleccion ?? null)}
            onCerrar={() => setExportando(false)}
          />
        )}

        {preguntandoVariante && (
          <AskVariant
            nombre={cardLabel(preguntandoVariante.exp, preguntandoVariante.n)}
            variantes={variantsFor(preguntandoVariante.exp, preguntandoVariante.n)}
            cuentas={Object.fromEntries([
              ...variantsFor(preguntandoVariante.exp, preguntandoVariante.n).map((v) => [
                v.id,
                cantidades[slotKey(preguntandoVariante.exp.id, preguntandoVariante.n, v.id)] ?? 0,
              ]),
            ])}
            onElegir={elegirVariante}
            onCerrar={() => setPreguntandoVariante(null)}
          />
        )}

        {sacando && huerfanas.length > 0 && (
          <OrphansDialog
            keys={huerfanas}
            catalogos={catalogos}
            onConfirmar={sacarHuerfanas}
            onCerrar={() => setSacando(false)}
          />
        )}

        {porRestaurar && (
          <Reemplazar
            mias={cantidades}
            copia={porRestaurar.cantidades}
            onConfirmar={confirmarReemplazo}
            onCerrar={() => setPorRestaurar(null)}
          />
        )}

        {viendoNumeros && cuenta.admin && (
          /* El respaldo dice algo: el chunk son 2 KB y con la red lenta el click puede
             quedarse sin respuesta un segundo. Un botón que no hace nada se vuelve a
             apretar.

             Usa SÓLO clases de estilos.css — `.telon`, `.dialogo`, `.nada` — y a
             propósito NO `.numeros`, que ahora viaja en la hoja perezosa: si el CSS del
             panel todavía no llegó, un `.dialogo.numeros` se dibujaría sin ancho ni
             scroll. Y dice «Buscando…», que es lo mismo que muestra el panel mientras
             espera los datos, así que al montar no cambia el texto. */
          /* El límite va ADENTRO del `{viendoNumeros && ...}` y alrededor del `Suspense`:
             así un panel que no baja se queda en su diálogo y no se lleva puesta la
             colección. `onReset` cierra el panel, que es volver a donde se estaba. */
          <ErrorBoundary aviso="No se pudo abrir el panel." onReset={closeDashboard}>
          {/* El fallback tiene que tener la MISMA forma que el panel — página, no diálogo —
              o al llegar el chunk la pantalla salta de una caja centrada a una página
              completa. Y dice «Buscando…», que es lo mismo que muestra el panel mientras
              esperan los datos, así que al montar no cambia el texto. */}
          <Suspense fallback={
            <div className="pagina-panel">
              <header className="panel-cabecera">
                <button className="volver" onClick={closeDashboard}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Volver
                </button>
                <h1>Los números</h1>
              </header>
              <div className="panel-cuerpo numeros"><p className="nada">Buscando…</p></div>
            </div>
          }>
            <Estadisticas onCerrar={closeDashboard} onSesionMuerta={sesionMuerta}
                          colecciones={coleccionesDelPanel} />
          </Suspense>
          </ErrorBoundary>
        )}

        {preguntando && (
          <Pregunta
            nombre={preguntando.nombre}
            onElegir={responder}
            onCerrar={() => setPreguntando(null)}
          />
        )}
      </main>

      {/* Una franja al final, no una línea suelta sobre el papel. Arriba la cuenta y
          Salir, que es la acción de la cuenta; abajo, más callado, lo que se hace con
          la colección, que se usa poco. */}
      <footer className="pie">
        <div className="columna">
          <div className="pie-cuenta">
            {/* El role va en un envoltorio que está siempre: si el que apareciera y
                desapareciera fuera el propio role, el lector de pantalla no anunciaría
                nada. Así lo que cambia es el texto de adentro, que sí se lee. */}
            {/* "Fijate la conexión" sólo mientras NO hay conexión. Con la red de vuelta
                el dato seguía siendo cierto —los cambios siguen perdidos— pero como
                instrucción mandaba a mirar donde ya no estaba el problema. */}
            <span className="pie-estado" role="status">
              {fallidas.size ? (
                <span className="aviso">
                  {fallidas.size === 1
                    ? 'No se pudo guardar un cambio.'
                    : `No se pudieron guardar ${fallidas.size} cambios.`}
                  {' '}
                  {/* CUÁLES, no sólo cuántos. Con diez falladas entre 1936 cartas, la
                      única forma de encontrarlas era acordarse de cuáles tocaste. Ahora
                      se nombran acá y además quedan marcadas en la grilla. */}
                  <b className="cuales">{listaFallidas}</b>
                  {!enLinea && ' Fijate la conexión: se reintentan solos cuando vuelva.'}
                </span>
              ) : (
                <span className="guardando">Guardando en tu cuenta, <b>{cuenta.usuario}</b>, a cada cambio</span>
              )}
            </span>
            <span className="pie-acciones">
              <button onClick={() => setCambiandoClave(true)} className="enlace">Cambiar mi clave</button>
              <button onClick={cerrar} className="salir" disabled={saliendo}>
                {saliendo ? 'Saliendo…' : 'Salir'}
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
          <div className="pie-copias" aria-live="polite">
            <span className="pie-rotulo">Tu colección</span>
            <button onClick={exportar} className="enlace">Exportar</button>
            <button onClick={() => descargar(datos)} className="enlace">Bajar una copia</button>
            <input
              ref={archivoRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) restaurarCopia(f)
              ev.target.value = ''
              }}
            />
            <button onClick={() => archivoRef.current.click()} className="enlace">Restaurar una copia</button>
            {avisoArchivo && <span className="aviso-archivo">{avisoArchivo}</span>}
            {/* Sólo aparece si de verdad hay huérfanas, que hoy es nunca. No es un botón
                más de la app: es la única forma de sacar algo que quedó sin carta a la
                que tocarle. */}
            {huerfanas.length > 0 && (
              <span className="aviso-archivo">
                {huerfanas.length === 1
                  ? 'Tenés 1 carta que ya no está en el catálogo.'
                  : `Tenés ${huerfanas.length} cartas que ya no están en el catálogo.`}{' '}
                <button onClick={() => setSacando(true)} className="enlace">Sacarlas</button>
              </span>
            )}
          </div>
          <div className="pie-marca">
            <span className="pie-sitio">{SITIO}</span>
            <span className="pie-apoyo">
              ¿Te sirve? Podés apoyar al que la hizo · alias{' '}
              <button onClick={copiarAlias} className="alias" title="Tocá para copiarlo">
                {avisoAlias ?? ALIAS}
              </button>
            </span>
          </div>
        </div>
      </footer>

      {cambiandoClave && !cuenta?.mustChange && (
        <CambiarClave onCerrar={() => setCambiandoClave(false)} onSesionMuerta={sesionMuerta} />
      )}
      {profileOpen && !cuenta?.mustChange && (
        <ProfileDialog onClose={() => setProfileOpen(false)} onSesionMuerta={sesionMuerta} />
      )}
      {/* LA CLAVE PROVISORIA: obligatorio y sin salida hasta elegir una propia. Al
          terminar, apaga la marca en la cuenta local — la del servidor ya la apagó
          `/api/clave`. Fuera de `hayDialogo` a propósito: Atrás no lo cierra. */}
      {cuenta?.mustChange && (
        <CambiarClave forced onSesionMuerta={sesionMuerta}
                      onCerrar={() => setCuenta((c) => (c ? { ...c, mustChange: false } : c))} />
      )}

      {/* Fuera del pie: es una barra fija abajo, y sólo aparece en teléfono. */}
      {/* Los dos usan la misma barra y NO se pisan: `Instalar` se va apenas `comoApp()` es
          verdadero y `Reinstall` no aparece si no lo es. Son excluyentes por construcción,
          no por orden — si alguna vez se toca una de las dos condiciones, mirar la otra,
          porque las dos escriben `--alto-instalar` en el body. */}
      <Instalar />
      <Reinstall />
    </>
  )
}
