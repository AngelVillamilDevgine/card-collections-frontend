import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ESTADOS, FALTA, etiqueta } from './estados'
import { atraparFoco } from './foco'
import Entrar from './Entrar'
import Exportar from './Exportar'
import Estadisticas from './Estadisticas'
import Instalar from './Instalar'
import {
  ErrorApi,
  descargar, restaurar, quienSoy, salir,
  leerColeccion, guardarCarta, reemplazarColeccion,
} from './almacenamiento'

function numerosDe(exp) {
  const out = []
  for (let n = exp.desde; n <= exp.hasta; n++) out.push(n)
  return out
}

/* Los tres listados que un coleccionista realmente necesita: qué buscar,
   qué puede cambiar y qué le conviene reemplazar. */
export const FILTROS = [
  { id: 'todas',      label: 'Todas',           pasa: () => true },
  { id: 'falta',      label: 'Me faltan',       pasa: (cant) => cant === 0 },
  { id: 'repetidas',  label: 'Repetidas',       pasa: (cant) => cant > 1 },
  { id: 'reemplazar', label: 'Para reemplazar', pasa: (cant, est) => cant > 0 && est === 'reemplazar' },
]

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
const Carta = memo(function Carta({ clave, numero, estado, cantidad, onTocar, onMantener }) {
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
    onMantener(clave) // si está en cero, `restar` no hace nada
  }

  const titulo = cantidad
    ? `${etiqueta(estado)} · tenés ${cantidad}`
    : 'Me falta'

  return (
    <button
      className={`carta ${cantidad ? estado : FALTA}`}
      title={titulo}
      aria-label={`Carta ${numero}. ${titulo}`}
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

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

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
function Reemplazar({ tengo, trae, onConfirmar, onCerrar }) {
  const caja = useRef(null)
  const abrio = useRef(document.activeElement)

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  const pierde = tengo - trae

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
  const [catalogo, setCatalogo] = useState(null)
  const [error, setError] = useState(null)
  // La cuenta entera, no el nombre: trae además si es administrador.
  const [cuenta, setCuenta] = useState(undefined) // undefined = todavía no sé
  const [datos, setDatos] = useState(VACIA)
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
  const [exportando, setExportando] = useState(false)
  const [viendoNumeros, setViendoNumeros] = useState(false)
  const [guiñando, setGuiñando] = useState(false)
  /* Cuándo exportó por última vez vive en un estado y no sólo en localStorage: así,
     al usarlo, el efecto de abajo se vuelve a correr y cancela los guiños que quedaban
     programados. Guardándolo sólo en localStorage seguía guiñando después de usarlo. */
  const [ultimoExporto, setUltimoExporto] = useState(leerExporto)
  const [plegadas, setPlegadas] = useState(leerPlegadas)
  const [avisoAlias, setAvisoAlias] = useState(null)

  useEffect(() => {
    try { localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...plegadas])) }
    catch { /* modo privado o sin lugar: se pierde al recargar, nada más */ }
  }, [plegadas])
  const archivoRef = useRef(null)
  /* Lo tocado que todavía no salió, por carta: el valor final y el reloj de la espera. */
  const pendientes = useRef(new Map())
  /* El último envío en vuelo de cada carta. El siguiente se encadena atrás de ése en vez
     de salir suelto: cuando el viaje tarda más que la espera —un celular con datos—
     quedaban dos PUT de la misma carta viajando juntos, y si llegaban al revés se
     guardaba el viejo después del nuevo. */
  const enVuelo = useRef(new Map())

  const { estados, cantidades } = datos

  useEffect(() => {
    fetch(new URL('data/expansiones.json', document.baseURI))
      .then((r) => r.json())
      .then((raw) => setCatalogo(raw.expansiones.map((e) => ({ ...e, lista: numerosDe(e) }))))
      .catch(() => setError('No se pudo cargar el catálogo de cartas.'))
  }, [intento])

  /* ¿El token guardado sigue sirviendo? Si no, se muestra la pantalla de entrada. */
  useEffect(() => { quienSoy().then((c) => setCuenta(c)) }, [])

  /* La colección es la del usuario: se pide al entrar y se olvida al salir. */
  useEffect(() => {
    setFallidas(new Set())
    if (!cuenta) return setDatos(VACIA)
    leerColeccion()
      .then(setDatos)
      // Si el token ya no sirve, a la pantalla de entrada: un cartel de error con un
      // solo botón de Salir no le sirve a nadie.
      .catch((e) => (e?.sesion ? sesionMuerta() : setError(e.message)))
  }, [cuenta, intento])

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
        if (e?.sesion) { sesionMuerta(); return false }
        if (seVa || intento >= REINTENTOS) return false
        await new Promise((r) => setTimeout(r, ESPERA_REINTENTO * (intento + 1)))
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

    const antes = enVuelo.current.get(clave) ?? Promise.resolve()
    const ahora = antes
      .catch(() => {})
      .then(() => despachar(clave, ultimo.cantidad, ultimo.estado, seVa))
      .then((bien) => {
        anotarFallo(clave, !bien)
        if (enVuelo.current.get(clave) === ahora) enVuelo.current.delete(clave)
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
    enVuelo.current.clear()
  }

  function sesionMuerta() {
    matarCola()
    setAvisoSesion('Se venció tu sesión. Entrá de nuevo para seguir.')
    setCuenta(null)
  }

  const vaciarRef = useRef(null)
  vaciarRef.current = vaciar

  /* Si cerrás la pestaña justo después de un toque, eso todavía no salió. */
  useEffect(() => {
    const alIrse = () => vaciarRef.current(true)
    addEventListener('pagehide', alIrse)
    return () => { removeEventListener('pagehide', alIrse); alIrse() }
  }, [])

  /* Cambiar una carta: primero se ve en pantalla, después sale para el servidor. */
  function aplicar(clave, cantidad, estado) {
    setDatos((d) => {
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
      return { estados: est, cantidades: cant }
    })
    mandar(clave, cantidad, cantidad > 0 ? estado : null)
  }

  const resumen = useMemo(() => {
    if (!catalogo) return null
    let total = 0, tengo = 0, sobrantes = 0
    const cuenta = { bien: 0, perfecta: 0, reemplazar: 0 }
    const porFiltro = Object.fromEntries(FILTROS.map((f) => [f.id, 0]))

    for (const exp of catalogo) {
      for (const n of exp.lista) {
        const clave = `${exp.id}:${n}`
        const cant = cantidades[clave] ?? 0
        const est = estados[clave]
        total++
        if (cant > 0) {
          tengo++
          sobrantes += cant - 1
          cuenta[est ?? 'bien']++
        }
        for (const f of FILTROS) if (f.pasa(cant, est)) porFiltro[f.id]++
      }
    }
    return { total, tengo, sobrantes, porFiltro, ...cuenta }
  }, [catalogo, estados, cantidades])

  const hayQueExportar = (resumen?.tengo ?? 0) > 0

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
    if (!cantidades[clave]) return setPreguntando({ clave, numero })
    aplicar(clave, cantidades[clave] + 1, estados[clave])
  }

  /* Mantener apretado: resta una. Al llegar a cero se olvida también la condición. */
  function restar(clave) {
    /* Si no la tenés no hay nada que restar. Sin esto salía un PUT con cantidad -1, el
       servidor lo rechazaba con un 400 y el pie pintaba "No se pudo guardar el último
       cambio. Fijate la conexión." por un gesto que la propia app sugiere —y sobre
       1597 de las 1936 cartas, que es el estado más común. Una falsa alarma de pérdida
       de datos hace que el usuario desconfíe de todo lo demás. */
    if (!cantidades[clave]) return
    aplicar(clave, cantidades[clave] - 1, estados[clave])
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
    setTimeout(() => setAvisoAlias(null), 2500)
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
    await Promise.race([
      vaciar(false).catch(() => {}),
      new Promise((r) => setTimeout(r, TECHO_SALIR)),
    ])
    await salir()
    matarCola()
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
    reemplazarColeccion(nueva)
      .then(() => {
        setDatos(nueva)
        // Se reemplazó todo: lo que no se había podido guardar carta por carta ya no
        // tiene sentido.
        pendientes.current.clear()
        setFallidas(new Set())
      })
      .catch((e) => {
        if (e?.sesion) return sesionMuerta()
        setAvisoArchivo(e.message ?? 'No se pudo reemplazar la colección.')
      })
  }

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
  if (!catalogo) return <div className="hoja"><p className="cargando">Cargando…</p></div>

  const pct = (n) => (n / resumen.total) * 100

  return (
    <>
      {/* Header, barra y footer van fuera de la columna de las cartas: así el fondo
          de cada franja llega de lado a lado y lo de adentro sigue alineado. */}
      <header className="encabezado">
        <div className="columna">
          <div className="marca">
              <h1>
                <img src="./logo.png" alt="Dragon Ball Z" width="660" height="168" />
              </h1>
              <p>Mi colección · Cartas Cromeros · 2007–2008</p>
          </div>
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
              <div className="barra">
                <span className="s-bien" style={{ width: `${pct(resumen.bien)}%` }} />
                <span className="s-perfecta" style={{ width: `${pct(resumen.perfecta)}%` }} />
                <span className="s-reemplazar" style={{ width: `${pct(resumen.reemplazar)}%` }} />
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
                  {f.label}
                  <b>{resumen.porFiltro[f.id]}</b>
                </button>
              ))}
            </div>

            {/* A mano en la barra fija: el botón del pie queda abajo de las 1936 cartas. */}
            <button
              className={`compartir${guiñando ? ' guiña' : ''}`}
              onClick={exportar}
              aria-label="Exportar"
              title="Exportar"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 8l5-5 5 5" />
                <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
            </button>
        </div>
      </div>

      <div className="hoja">
        {/* Fuera de la barra fija: son instrucciones, se leen una vez y pueden irse con
            el scroll. Adentro ocupaban dos renglones fijos en el celular. */}
          <p className="ayuda">
            Tocá para marcar · de nuevo si tenés otra igual · mantené apretado para restar
          </p>

        {catalogo.map((exp) => {
          const activo = FILTROS.find((f) => f.id === filtro)
          const visibles = exp.lista.filter((n) => {
            const clave = `${exp.id}:${n}`
            return activo.pasa(cantidades[clave] ?? 0, estados[clave])
          })
          if (!visibles.length) return null

          const tengoAca = exp.lista.filter((n) => cantidades[`${exp.id}:${n}`]).length
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
                {visibles.map((n) => {
                  const clave = `${exp.id}:${n}`
                  return (
                    <Carta
                      key={clave}
                      clave={clave}
                      numero={n}
                      estado={estados[clave]}
                      cantidad={cantidades[clave] ?? 0}
                      onTocar={alTocar}
                      onMantener={alMantener}
                    />
                  )
                })}
              </div>
              )}
            </section>
          )
        })}

        {resumen.porFiltro[filtro] === 0 && (
          <p className="vacio">No hay ninguna carta en este listado.</p>
        )}

        {exportando && (
          <Exportar catalogo={catalogo} datos={datos} onCerrar={() => setExportando(false)} />
        )}

        {porRestaurar && (
          <Reemplazar
            tengo={Object.keys(cantidades).length}
            trae={Object.keys(porRestaurar.cantidades).length}
            onConfirmar={confirmarReemplazo}
            onCerrar={() => setPorRestaurar(null)}
          />
        )}

        {viendoNumeros && (
          <Estadisticas onCerrar={() => setViendoNumeros(false)} onSesionMuerta={sesionMuerta} />
        )}

        {preguntando && (
          <Pregunta
            numero={preguntando.numero}
            onElegir={responder}
            onCerrar={() => setPreguntando(null)}
          />
        )}
      </div>

      {/* Una franja al final, no una línea suelta sobre el papel. Arriba la cuenta y
          Salir, que es la acción de la cuenta; abajo, más callado, lo que se hace con
          la colección, que se usa poco. */}
      <footer className="pie">
        <div className="columna">
          <div className="pie-cuenta">
            {/* El role va en un envoltorio que está siempre: si el que apareciera y
                desapareciera fuera el propio role, el lector de pantalla no anunciaría
                nada. Así lo que cambia es el texto de adentro, que sí se lee. */}
            <span className="pie-estado" role="status">
              {fallidas.size ? (
                <span className="aviso">
                  {fallidas.size === 1
                    ? 'No se pudo guardar un cambio. Fijate la conexión.'
                    : `No se pudieron guardar ${fallidas.size} cambios. Fijate la conexión.`}
                </span>
              ) : (
                <span className="guardando">Guardando en tu cuenta, <b>{cuenta.usuario}</b>, a cada cambio</span>
              )}
            </span>
            <span className="pie-acciones">
              {cuenta.admin && (
                <button onClick={() => setViendoNumeros(true)} className="enlace">Los números</button>
              )}
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

      {/* Fuera del pie: es una barra fija abajo, y sólo aparece en teléfono. */}
      <Instalar />
    </>
  )
}
