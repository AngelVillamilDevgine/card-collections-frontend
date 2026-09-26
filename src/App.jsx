import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ESTADOS, etiqueta, claseDe } from './estados'
import { atraparFoco, usarEscape } from './foco'
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
import { ErrorBoundary } from './boundary'
import { COLLECTIONS, DEFAULT_COLLECTION, readCollection, rememberCollection, loadCatalogs, slotKey, slotsOf, pointsToASlot } from './collections'
import {
  ErrorApi,
  descargar, restaurar, quienSoy, salir,
  leerColeccion, guardarCarta, reemplazarColeccion,
  cambiarClave, token, CLAVE_TOKEN,
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
const Carta = memo(function Carta({ clave, numero, variante, estado, cantidad, sinGuardar, onTocar, onMantener }) {
  const reloj = useRef(null)
  const fueLargo = useRef(false)  // ya pasaron los 420 ms: el click que venga no cuenta
  const cobrable = useRef(false)  // ...y además todavía se puede cobrar al soltar
  const origen = useRef(null)

  function apretar(e) {
    fueLargo.current = false
    cobrable.current = false
    origen.current = { x: e.clientX, y: e.clientY }
    reloj.current = setTimeout(() => {
      fueLargo.current = true
      cobrable.current = true
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
    if (!cobrable.current) return
    cobrable.current = false
    onMantener(clave)
  }

  /* El gesto se fue a otro lado: ni resta ni cuenta como toque. */
  function cancelar() {
    clearTimeout(reloj.current)
    origen.current = null
    cobrable.current = false
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

  const titulo = cantidad
    ? `${etiqueta(estado, cantidad)} · tenés ${cantidad}`
    : 'Me falta'
  /* El nombre de la variante va en la etiqueta hablada y el rótulo corto en la esquina.
     Con lector de pantalla, «Carta 551» dos veces seguidas no distingue nada. */
  const comoSeLlama = variante ? `Carta ${numero}, ${variante.nombre}` : `Carta ${numero}`

  /* Sin `title`: decía lo mismo que el aria-label, y varios lectores de pantalla leen la
     etiqueta y después la descripción, o sea «Carta 5. Me falta. Me falta» — 1936 veces.
     Lo que el title aportaba a la vista ya está pintado en la carta: el color es el
     estado y el número chico de la esquina es la cantidad. */
  return (
    <button
      className={`carta ${claseDe(estado, cantidad)}${sinGuardar ? ' sin-guardar' : ''}${variante ? ' variante' : ''}`}
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
      {numero}
      {variante && <b className="marca-variante">{variante.corto ?? variante.id.toUpperCase()}</b>}
      {cantidad > 1 && <b className="repes">{cantidad}</b>}
    </button>
  )
})

/* -------------------------------- diálogo --------------------------------- */

function Pregunta({ numero, onElegir, onCerrar }) {
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
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={`Carta ${numero}`} ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {numero}</h3>
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
   redeployar nada. La primera fila es la base: ahí vive todo lo que marcaste antes de que
   el vocabulario existiera, y es la respuesta honesta cuando no sabés cuál es.

   Cada opción muestra cuántas tenés de esa: sin eso, con tres fondos parecidos, no hay
   forma de acordarse de cuál ya cargaste. */
function AskVariant({ numero, variantes, cuentas, onElegir, onCerrar }) {
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
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={`Carta ${numero}`}
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {numero}</h3>
        <p>¿Cuál tenés?</p>
        {fila(null, 'Sin clasificar', true)}
        {variantes.map((v) => fila(v.id, v.nombre, false))}
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
function OrphansDialog({ keys, corTos, onConfirmar, onCerrar }) {
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  /* El `corto` de la expansión y no el número pelado: con dos colecciones, «551» no dice
     de cuál álbum es, y el diálogo existe justamente para que se vea de un vistazo que el
     problema es el catálogo y no la colección. */
  const numeros = keys.map((c) => {
    const [exp, n] = c.split(':')
    const corto = corTos?.[exp]
    return corto ? `${corto} ${n}` : c
  })
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
function CambiarClave({ onCerrar, onSesionMuerta }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState(null)
  const [listo, setListo] = useState(null)
  const [yendo, setYendo] = useState(false)
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)
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
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label="Cambiar mi clave"
           ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Cambiar mi clave</h3>
        {listo === null ? (
          <form className="entrar" onSubmit={enviar}>
            <p className="nota-dialogo">
              Al cambiarla se cierran las sesiones abiertas en otros aparatos. En éste seguís adentro.
            </p>
            <label>
              Tu clave de ahora
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
              {yendo ? 'Un segundo…' : 'Cambiarla'}
            </button>
            <button type="button" className="secundario" onClick={onCerrar}>Mejor no</button>
          </form>
        ) : (
          <>
            <p className="nota-dialogo" role="status">
              Listo, ya es la nueva.{' '}
              {listo === 0
                ? 'No había ninguna otra sesión abierta.'
                : listo === 1
                  ? 'Se cerró la sesión que había en otro aparato.'
                  : `Se cerraron las ${listo} sesiones que había en otros aparatos.`}
            </p>
            <button className="principal" onClick={onCerrar} autoFocus>Listo</button>
          </>
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
  const [sacando, setSacando] = useState(false)
  const [preguntandoVariante, setPreguntandoVariante] = useState(null)

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
        if (e?.sesion) { sesionMuerta(); return false }
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
      guardarCarta(clave, ultimo.cantidad, ultimo.estado, { keepalive: true }).catch(() => {})
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
    if (seVa) return Promise.resolve() // la página se va: no hay nada que esperar
    return Promise.all([...enVuelo.current.values()].map((p) => p.catch(() => {})))
  }

  /* La sesión murió: lo encolado ya no se puede mandar, y si se mandara podría salir con
     el token de OTRA cuenta que entre en esta misma pestaña. Se tira. */
  function matarCola() {
    for (const { reloj } of pendientes.current.values()) clearTimeout(reloj)
    pendientes.current.clear()
    porSalir.current.clear()
    enVuelo.current.clear()
  }

  function sesionMuerta(aviso) {
    matarCola()
    setAvisoSesion(aviso ?? 'Se venció tu sesión. Entrá de nuevo para seguir.')
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

  /* id de expansión -> su rótulo corto, de TODAS las colecciones: lo usa el diálogo de
     huérfanas y el listado de lo que no se pudo guardar. */
  const cortosPorExpansion = useMemo(() => {
    const m = {}
    for (const col of Object.values(catalogos ?? {}))
      for (const exp of col?.expansiones ?? []) m[exp.id] = exp.corto
    return m
  }, [catalogos])

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
        for (const { clave } of slotsOf(exp, n, exp.variantes, cantidades)) {
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
  }, [catalogo, estados, cantidades])

  /* La columna «Álbum» del panel es cuánto lleva cada uno de TODO lo que hay para
     marcar, no de la colección que yo esté mirando: `g.cartas` cuenta las filas de esa
     persona, que son las dos colecciones juntas. Con `resumen.total` dividiría 1936
     cartas por los 1097 huecos de Leyenda y daría 176%. */
  const cartasDeTodos = useMemo(() => {
    let n = 0
    for (const col of Object.values(catalogos ?? {}))
      for (const exp of col?.expansiones ?? []) n += exp.lista.length
    return n
  }, [catalogos])

  const hayQueExportar = (resumen?.tengo ?? 0) > 0

  /* Los números de las cartas que no se pudieron guardar. La clave es «expansión:número»,
     así que el número sale de ahí sin tener que buscar en el catálogo. Se nombran hasta
     seis: más que eso no se lee, y con esa cantidad el problema ya no es encontrarlas. */
  /* Con dos colecciones, «la 551» es ambiguo: hay una 551 en cada álbum. Así que a la
     que NO es de la colección que estás mirando se le antepone el rótulo corto de su
     expansión. A las de acá no, que son la mayoría y el número pelado se lee mejor. */
  const listaFallidas = useMemo(() => {
    if (!fallidas.size) return ''
    const deAca = new Set((catalogo ?? []).map((e) => e.id))
    const nombres = [...fallidas]
      .map((c) => {
        const [exp, n] = c.split(':')
        if (!Number.isFinite(Number(n))) return null
        return { n: Number(n), texto: deAca.has(exp) ? n : `${cortosPorExpansion[exp] ?? exp} ${n}` }
      })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n)
      .map((x) => x.texto)
    if (!nombres.length) return ''
    if (nombres.length <= 6) return `Son la ${nombres.join(', la ')}.`
    return `Son la ${nombres.slice(0, 6).join(', la ')} y ${nombres.length - 6} más.`
  }, [fallidas, catalogo, cortosPorExpansion])

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
       pregunta. Es la regla que ya regía: un toque sobre una carta que ya tenés no vuelve
       a preguntar porque «a la repetida no le corresponde un estado propio».

       Leyenda declara `condicion: false`, así que ahí no hay tres respuestas: hay una.
       Un toque la deja en 1 y listo. No es un gesto nuevo ni un camino aparte — es la
       misma regla aplicada a un caso que antes no existía. */
    if (!tiene) {
      if (!album?.condicion) return aplicar(clave, 1, null)
      return setPreguntando({ clave, numero })
    }
    /* Ya la tenés. En Cromeros eso es «suma una repetida» y no se pregunta nada, porque
       «a la repetida no le corresponde un estado propio». En una expansión CON variantes
       ese motivo es falso: a la repetida sí le corresponde algo propio, cuál de las dos
       es. Misma regla, caso distinto. */
    const hueco = huecoDe(clave)
    if (hueco?.exp.variantes.length) return setPreguntandoVariante(hueco)
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
            {cuenta.admin && (
              <button className="a-panel" onClick={openDashboard}>
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
            <div className="progreso">
              <div className="avance">
                <span className="grande">{resumen.tengo}</span>
                <span className="de">de {resumen.total} cartas</span>
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
          <p className="ayuda">
            Tocá para marcar · de nuevo si tenés otra igual · mantené apretado para restar
            {/* Con el teclado no hay «mantener apretado», así que si el atajo no se dice
                acá no se entera nadie. Se muestra sólo cuando hay teclado de verdad: en
                un teléfono es ruido. */}
            <span className="solo-teclado"> · con el teclado, Backspace</span>
          </p>

        {catalogo.map((exp) => {
          const activo = FILTROS.find((f) => f.id === filtro)
          /* Un hueco se dibuja si ALGUNO de sus casilleros pasa el filtro. */
          const visibles = exp.lista.filter((n) =>
            slotsOf(exp, n, exp.variantes, cantidades).some((s) =>
              activo.pasa(cantidades[s.clave] ?? 0, estados[s.clave])
            )
          )
          if (!visibles.length) return null

          /* Y la cuenta de la banda es de HUECOS, no de casilleros: «180 de 176» no
             significaría nada. */
          const tengoAca = exp.lista.filter((n) =>
            slotsOf(exp, n, exp.variantes, cantidades).some((s) => (cantidades[s.clave] ?? 0) > 0)
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
              <div className="grilla">
                {visibles.flatMap((n) =>
                  slotsOf(exp, n, exp.variantes, cantidades).map(({ clave, variante }) => (
                    <Carta
                      key={clave}
                      clave={clave}
                      numero={n}
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
            /* Sólo las colecciones que NO son la de siempre se anuncian. Cromeros sigue
               exportando exactamente el mismo texto que antes. */
            encabezado={coleccionViva === DEFAULT_COLLECTION ? null : (album?.coleccion ?? null)}
            onCerrar={() => setExportando(false)}
          />
        )}

        {preguntandoVariante && (
          <AskVariant
            numero={preguntandoVariante.n}
            variantes={preguntandoVariante.exp.variantes}
            cuentas={Object.fromEntries([
              ['', cantidades[slotKey(preguntandoVariante.exp.id, preguntandoVariante.n)] ?? 0],
              ...preguntandoVariante.exp.variantes.map((v) => [
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
            corTos={cortosPorExpansion}
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
          <Suspense fallback={
            <div className="telon">
              <div className="dialogo"><p className="nada">Buscando…</p></div>
            </div>
          }>
            <Estadisticas onCerrar={closeDashboard} onSesionMuerta={sesionMuerta}
                          totalCartas={cartasDeTodos} />
          </Suspense>
          </ErrorBoundary>
        )}

        {preguntando && (
          <Pregunta
            numero={preguntando.numero}
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
          <div className="pie-copias">
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
            {avisoArchivo && <span className="aviso-archivo" role="status">{avisoArchivo}</span>}
            {/* Sólo aparece si de verdad hay huérfanas, que hoy es nunca. No es un botón
                más de la app: es la única forma de sacar algo que quedó sin carta a la
                que tocarle. */}
            {huerfanas.length > 0 && (
              <span className="aviso-archivo" role="status">
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

      {cambiandoClave && (
        <CambiarClave onCerrar={() => setCambiandoClave(false)} onSesionMuerta={sesionMuerta} />
      )}

      {/* Fuera del pie: es una barra fija abajo, y sólo aparece en teléfono. */}
      <Instalar />
    </>
  )
}
