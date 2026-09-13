// Una lista de texto para pegar en un chat: qué me falta, qué me sobra, o las dos.
//
// Usa el mismo diálogo que la pregunta de la condición, en dos pasos: primero elegís
// qué lista, después aparece el texto con el botón de copiar.
import { useEffect, useRef, useState } from 'react'

const OPCIONES = [
  { id: 'falta',     label: 'Las que me faltan' },
  { id: 'repetidas', label: 'Las repetidas' },
  { id: 'ambas',     label: 'Las dos cosas' },
]

/* 77, 78, 79, 81 -> "77-79, 81". Sin esto, las que faltan son mil y pico de números
   sueltos y no hay chat que aguante esa lista. */
function rangos(numeros) {
  const partes = []
  for (let i = 0; i < numeros.length;) {
    let j = i
    while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] + 1) j++
    partes.push(i === j ? `${numeros[i]}` : `${numeros[i]}-${numeros[j]}`)
    i = j + 1
  }
  return partes.join(', ')
}

function faltantes(catalogo, cantidades) {
  const lineas = []
  let total = 0
  for (const exp of catalogo) {
    const numeros = exp.lista.filter((n) => !cantidades[`${exp.id}:${n}`])
    if (!numeros.length) continue
    total += numeros.length
    lineas.push(`${exp.nombre}: ${rangos(numeros)}`)
  }
  return lineas.length ? `ME FALTAN (${total})\n${lineas.join('\n')}` : 'No me falta ninguna.'
}

function repetidas(catalogo, cantidades) {
  const lineas = []
  let total = 0
  for (const exp of catalogo) {
    const textos = []
    for (const n of exp.lista) {
      // Tener 3 es que me sobran 2. Es lo mismo que cuenta el "repetidas para cambiar"
      // de arriba, así que los números coinciden.
      const sobran = (cantidades[`${exp.id}:${n}`] ?? 0) - 1
      if (sobran <= 0) continue
      total += sobran
      textos.push(sobran > 1 ? `${n}x${sobran}` : `${n}`)
    }
    if (textos.length) lineas.push(`${exp.nombre}: ${textos.join(', ')}`)
  }
  return lineas.length ? `REPETIDAS PARA CAMBIAR (${total})\n${lineas.join('\n')}` : 'No tengo repetidas.'
}

function armar(modo, catalogo, cantidades) {
  if (modo === 'falta') return faltantes(catalogo, cantidades)
  if (modo === 'repetidas') return repetidas(catalogo, cantidades)
  return `${faltantes(catalogo, cantidades)}\n\n${repetidas(catalogo, cantidades)}`
}

export default function Exportar({ catalogo, datos, onCerrar }) {
  const [modo, setModo] = useState(null)
  const [aviso, setAviso] = useState(null)
  const areaRef = useRef(null)

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

  const texto = modo ? armar(modo, catalogo, datos.cantidades) : ''

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
        className={`dialogo${modo ? ' ancho' : ''}`}
        role="dialog"
        aria-label="Exportar"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Exportar</h3>

        {!modo ? (
          <>
            <p>¿Qué lista querés?</p>
            {OPCIONES.map((o, i) => (
              <button key={o.id} className="opcion simple" onClick={() => setModo(o.id)} autoFocus={i === 0}>
                {o.label}
              </button>
            ))}
            <button className="cancelar" onClick={onCerrar}>Cancelar</button>
          </>
        ) : (
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
            <button className="cancelar" onClick={() => setModo(null)}>Elegir otra lista</button>
          </>
        )}
      </div>
    </div>
  )
}
