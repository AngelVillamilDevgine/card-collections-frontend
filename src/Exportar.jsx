// Una lista de texto para pegar donde quieras: qué me falta, qué me sobra, o las dos.
//
// Tres pasos, con el mismo diálogo que ya pregunta la condición de la carta:
// qué lista, de qué expansiones (se marcan varias), y el texto con el botón de copiar.
import { useEffect, useRef, useState } from 'react'
import { atraparFoco, usarEscape } from './foco'
import { slotsOf, slotKey, variantsFor, cardLabel } from './collections'
import { ESTADOS } from './estados'

const OPCIONES = [
  { id: 'falta',     label: 'Las que me faltan' },
  { id: 'repetidas', label: 'Las repetidas' },
  { id: 'ambas',     label: 'Las dos cosas' },
  { id: 'tengo',     label: 'Las que ya tengo' },
  { id: 'acabados',  label: 'Me faltan acabados', soloConVariantes: true },
]

/* Cómo se lee cada condición adentro del título. No es el `label` del selector: ahí dice
   «Perfecta» porque califica a una carta, y acá tiene que caer después de «las que tengo».
   Son tres frases y viven al lado del título que las usa. */
const COMO = {
  bien: 'EN BUEN ESTADO',
  perfecta: 'PERFECTAS',
  reemplazar: 'PARA REEMPLAZAR',
}

/* Una carta que tenés sin condición cargada cuenta como «buen estado», que es lo mismo
   que hace `resumen` en App.jsx con `cuenta[est ?? 'bien']++`. Si no, las que vienen de
   una copia vieja —y todo Leyenda— no caerían en ningún cajón. */
const condicionDe = (e) => (ESTADOS.some((x) => x.id === e) ? e : 'bien')

/* EL NÚMERO QUE SE IMPRIME LLEVA EL PREFIJO DE SU EXPANSIÓN, y sin eso el texto miente.
   En Leyenda, `ley-f` va de 504 a 513 y `ley-4` de 385 a 550: sin prefijo, dos cartas
   distintas salen con el mismo «504» en el mismo mensaje de WhatsApp, y el que lo lee no
   tiene cómo saber cuál le están pidiendo. Con prefijo son `F504` y `504`.

   Las cartas únicas no tienen número impreso —van con LOTE / EDICIÓN LIMITADA Nº /
   TOTAL— así que su prefijo es la palabra entera: «Leyenda 3».

   En Cromeros ninguna expansión tiene `prefijo`, así que su texto sale byte por byte igual
   que antes. Eso importa: son 28 personas que ya leen ese formato.

   Vive en `collections.js` porque la grilla y el diálogo dicen lo mismo: cómo se llama una
   carta es una sola respuesta, y tenerla en dos lados es como se desincronizó `numbersOf`. */
const rotulo = cardLabel

/* LAS DOS LISTAS SE ARMAN SOBRE LOS CASILLEROS DEL HUECO, NO SOBRE LA CLAVE BASE, y eso
   no es un detalle: leyendo sólo `${exp.id}:${n}`, **una carta que tenés en variante
   salía en «ME FALTAN»**. O sea que el texto que se pega en el grupo de WhatsApp pedía
   cartas que ya tenés, y las repetidas de una variante no salían nunca — justo las que
   sirven para cambiar. En Leyenda, que es donde hay variantes, eso es casi todo.

   La cuenta es la misma que hace `resumen` en App.jsx, y tiene que serlo o los números
   del diálogo no coinciden con los de la barra de filtros:

   - **falta** el hueco entero: ningún casillero con cantidad mayor que cero;
   - **sobran** POR CASILLERO: la 551 mate una y la 551 estrellada una son cero sobrantes,
     que es la verdad — no te sobra nada, tenés las dos.

   En Cromeros no hay variantes, así que `slotsOf` devuelve el único casillero de siempre
   y el texto sale byte por byte igual que antes. */
function faltantesDe(exp, cantidades, variantes) {
  const numeros = exp.lista.filter((n) =>
    slotsOf(exp, n, variantes ?? exp.variantes ?? [], cantidades)
      .every((s) => !((cantidades[s.clave] ?? 0) > 0))
  )
  return { textos: numeros.map((n) => rotulo(exp, n)), total: numeros.length }
}

/* Y LAS REPETIDAS DICEN EN QUÉ ACABADO SOBRAN. Una repetida existe para cambiarla, y con
   ocho fondos posibles «me sobra una 824» no le sirve a nadie: el fondo es justo lo que
   el otro necesita saber. Es la pregunta simétrica a la de los faltantes.

   EN CROMEROS EL TEXTO NO CAMBIA UNA LETRA. Ahí no hay acabados, así que `slotsOf`
   devuelve el único casillero de siempre, no hay ninguna variante en juego y sale el
   `504x2` de toda la vida. Son 28 personas que ya leen ese formato. */
function repetidasDe(exp, cantidades, variantes) {
  const textos = []
  let total = 0
  for (const n of exp.lista) {
    // Tener 3 es que me sobran 2. Es lo mismo que cuenta el contador de "repetidas"
    // de arriba, así que los números coinciden.
    const conSobrante = []
    let sobran = 0
    for (const s of slotsOf(exp, n, variantes ?? exp.variantes ?? [], cantidades)) {
      const cant = cantidades[s.clave] ?? 0
      if (cant < 2) continue
      conSobrante.push({ variante: s.variante, cuantas: cant - 1 })
      sobran += cant - 1
    }
    if (sobran <= 0) continue
    total += sobran
    if (!conSobrante.some((x) => x.variante)) {
      textos.push(sobran > 1 ? `${rotulo(exp, n)}x${sobran}` : rotulo(exp, n))
      continue
    }
    /* «sin acabado» es el casillero base cuando la carta SÍ tiene acabados declarados:
       una fila de antes de que el catálogo supiera en cuáles sale. No es un acabado
       inventado, es decir que no sabemos cuál es. */
    textos.push(`${rotulo(exp, n)} · ` + conSobrante
      .map((x) => `${x.variante ? x.variante.nombre.toLowerCase() : 'sin acabado'}${x.cuantas > 1 ? ` x${x.cuantas}` : ''}`)
      .join(', '))
  }
  return { textos, total }
}

/* ME FALTAN ACABADOS: las que YA TENÉS pero no en todos los fondos en que salieron.
 *
 * Sin esto, esas cartas no aparecían en ninguna lista. «Me faltan» las deja afuera porque
 * algo tenés, y no había dónde decir que te faltan los otros seis — Angel: *«¿qué pasa si
 * marco una variante de una carta que me viene en 8 variantes cuando comparto mis
 * faltantes?»*. Medido sobre lo que tenía cargado: eran 13 cartas y 78 acabados,
 * invisibles en las dos listas.
 *
 * SON DOS PREGUNTAS DISTINTAS Y POR ESO SON DOS LISTAS. «Necesito la carta» y «necesito
 * ese fondo» las contesta gente distinta, y el que lee el mensaje en el grupo no tiene
 * otra forma de saber cuál le estás haciendo. Los dos conjuntos no se pisan: una carta
 * que no tenés en ningún acabado va en «me faltan» y no acá.
 *
 * `total` cuenta ACABADOS y no cartas, que es lo que se está pidiendo. */
function faltanAcabadosDe(exp, cantidades) {
  const textos = []
  let total = 0
  for (const n of exp.lista) {
    const acabados = variantsFor(exp, n)
    if (!acabados.length) continue
    const tiene = (v) => (cantidades[slotKey(exp.id, n, v?.id)] ?? 0) > 0
    /* Si no tenés ninguno, la carta entera te falta: va en la otra lista. */
    if (!((cantidades[slotKey(exp.id, n)] ?? 0) > 0) && !acabados.some(tiene)) continue
    const sinTener = acabados.filter((v) => !tiene(v))
    if (!sinTener.length) continue
    total += sinTener.length
    textos.push(`${rotulo(exp, n)} · ${sinTener.map((v) => v.nombre.toLowerCase()).join(', ')}`)
  }
  return { textos, total }
}

/* LAS QUE YA TENGO. Es la lista que se pega para ofrecer, no para pedir, así que lo que
   importa es poder acotarla por condición: nadie ofrece las que tiene para reemplazar
   junto con las perfectas.

   Un hueco entra si ALGUNO de sus casilleros tiene algo y pasa el filtro — la misma
   cuenta que `faltantesDe`, dada vuelta. `filtro` en `null` es «todas», y es también lo
   que llega de una colección que no usa condición, como Leyenda. */
function tengoDe(exp, cantidades, variantes, filtro, estados) {
  const textos = []
  for (const n of exp.lista) {
    const hay = slotsOf(exp, n, variantes ?? exp.variantes ?? [], cantidades).some((s) => {
      if (!((cantidades[s.clave] ?? 0) > 0)) return false
      return !filtro || filtro.has(condicionDe(estados?.[s.clave]))
    })
    if (hay) textos.push(rotulo(exp, n))
  }
  return { textos, total: textos.length }
}

/* El título dice CUÁLES, porque el que lo lee no tiene forma de saberlo de otro modo. */
const tituloTengo = (filtro) => {
  if (!filtro) return 'LAS QUE TENGO'
  const cuales = ESTADOS.filter((e) => filtro.has(e.id)).map((e) => COMO[e.id])
  return `LAS QUE TENGO ${cuales.join(' Y ')}`
}

/* Una estrella a cada lado del titulo de cada bloque. El texto se pega en un grupo de
   WhatsApp o de Facebook, donde un muro de numeros sin nada que lo corte no se lee.

   Es la estrella U+2B50 a proposito y no una mas moderna: esta en Unicode desde 2008 y
   la dibujan todos los telefonos, incluidos los Android viejos, asi que no hay forma
   de que le llegue a alguien como un cuadradito. Y va con el tema: las esferas del
   dragon se cuentan por estrellas. */
const ESTRELLA = '⭐'

/* EL PIE, que es la única parte del texto que no habla de cartas.
   Este texto se pega en un grupo de WhatsApp o de Facebook, donde lo lee gente que no
   sabe que la app existe: el pie es lo único que se lo dice. Va solo, en su propio
   renglón y al final, para que no compita con los números — y sin ninguna frase
   alrededor, porque cualquier cosa que le agregue es publicidad y la dirección sola ya
   dice todo lo que hay que decir. WhatsApp la convierte en enlace sin hacerle nada.

   Esto CAMBIA el texto de Cromeros, que hasta ahora salía byte por byte como siempre.
   Lo pidió Angel y es a propósito: son 28 personas que ya leen ese formato y ahora
   además ven de dónde sale. */
const PIE = 'www.cromeros.com.ar'

const SECCIONES = {
  falta:     [{ titulo: 'ME FALTAN', de: faltantesDe }],
  repetidas: [{ titulo: 'REPETIDAS', de: repetidasDe }],
  ambas:     [{ titulo: 'ME FALTAN', de: faltantesDe },
              { titulo: 'REPETIDAS', de: repetidasDe }],
  tengo:     [{ titulo: tituloTengo, de: tengoDe }],
  /* Un renglón por carta: «821 · azul, dorado, ...» pegado con comas al lado del
     siguiente no se lee. Es la única lista que lo necesita. */
  acabados:  [{ titulo: 'ME FALTAN ACABADOS', de: faltanAcabadosDe, porRenglon: true,
                aclara: 'éstas ya las tengo, me faltan estos fondos' }],
}

/* Para el paso 2: sólo las expansiones que tienen algo que listar, con cuántas. */
function expansionesCon(modo, catalogo, cantidades, variantes, filtro, estados) {
  const salida = []
  for (const exp of catalogo) {
    let cuenta = 0
    for (const s of SECCIONES[modo]) cuenta += s.de(exp, cantidades, variantes?.[exp.id], filtro, estados).total
    if (cuenta) salida.push({ exp, cuenta })
  }
  return salida
}

/* Las cartas van una por una, sin agrupar en rangos: así se pega y se lee derecho. */
function armar(modo, elegidas, catalogo, cantidades, encabezado, variantes, filtro, estados) {
  const partes = []
  for (const s of SECCIONES[modo]) {
    const lineas = []
    let total = 0
    for (const exp of catalogo) {
      if (!elegidas.has(exp.id)) continue
      const { textos, total: suma } = s.de(exp, cantidades, variantes?.[exp.id], filtro, estados)
      if (!textos.length) continue
      total += suma
      /* Un renglón por carta cuando el texto lleva acabados. Pegados con comas,
         «821 · plata x2, 845 · plata» se lee como si la 845 fuera parte de la 821.
         Se decide MIRANDO EL TEXTO y no la colección: así Cromeros, donde nunca hay
         acabados, sigue saliendo en un renglón corrido como siempre. */
      const enRenglones = s.porRenglon || textos.some((t) => t.includes(' · '))
      lineas.push(enRenglones
        ? `${exp.nombre}\n${textos.map((t) => `  ${t}`).join('\n')}`
        : `${exp.nombre}: ${textos.join(', ')}`)
    }
    if (lineas.length) {
      const titulo = typeof s.titulo === 'function' ? s.titulo(filtro) : s.titulo
      /* Una línea que diga qué contesta la lista. Sin ella el que la lee sigue
         adivinando si estás pidiendo la carta o sólo un fondo. */
      const aclara = s.aclara ? `\n${s.aclara}` : ''
      partes.push(`${ESTRELLA} ${titulo} (${total}) ${ESTRELLA}${aclara}\n${lineas.join('\n')}`)
    }
  }
  if (!partes.length) return 'No hay nada para listar.'
  /* Una línea al principio diciendo de qué álbum es. Hace falta desde que hay dos: «me
     falta la 551» no significa lo mismo en uno que en otro. Cromeros no la lleva — su
     texto tiene que salir idéntico al de siempre. */
  const cuerpo = partes.join('\n\n')
  const conEncabezado = encabezado ? `${encabezado}\n\n${cuerpo}` : cuerpo
  return `${conEncabezado}\n\n${PIE}`
}

const Tilde = ({ marcada }) => (
  <span className={`tilde${marcada ? ' si' : ''}`} aria-hidden="true">
    {marcada && (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    )}
  </span>
)

export default function Exportar({ catalogo, datos, variantes, condicion, encabezado, onCerrar }) {
  const [modo, setModo] = useState(null)
  /* Arrancan las tres marcadas: lo más común es querer todo, y desmarcar es menos trabajo.
     `eligiendoCondicion` es el paso de más que sólo tiene «las que ya tengo». */
  const [condiciones, setCondiciones] = useState(new Set(ESTADOS.map((e) => e.id)))
  const [eligiendoCondicion, setEligiendoCondicion] = useState(false)
  const [elegidas, setElegidas] = useState(new Set())
  const [mostrando, setMostrando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const areaRef = useRef(null)
  /* El reloj del aviso de Copiar. Este diálogo se cierra con Escape, con el botón y
     tocando afuera, así que el timeout puede quedar corriendo con el diálogo ya
     desmontado — y entonces el setState no va a ninguna parte. */
  const relojAviso = useRef(null)
  const caja = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const abrio = useRef(document.activeElement)

  usarEscape(onCerrar)

  /* Una sola vez, al abrir: si colgara de `onCerrar` —una flecha nueva en cada render—
     volvería a capturar el foco de antes y al cerrar lo devolvería acá adentro. */
  useEffect(() => atraparFoco(caja.current, abrio.current), [])
  useEffect(() => () => clearTimeout(relojAviso.current), [])

  const { cantidades, estados } = datos
  const hayAcabados = catalogo.some((e) => (e.grupos?.length ?? 0) > 0 || (e.variantes?.length ?? 0) > 0)

  /* `null` es «todas»: cuando están las tres marcadas, y siempre en una colección que no
     usa condición. Así el título no aclara algo que no acota nada. */
  const filtro = modo === 'tengo' && condicion && condiciones.size < ESTADOS.length
    ? condiciones
    : null

  const expansiones = modo && !eligiendoCondicion
    ? expansionesCon(modo, catalogo, cantidades, variantes, filtro, estados)
    : []
  const marcadas = expansiones.filter(({ exp }) => elegidas.has(exp.id))
  const enTotal = marcadas.reduce((a, e) => a + e.cuenta, 0)
  const texto = mostrando
    ? armar(modo, elegidas, catalogo, cantidades, encabezado, variantes, filtro, estados)
    : ''

  /* Cuántos huecos hay en cada condición, para que el selector no sea a ciegas. */
  const cuantasCon = (id) => {
    const solo = new Set([id])
    let n = 0
    for (const exp of catalogo) n += tengoDe(exp, cantidades, variantes?.[exp.id], solo, estados).total
    return n
  }

  /* Al elegir la lista arrancan todas marcadas: lo más común es querer todo, y
     desmarcar las que sobran es menos trabajo que marcar quince. */
  /* Al elegir las expansiones arrancan todas marcadas. Se calcula con las MISMAS
     variantes y el mismo filtro con que se va a dibujar la lista; sin eso, una expansión
     cuyas cartas tenés sólo en variante arrancaba desmarcada. */
  const marcarTodasLasQueTienen = (id, elFiltro) =>
    setElegidas(new Set(
      expansionesCon(id, catalogo, cantidades, variantes, elFiltro, estados).map((e) => e.exp.id)
    ))

  function elegirModo(id) {
    setModo(id)
    /* «Las que ya tengo» pregunta primero en qué condición — pero sólo si la colección
       tiene condición. En Leyenda no la hay: preguntar tendría una sola respuesta. */
    if (id === 'tengo' && condicion) {
      setEligiendoCondicion(true)
      return
    }
    setEligiendoCondicion(false)
    marcarTodasLasQueTienen(id, null)
  }

  function alternarCondicion(id) {
    setCondiciones((antes) => {
      const ahora = new Set(antes)
      if (ahora.has(id)) ahora.delete(id)
      else ahora.add(id)
      return ahora
    })
  }

  function seguirDesdeCondicion() {
    const elFiltro = condiciones.size < ESTADOS.length ? condiciones : null
    setEligiendoCondicion(false)
    marcarTodasLasQueTienen('tengo', elFiltro)
  }

  function alternar(id) {
    setElegidas((antes) => {
      const ahora = new Set(antes)
      if (ahora.has(id)) ahora.delete(id)
      else ahora.add(id)
      return ahora
    })
  }

  const todasMarcadas = expansiones.length > 0 && marcadas.length === expansiones.length
  const alternarTodas = () =>
    setElegidas(todasMarcadas ? new Set() : new Set(expansiones.map((e) => e.exp.id)))

  async function copiar() {
    // Se selecciona primero: si los dos caminos fallan, al menos queda listo para
    // copiar a mano en vez de un botón que no hace nada.
    areaRef.current?.focus()
    areaRef.current?.select()
    try {
      await navigator.clipboard.writeText(texto)
      setAviso('Copiado')
    } catch {
      // El portapapeles moderno pide pestaña con foco y sitio seguro. Donde no se
      // puede, el de toda la vida todavía anda.
      setAviso(document.execCommand?.('copy') ? 'Copiado' : 'Apretá Ctrl+C')
    }
    clearTimeout(relojAviso.current)
    relojAviso.current = setTimeout(() => setAviso(null), 2000)
  }

  return (
    <div className="telon" onClick={onCerrar}>
      <div
        className={`dialogo${mostrando ? ' ancho' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Exportar"
        ref={caja}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Exportar</h3>

        {!modo && (
          <>
            <p>¿Qué lista querés?</p>
            {/* «Me faltan acabados» sólo aparece donde hay acabados. En Cromeros sería un
                botón que siempre contesta «no hay nada para listar». */}
            {OPCIONES.filter((o) => !o.soloConVariantes || hayAcabados).map((o, i) => (
              <button key={o.id} className="opcion simple" onClick={() => elegirModo(o.id)} autoFocus={i === 0}>
                {o.label}
              </button>
            ))}
            <button className="cancelar" onClick={onCerrar}>Cancelar</button>
          </>
        )}

        {eligiendoCondicion && (
          <>
            <p>¿En qué estado? Tocá para marcar y desmarcar.</p>
            <div className="opciones">
              {ESTADOS.map((e, i) => {
                const marcada = condiciones.has(e.id)
                return (
                  <button
                    key={e.id}
                    className={`opcion simple elegible${marcada ? ' marcada' : ''}`}
                    onClick={() => alternarCondicion(e.id)}
                    aria-pressed={marcada}
                    autoFocus={i === 0}
                  >
                    <Tilde marcada={marcada} />
                    {e.label}
                    <b>{cuantasCon(e.id)}</b>
                  </button>
                )
              })}
            </div>
            <button className="ver" onClick={seguirDesdeCondicion} disabled={!condiciones.size}>
              {condiciones.size ? 'Seguir' : 'Marcá al menos uno'}
            </button>
            <div className="salidas">
              <button className="cancelar" onClick={() => { setEligiendoCondicion(false); setModo(null) }}>
                Elegir otra lista
              </button>
              <button className="cancelar" onClick={onCerrar}>Cerrar</button>
            </div>
          </>
        )}

        {modo && !eligiendoCondicion && !mostrando && (
          <>
            <p>¿De qué expansiones? Tocá para marcar y desmarcar.</p>
            {expansiones.length ? (
              <>
                <div className="opciones">
                  <button
                    className={`opcion simple elegible${todasMarcadas ? ' marcada' : ''}`}
                    onClick={alternarTodas}
                    aria-pressed={todasMarcadas}
                    autoFocus
                  >
                    <Tilde marcada={todasMarcadas} />
                    Todas
                  </button>
                  {expansiones.map(({ exp, cuenta }) => {
                    const marcada = elegidas.has(exp.id)
                    return (
                      <button
                        key={exp.id}
                        className={`opcion simple elegible${marcada ? ' marcada' : ''}`}
                        onClick={() => alternar(exp.id)}
                        aria-pressed={marcada}
                      >
                        <Tilde marcada={marcada} />
                        {exp.nombre}
                        <b>{cuenta}</b>
                      </button>
                    )
                  })}
                </div>
                <button className="ver" onClick={() => setMostrando(true)} disabled={!marcadas.length}>
                  {marcadas.length ? `Ver la lista · ${enTotal} cartas` : 'Marcá al menos una'}
                </button>
              </>
            ) : (
              <p className="nada">No hay ninguna para listar.</p>
            )}
            <div className="salidas">
              <button
                className="cancelar"
                onClick={() => (modo === 'tengo' && condicion ? setEligiendoCondicion(true) : setModo(null))}
              >
                {modo === 'tengo' && condicion ? 'Elegir otro estado' : 'Elegir otra lista'}
              </button>
              <button className="cancelar" onClick={onCerrar}>Cerrar</button>
            </div>
          </>
        )}

        {mostrando && (
          <>
            <p>Copiala y pegala donde quieras.</p>
            <textarea
              className="lista"
              readOnly
              value={texto}
              ref={areaRef}
              onFocus={(e) => e.target.select()}
            />
            <button className="opcion copiar" onClick={copiar} autoFocus>
              {aviso ?? 'Copiar'}
            </button>
            <div className="salidas">
              <button className="cancelar" onClick={() => setMostrando(false)}>Elegir otras expansiones</button>
              <button className="cancelar" onClick={onCerrar}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
