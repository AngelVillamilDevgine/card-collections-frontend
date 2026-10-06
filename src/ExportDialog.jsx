// Una lista de texto para pegar donde quieras: qué me falta, qué me sobra, o las dos.
//
// Tres pasos, con el mismo diálogo que ya pregunta la condición de la carta:
// qué lista, de qué expansiones (se marcan varias), y el texto con el botón de copiar.
import { useEffect, useRef, useState } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'
import { slotsOf, slotKey, variantsFor, cardLabel } from './collections'
import { CONDITIONS } from './conditions'

const LIST_OPTIONS = [
  { id: 'missing',         label: 'Las que me faltan' },
  { id: 'duplicates',      label: 'Las repetidas' },
  { id: 'owned',           label: 'Las que ya tengo' },
  { id: 'missingVariants', label: 'Me faltan variantes', onlyWithVariants: true },
]

/* Cómo se lee cada condición adentro del título. No es el `label` del selector: ahí dice
   «Perfecta» porque califica a una carta, y acá tiene que caer después de «las que tengo».
   Son tres frases y viven al lado del título que las usa. */
const CONDITION_PHRASES = {
  bien: 'EN BUEN ESTADO',
  perfecta: 'PERFECTAS',
  reemplazar: 'PARA REEMPLAZAR',
}

/* Una carta que tenés sin condición cargada cuenta como «buen estado», que es lo mismo
   que hace `summary` en App.jsx con `conditionCounts[condition ?? 'bien']++`. Si no, las que vienen de
   una copia vieja —y todo Leyenda— no caerían en ningún cajón. */
const conditionOf = (e) => (CONDITIONS.some((x) => x.id === e) ? e : 'bien')

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
const printedLabel = cardLabel

/* LAS DOS LISTAS SE ARMAN SOBRE LOS CASILLEROS DEL HUECO, NO SOBRE LA CLAVE BASE, y eso
   no es un detalle: leyendo sólo `${exp.id}:${n}`, **una carta que tenés en variante
   salía en «ME FALTAN»**. O sea que el texto que se pega en el grupo de WhatsApp pedía
   cartas que ya tenés, y las repetidas de una variante no salían nunca — justo las que
   sirven para cambiar. En Leyenda, que es donde hay variantes, eso es casi todo.

   La cuenta es la misma que hace `summary` en App.jsx, y tiene que serlo o los números
   del diálogo no coinciden con los de la barra de filtros:

   - **falta** el hueco entero: ningún casillero con cantidad mayor que cero;
   - **sobran** POR CASILLERO: la 551 mate una y la 551 estrellada una son cero sobrantes,
     que es la verdad — no te sobra nada, tenés las dos.

   En Cromeros no hay variantes, así que `slotsOf` devuelve el único casillero de siempre
   y el texto sale byte por byte igual que antes. */
function listMissing(exp, quantities, variants) {
  const numbers = exp.cardNumbers.filter((n) =>
    slotsOf(exp, n, variants ?? exp.variantes ?? [], quantities)
      .every((s) => !((quantities[s.cardKey] ?? 0) > 0))
  )
  return { entries: numbers.map((n) => printedLabel(exp, n)), total: numbers.length }
}

/* Y LAS REPETIDAS DICEN EN QUÉ VARIANTE SOBRAN. Una repetida existe para cambiarla, y con
   ocho fondos posibles «me sobra una 824» no le sirve a nadie: el fondo es justo lo que
   el otro necesita saber. Es la pregunta simétrica a la de los faltantes.

   EN CROMEROS EL TEXTO NO CAMBIA UNA LETRA. Ahí no hay variantes, así que `slotsOf`
   devuelve el único casillero de siempre, no hay ninguna variante en juego y sale el
   `504x2` de toda la vida. Son 28 personas que ya leen ese formato. */
function listDuplicates(exp, quantities, variants) {
  const entries = []
  let total = 0
  for (const n of exp.cardNumbers) {
    // Tener 3 es que me sobran 2. Es lo mismo que cuenta el contador de "repetidas"
    // de arriba, así que los números coinciden.
    const spareSlots = []
    let spares = 0
    for (const s of slotsOf(exp, n, variants ?? exp.variantes ?? [], quantities)) {
      const quantity = quantities[s.cardKey] ?? 0
      if (quantity < 2) continue
      spareSlots.push({ variant: s.variant, count: quantity - 1 })
      spares += quantity - 1
    }
    if (spares <= 0) continue
    total += spares
    if (!spareSlots.some((x) => x.variant)) {
      entries.push(spares > 1 ? `${printedLabel(exp, n)}x${spares}` : printedLabel(exp, n))
      continue
    }
    /* «sin variante» es el casillero base cuando la carta SÍ tiene variantes declaradas:
       una fila de antes de que el catálogo supiera en cuáles sale. No es una variante
       inventado, es decir que no sabemos cuál es. */
    entries.push(`${printedLabel(exp, n)} · ` + spareSlots
      .map((x) => `${x.variant ? x.variant.nombre.toLowerCase() : 'sin variante'}${x.count > 1 ? ` x${x.count}` : ''}`)
      .join(', '))
  }
  return { entries, total }
}

/* ME FALTAN VARIANTES: las que YA TENÉS pero no en todos los fondos en que salieron.
 *
 * Sin esto, esas cartas no aparecían en ninguna lista. «Me faltan» las deja afuera porque
 * algo tenés, y no había dónde decir que te faltan los otros seis — Angel: *«¿qué pasa si
 * marco una variante de una carta que me viene en 8 variantes cuando comparto mis
 * faltantes?»*. Medido sobre lo que tenía cargado: eran 13 cartas y 78 variantes,
 * invisibles en las dos listas.
 *
 * SON DOS PREGUNTAS DISTINTAS Y POR ESO SON DOS LISTAS. «Necesito la carta» y «necesito
 * ese fondo» las contesta gente distinta, y el que lee el mensaje en el grupo no tiene
 * otra forma de saber cuál le estás haciendo. Los dos conjuntos no se pisan: una carta
 * que no tenés en ninguna variante va en «me faltan» y no acá.
 *
 * `total` cuenta VARIANTES y no cartas, que es lo que se está pidiendo. */
function listMissingVariants(exp, quantities) {
  const entries = []
  let total = 0
  for (const n of exp.cardNumbers) {
    const cardVariants = variantsFor(exp, n)
    if (!cardVariants.length) continue
    const owns = (v) => (quantities[slotKey(exp.id, n, v?.id)] ?? 0) > 0
    /* Si no tenés ninguno, la carta entera te falta: va en la otra lista. */
    if (!((quantities[slotKey(exp.id, n)] ?? 0) > 0) && !cardVariants.some(owns)) continue
    const missingVariants = cardVariants.filter((v) => !owns(v))
    if (!missingVariants.length) continue
    total += missingVariants.length
    entries.push(`${printedLabel(exp, n)} · ${missingVariants.map((v) => v.nombre.toLowerCase()).join(', ')}`)
  }
  return { entries, total }
}

/* LAS QUE YA TENGO. Es la lista que se pega para ofrecer, no para pedir, así que lo que
   importa es poder acotarla por condición: nadie ofrece las que tiene para reemplazar
   junto con las perfectas.

   Un hueco entra si ALGUNO de sus casilleros tiene algo y pasa el filtro — la misma
   cuenta que `listMissing`, dada vuelta. `conditionFilter` en `null` es «todas», y es también lo
   que llega de una colección que no usa condición, como Leyenda. */
function listOwned(exp, quantities, variants, conditionFilter, conditions) {
  const entries = []
  for (const n of exp.cardNumbers) {
    const isOwned = slotsOf(exp, n, variants ?? exp.variantes ?? [], quantities).some((s) => {
      if (!((quantities[s.cardKey] ?? 0) > 0)) return false
      return !conditionFilter || conditionFilter.has(conditionOf(conditions?.[s.cardKey]))
    })
    if (isOwned) entries.push(printedLabel(exp, n))
  }
  return { entries, total: entries.length }
}

/* El título dice CUÁLES, porque el que lo lee no tiene forma de saberlo de otro modo. */
const ownedTitle = (conditionFilter) => {
  if (!conditionFilter) return 'LAS QUE TENGO'
  const phrases = CONDITIONS.filter((e) => conditionFilter.has(e.id)).map((e) => CONDITION_PHRASES[e.id])
  return `LAS QUE TENGO ${phrases.join(' Y ')}`
}

/* Una estrella a cada lado del titulo de cada bloque. El texto se pega en un grupo de
   WhatsApp o de Facebook, donde un muro de numeros sin nada que lo corte no se lee.

   Es la estrella U+2B50 a proposito y no una mas moderna: esta en Unicode desde 2008 y
   la dibujan todos los telefonos, incluidos los Android viejos, asi que no hay forma
   de que le llegue a alguien como un cuadradito. Y va con el tema: las esferas del
   dragon se cuentan por estrellas. */
const STAR = '⭐'

/* EL PIE, que es la única parte del texto que no habla de cartas.
   Este texto se pega en un grupo de WhatsApp o de Facebook, donde lo lee gente que no
   sabe que la app existe: el pie es lo único que se lo dice. Va solo, en su propio
   renglón y al final, para que no compita con los números — y sin ninguna frase
   alrededor, porque cualquier cosa que le agregue es publicidad y la dirección sola ya
   dice todo lo que hay que decir.

   VA CON `https://` Y NO PELADA, y eso lo midió Angel el 2026-09-28 mandándose el mensaje a
   sí mismo: acá decía que «WhatsApp la convierte en enlace sin hacerle nada» y es falso.
   Sin el esquema no queda tocable —o queda como texto suelto, o el cliente la resuelve como
   `http://` y se come un 301 antes de llegar, comprobado contra producción— y encima no se
   arma la tarjeta con el título y la imagen, que es justo lo que el pie existe para
   conseguir. Es más feo de leer y vale la pena igual: el pie no está para que se lea, está
   para que se toque.

   Esto CAMBIA el texto de Cromeros, que hasta ahora salía byte por byte como siempre.
   Lo pidió Angel y es a propósito: son 28 personas que ya leen ese formato y ahora
   además ven de dónde sale. */
const FOOTER_URL = 'https://www.cromeros.com.ar'

const SECTIONS = {
  missing:         [{ title: 'ME FALTAN', list: listMissing }],
  duplicates:      [{ title: 'REPETIDAS', list: listDuplicates }],
  owned:           [{ title: ownedTitle, list: listOwned }],
  /* Un renglón por carta: «821 · azul, dorado, ...» pegado con comas al lado del
     siguiente no se lee. Es la única lista que lo necesita. */
  missingVariants: [{ title: 'ME FALTAN VARIANTES', list: listMissingVariants, onePerLine: true,
                      note: 'éstas ya las tengo, me faltan estos fondos' }],
}

/* Para el paso 2: sólo las expansiones que tienen algo que listar, con cuántas. */
function expansionsWithItems(mode, catalog, quantities, variantsByExpansion, conditionFilter, conditions) {
  const result = []
  for (const exp of catalog) {
    let count = 0
    for (const s of SECTIONS[mode]) count += s.list(exp, quantities, variantsByExpansion?.[exp.id], conditionFilter, conditions).total
    if (count) result.push({ exp, count })
  }
  return result
}

/* Las cartas van una por una, sin agrupar en rangos: así se pega y se lee derecho. */
function buildText(mode, selectedExpansions, catalog, quantities, heading, variantsByExpansion, conditionFilter, conditions) {
  const blocks = []
  for (const s of SECTIONS[mode]) {
    const lines = []
    let total = 0
    for (const exp of catalog) {
      if (!selectedExpansions.has(exp.id)) continue
      const { entries, total: expansionTotal } = s.list(exp, quantities, variantsByExpansion?.[exp.id], conditionFilter, conditions)
      if (!entries.length) continue
      total += expansionTotal
      /* Un renglón por carta cuando el texto lleva variantes. Pegados con comas,
         «821 · plata x2, 845 · plata» se lee como si la 845 fuera parte de la 821.
         Se decide MIRANDO EL TEXTO y no la colección: así Cromeros, donde nunca hay
         variantes, sigue saliendo en un renglón corrido como siempre. */
      const onePerLine = s.onePerLine || entries.some((t) => t.includes(' · '))
      lines.push(onePerLine
        ? `${exp.nombre}\n${entries.map((t) => `  ${t}`).join('\n')}`
        : `${exp.nombre}: ${entries.join(', ')}`)
    }
    if (lines.length) {
      const title = typeof s.title === 'function' ? s.title(conditionFilter) : s.title
      /* Una línea que diga qué contesta la lista. Sin ella el que la lee sigue
         adivinando si estás pidiendo la carta o sólo un fondo. */
      const note = s.note ? `\n${s.note}` : ''
      blocks.push(`${STAR} ${title} (${total}) ${STAR}${note}\n${lines.join('\n')}`)
    }
  }
  if (!blocks.length) return 'No hay nada para listar.'
  /* Una línea al principio diciendo de qué álbum es. Hace falta desde que hay dos: «me
     falta la 551» no significa lo mismo en uno que en otro. Cromeros no la lleva — su
     texto tiene que salir idéntico al de siempre. */
  const body = blocks.join('\n\n')
  const withHeading = heading ? `${heading}\n\n${body}` : body
  return `${withHeading}\n\n${FOOTER_URL}`
}

const Checkmark = ({ checked }) => (
  <span className={`check${checked ? ' on' : ''}`} aria-hidden="true">
    {checked && (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    )}
  </span>
)

export default function ExportDialog({ catalog, collectionData, variantsByExpansion, usesCondition, heading, onClose }) {
  const [mode, setMode] = useState(null)
  /* Arrancan las tres marcadas: lo más común es querer todo, y desmarcar es menos trabajo.
     `pickingConditions` es el paso de más que sólo tiene «las que ya tengo». */
  const [selectedConditions, setSelectedConditions] = useState(new Set(CONDITIONS.map((e) => e.id)))
  const [pickingConditions, setPickingConditions] = useState(false)
  const [selectedExpansions, setSelectedExpansions] = useState(new Set())
  const [showingText, setShowingText] = useState(false)
  const [copyStatus, setCopyStatus] = useState(null)
  const areaRef = useRef(null)
  /* El reloj del aviso de Copiar. Este diálogo se cierra con Escape, con el botón y
     tocando afuera, así que el timeout puede quedar corriendo con el diálogo ya
     desmontado — y entonces el setState no va a ninguna parte. */
  const copyTimerRef = useRef(null)
  const boxRef = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const previousFocusRef = useRef(document.activeElement)

  useCloseOnEscape(onClose)

  /* Una sola vez, al abrir: si colgara de `onClose` —una flecha nueva en cada render—
     volvería a capturar el foco de antes y al cerrar lo devolvería acá adentro. */
  useEffect(() => trapFocus(boxRef.current, previousFocusRef.current), [])
  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  const { cantidades: quantities, estados: conditions } = collectionData
  const hasVariants = catalog.some((e) => (e.grupos?.length ?? 0) > 0 || (e.variantes?.length ?? 0) > 0)

  /* `null` es «todas»: cuando están las tres marcadas, y siempre en una colección que no
     usa condición. Así el título no aclara algo que no acota nada. */
  const conditionFilter = mode === 'owned' && usesCondition && selectedConditions.size < CONDITIONS.length
    ? selectedConditions
    : null

  const expansions = mode && !pickingConditions
    ? expansionsWithItems(mode, catalog, quantities, variantsByExpansion, conditionFilter, conditions)
    : []
  const checkedExpansions = expansions.filter(({ exp }) => selectedExpansions.has(exp.id))
  const checkedTotal = checkedExpansions.reduce((a, e) => a + e.count, 0)
  const text = showingText
    ? buildText(mode, selectedExpansions, catalog, quantities, heading, variantsByExpansion, conditionFilter, conditions)
    : ''

  /* Cuántos huecos hay en cada condición, para que el selector no sea a ciegas. */
  const countOwnedWith = (id) => {
    const only = new Set([id])
    let n = 0
    for (const exp of catalog) n += listOwned(exp, quantities, variantsByExpansion?.[exp.id], only, conditions).total
    return n
  }

  /* Al elegir la lista arrancan todas marcadas: lo más común es querer todo, y
     desmarcar las que sobran es menos trabajo que marcar quince. */
  /* Al elegir las expansiones arrancan todas marcadas. Se calcula con las MISMAS
     variantes y el mismo filtro con que se va a dibujar la lista; sin eso, una expansión
     cuyas cartas tenés sólo en variante arrancaba desmarcada. */
  const selectAllWithItems = (id, nextFilter) =>
    setSelectedExpansions(new Set(
      expansionsWithItems(id, catalog, quantities, variantsByExpansion, nextFilter, conditions).map((e) => e.exp.id)
    ))

  function pickMode(id) {
    setMode(id)
    /* «Las que ya tengo» pregunta primero en qué condición — pero sólo si la colección
       tiene condición. En Leyenda no la hay: preguntar tendría una sola respuesta. */
    if (id === 'owned' && usesCondition) {
      setPickingConditions(true)
      return
    }
    setPickingConditions(false)
    selectAllWithItems(id, null)
  }

  function toggleCondition(id) {
    setSelectedConditions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirmConditions() {
    const nextFilter = selectedConditions.size < CONDITIONS.length ? selectedConditions : null
    setPickingConditions(false)
    selectAllWithItems('owned', nextFilter)
  }

  function toggleExpansion(id) {
    setSelectedExpansions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = expansions.length > 0 && checkedExpansions.length === expansions.length
  const toggleAll = () =>
    setSelectedExpansions(allChecked ? new Set() : new Set(expansions.map((e) => e.exp.id)))

  async function copyText() {
    // Se selecciona primero: si los dos caminos fallan, al menos queda listo para
    // copiar a mano en vez de un botón que no hace nada.
    areaRef.current?.focus()
    areaRef.current?.select()
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copiado')
    } catch {
      // El portapapeles moderno pide pestaña con foco y sitio seguro. Donde no se
      // puede, el de toda la vida todavía anda.
      setCopyStatus(document.execCommand?.('copy') ? 'Copiado' : 'Apretá Ctrl+C')
    }
    clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyStatus(null), 2000)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`dialog${showingText ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Exportar"
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Exportar</h3>

        {!mode && (
          <>
            <p>¿Qué lista querés?</p>
            {/* «Me faltan variantes» sólo aparece donde hay variantes. En Cromeros sería un
                botón que siempre contesta «no hay nada para listar». */}
            {LIST_OPTIONS.filter((o) => !o.onlyWithVariants || hasVariants).map((o, i) => (
              <button key={o.id} className="option simple" onClick={() => pickMode(o.id)} autoFocus={i === 0}>
                {o.label}
              </button>
            ))}
            <button className="cancel" onClick={onClose}>Cancelar</button>
          </>
        )}

        {pickingConditions && (
          <>
            <p>¿En qué estado? Tocá para marcar y desmarcar.</p>
            <div className="options">
              {CONDITIONS.map((e, i) => {
                const checked = selectedConditions.has(e.id)
                return (
                  <button
                    key={e.id}
                    className={`option simple selectable${checked ? ' checked' : ''}`}
                    onClick={() => toggleCondition(e.id)}
                    aria-pressed={checked}
                    autoFocus={i === 0}
                  >
                    <Checkmark checked={checked} />
                    {e.label}
                    <b>{countOwnedWith(e.id)}</b>
                  </button>
                )
              })}
            </div>
            <button className="show" onClick={confirmConditions} disabled={!selectedConditions.size}>
              {selectedConditions.size ? 'Seguir' : 'Marcá al menos uno'}
            </button>
            <div className="exits">
              <button className="cancel" onClick={() => { setPickingConditions(false); setMode(null) }}>
                Elegir otra lista
              </button>
              <button className="cancel" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}

        {mode && !pickingConditions && !showingText && (
          <>
            <p>¿De qué expansiones? Tocá para marcar y desmarcar.</p>
            {expansions.length ? (
              <>
                <div className="options">
                  <button
                    className={`option simple selectable${allChecked ? ' checked' : ''}`}
                    onClick={toggleAll}
                    aria-pressed={allChecked}
                    autoFocus
                  >
                    <Checkmark checked={allChecked} />
                    Todas
                  </button>
                  {expansions.map(({ exp, count }) => {
                    const checked = selectedExpansions.has(exp.id)
                    return (
                      <button
                        key={exp.id}
                        className={`option simple selectable${checked ? ' checked' : ''}`}
                        onClick={() => toggleExpansion(exp.id)}
                        aria-pressed={checked}
                      >
                        <Checkmark checked={checked} />
                        {exp.nombre}
                        <b>{count}</b>
                      </button>
                    )
                  })}
                </div>
                <button className="show" onClick={() => setShowingText(true)} disabled={!checkedExpansions.length}>
                  {checkedExpansions.length ? `Ver la lista · ${checkedTotal} cartas` : 'Marcá al menos una'}
                </button>
              </>
            ) : (
              <p className="nothing">No hay ninguna para listar.</p>
            )}
            <div className="exits">
              <button
                className="cancel"
                onClick={() => (mode === 'owned' && usesCondition ? setPickingConditions(true) : setMode(null))}
              >
                {mode === 'owned' && usesCondition ? 'Elegir otro estado' : 'Elegir otra lista'}
              </button>
              <button className="cancel" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}

        {showingText && (
          <>
            <p>Copiala y pegala donde quieras.</p>
            <textarea
              className="list"
              readOnly
              value={text}
              ref={areaRef}
              onFocus={(e) => e.target.select()}
            />
            <button className="option copy" onClick={copyText} autoFocus>
              {copyStatus ?? 'Copiar'}
            </button>
            <div className="exits">
              <button className="cancel" onClick={() => setShowingText(false)}>Elegir otras expansiones</button>
              <button className="cancel" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
