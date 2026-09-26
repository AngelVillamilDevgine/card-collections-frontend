// Una lista de texto para pegar donde quieras: qué me falta, qué me sobra, o las dos.
//
// Tres pasos, con el mismo diálogo que ya pregunta la condición de la carta:
// qué lista, de qué expansiones (se marcan varias), y el texto con el botón de copiar.
import { useEffect, useRef, useState } from 'react'
import { atraparFoco, usarEscape } from './foco'

const OPCIONES = [
  { id: 'falta',     label: 'Las que me faltan' },
  { id: 'repetidas', label: 'Las repetidas' },
  { id: 'ambas',     label: 'Las dos cosas' },
]

/* EL NÚMERO QUE SE IMPRIME LLEVA EL PREFIJO DE SU EXPANSIÓN, y sin eso el texto miente.
   En Leyenda, `ley-f` va de 504 a 513 y `ley-4` de 385 a 550: sin prefijo, dos cartas
   distintas salen con el mismo «504» en el mismo mensaje de WhatsApp, y el que lo lee no
   tiene cómo saber cuál le están pidiendo. Con prefijo son `F504` y `504`.

   Las cartas únicas no tienen número impreso —van con LOTE / EDICIÓN LIMITADA Nº /
   TOTAL— así que su prefijo es la palabra entera: «Leyenda 3».

   En Cromeros ninguna expansión tiene `prefijo`, así que su texto sale byte por byte igual
   que antes. Eso importa: son 28 personas que ya leen ese formato. */
const rotulo = (exp, n) => `${exp.prefijo ?? ''}${n}`

function faltantesDe(exp, cantidades) {
  const numeros = exp.lista.filter((n) => !cantidades[`${exp.id}:${n}`])
  return { textos: numeros.map((n) => rotulo(exp, n)), total: numeros.length }
}

function repetidasDe(exp, cantidades) {
  const textos = []
  let total = 0
  for (const n of exp.lista) {
    // Tener 3 es que me sobran 2. Es lo mismo que cuenta el contador de "repetidas"
    // de arriba, así que los números coinciden.
    const sobran = (cantidades[`${exp.id}:${n}`] ?? 0) - 1
    if (sobran <= 0) continue
    total += sobran
    textos.push(sobran > 1 ? `${rotulo(exp, n)}x${sobran}` : rotulo(exp, n))
  }
  return { textos, total }
}

/* Una estrella a cada lado del titulo de cada bloque. El texto se pega en un grupo de
   WhatsApp o de Facebook, donde un muro de numeros sin nada que lo corte no se lee.

   Es la estrella U+2B50 a proposito y no una mas moderna: esta en Unicode desde 2008 y
   la dibujan todos los telefonos, incluidos los Android viejos, asi que no hay forma
   de que le llegue a alguien como un cuadradito. Y va con el tema: las esferas del
   dragon se cuentan por estrellas. */
const ESTRELLA = '⭐'

const SECCIONES = {
  falta:     [{ titulo: 'ME FALTAN', de: faltantesDe }],
  repetidas: [{ titulo: 'REPETIDAS', de: repetidasDe }],
  ambas:     [{ titulo: 'ME FALTAN', de: faltantesDe },
              { titulo: 'REPETIDAS', de: repetidasDe }],
}

/* Para el paso 2: sólo las expansiones que tienen algo que listar, con cuántas. */
function expansionesCon(modo, catalogo, cantidades) {
  const salida = []
  for (const exp of catalogo) {
    let cuenta = 0
    for (const s of SECCIONES[modo]) cuenta += s.de(exp, cantidades).total
    if (cuenta) salida.push({ exp, cuenta })
  }
  return salida
}

/* Las cartas van una por una, sin agrupar en rangos: así se pega y se lee derecho. */
function armar(modo, elegidas, catalogo, cantidades, encabezado) {
  const partes = []
  for (const s of SECCIONES[modo]) {
    const lineas = []
    let total = 0
    for (const exp of catalogo) {
      if (!elegidas.has(exp.id)) continue
      const { textos, total: suma } = s.de(exp, cantidades)
      if (!textos.length) continue
      total += suma
      lineas.push(`${exp.nombre}: ${textos.join(', ')}`)
    }
    if (lineas.length)
      partes.push(`${ESTRELLA} ${s.titulo} (${total}) ${ESTRELLA}\n${lineas.join('\n')}`)
  }
  if (!partes.length) return 'No hay nada para listar.'
  /* Una línea al principio diciendo de qué álbum es. Hace falta desde que hay dos: «me
     falta la 551» no significa lo mismo en uno que en otro. Cromeros no la lleva — su
     texto tiene que salir idéntico al de siempre. */
  const cuerpo = partes.join('\n\n')
  return encabezado ? `${encabezado}\n\n${cuerpo}` : cuerpo
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

export default function Exportar({ catalogo, datos, encabezado, onCerrar }) {
  const [modo, setModo] = useState(null)
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

  const { cantidades } = datos
  const expansiones = modo ? expansionesCon(modo, catalogo, cantidades) : []
  const marcadas = expansiones.filter(({ exp }) => elegidas.has(exp.id))
  const enTotal = marcadas.reduce((a, e) => a + e.cuenta, 0)
  const texto = mostrando ? armar(modo, elegidas, catalogo, cantidades, encabezado) : ''

  /* Al elegir la lista arrancan todas marcadas: lo más común es querer todo, y
     desmarcar las que sobran es menos trabajo que marcar quince. */
  function elegirModo(id) {
    setModo(id)
    setElegidas(new Set(expansionesCon(id, catalogo, cantidades).map((e) => e.exp.id)))
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
            {OPCIONES.map((o, i) => (
              <button key={o.id} className="opcion simple" onClick={() => elegirModo(o.id)} autoFocus={i === 0}>
                {o.label}
              </button>
            ))}
            <button className="cancelar" onClick={onCerrar}>Cancelar</button>
          </>
        )}

        {modo && !mostrando && (
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
              <button className="cancelar" onClick={() => setModo(null)}>Elegir otra lista</button>
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
