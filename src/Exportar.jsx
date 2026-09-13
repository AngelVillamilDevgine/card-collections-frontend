// Una lista de texto para pegar donde quieras: qué me falta, qué me sobra, o las dos.
//
// Tres pasos, con el mismo diálogo que ya pregunta la condición de la carta:
// qué lista, de qué expansión, y el texto con el botón de copiar.
import { useEffect, useRef, useState } from 'react'

const OPCIONES = [
  { id: 'falta',     label: 'Las que me faltan' },
  { id: 'repetidas', label: 'Las repetidas' },
  { id: 'ambas',     label: 'Las dos cosas' },
]

function faltantesDe(exp, cantidades) {
  const numeros = exp.lista.filter((n) => !cantidades[`${exp.id}:${n}`])
  return { textos: numeros.map(String), total: numeros.length }
}

function repetidasDe(exp, cantidades) {
  const textos = []
  let total = 0
  for (const n of exp.lista) {
    // Tener 3 es que me sobran 2. Es lo mismo que cuenta el "repetidas para cambiar"
    // de arriba, así que los números coinciden.
    const sobran = (cantidades[`${exp.id}:${n}`] ?? 0) - 1
    if (sobran <= 0) continue
    total += sobran
    textos.push(sobran > 1 ? `${n}x${sobran}` : `${n}`)
  }
  return { textos, total }
}

const SECCIONES = {
  falta:     [{ titulo: 'ME FALTAN', de: faltantesDe }],
  repetidas: [{ titulo: 'REPETIDAS PARA CAMBIAR', de: repetidasDe }],
  ambas:     [{ titulo: 'ME FALTAN', de: faltantesDe },
              { titulo: 'REPETIDAS PARA CAMBIAR', de: repetidasDe }],
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
function armar(modo, cuales, catalogo, cantidades) {
  const partes = []
  for (const s of SECCIONES[modo]) {
    const lineas = []
    let total = 0
    for (const exp of catalogo) {
      if (cuales !== 'todas' && exp.id !== cuales) continue
      const { textos, total: suma } = s.de(exp, cantidades)
      if (!textos.length) continue
      total += suma
      lineas.push(`${exp.nombre}: ${textos.join(', ')}`)
    }
    if (lineas.length) partes.push(`${s.titulo} (${total})\n${lineas.join('\n')}`)
  }
  return partes.join('\n\n') || 'No hay nada para listar.'
}

export default function Exportar({ catalogo, datos, onCerrar }) {
  const [modo, setModo] = useState(null)
  const [cuales, setCuales] = useState(null)
  const [aviso, setAviso] = useState(null)
  const areaRef = useRef(null)

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

  const { cantidades } = datos
  const expansiones = modo ? expansionesCon(modo, catalogo, cantidades) : []
  const enTotal = expansiones.reduce((a, e) => a + e.cuenta, 0)
  const texto = modo && cuales ? armar(modo, cuales, catalogo, cantidades) : ''

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
    setTimeout(() => setAviso(null), 2000)
  }

  return (
    <div className="telon" onClick={onCerrar}>
      <div
        className={`dialogo${cuales ? ' ancho' : ''}`}
        role="dialog"
        aria-label="Exportar"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Exportar</h3>

        {!modo && (
          <>
            <p>¿Qué lista querés?</p>
            {OPCIONES.map((o, i) => (
              <button key={o.id} className="opcion simple" onClick={() => setModo(o.id)} autoFocus={i === 0}>
                {o.label}
              </button>
            ))}
            <button className="cancelar" onClick={onCerrar}>Cancelar</button>
          </>
        )}

        {modo && !cuales && (
          <>
            <p>¿De qué expansión?</p>
            {expansiones.length ? (
              <div className="opciones">
                <button className="opcion simple" onClick={() => setCuales('todas')} autoFocus>
                  Todas <b>{enTotal}</b>
                </button>
                {expansiones.map(({ exp, cuenta }) => (
                  <button key={exp.id} className="opcion simple" onClick={() => setCuales(exp.id)}>
                    {exp.nombre} <b>{cuenta}</b>
                  </button>
                ))}
              </div>
            ) : (
              <p className="nada">No hay ninguna para listar.</p>
            )}
            <button className="cancelar" onClick={() => setModo(null)}>Elegir otra lista</button>
          </>
        )}

        {modo && cuales && (
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
            <button className="cancelar" onClick={() => setCuales(null)}>Elegir otra expansión</button>
          </>
        )}
      </div>
    </div>
  )
}
