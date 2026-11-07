import { useEffect, useMemo, useRef } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'
import { finishGuide } from './collections'

/* Cómo se ve un acabado: su foto si el catálogo la tiene, si no un cuadrado de su color, y si
   no tiene ninguna de las dos —Común, Glitter círculos— sus letras. Lo comparten la tabla y el
   diálogo que pregunta qué variante tenés: es la misma respuesta a «¿cuál es el mío?». */
export function FinishThumb({ finish }) {
  if (finish.foto) return <img className="finish-thumb" src={finish.foto} alt="" loading="lazy" />
  if (finish.color) return <span className="finish-thumb" style={{ background: finish.color }} aria-hidden="true" />
  return <span className="finish-thumb plain" aria-hidden="true">{finish.corto}</span>
}

const SECTIONS = [
  { title: 'Con dibujo', test: (f) => !!f.foto },
  { title: 'Colores', test: (f) => !f.foto && !!f.color },
  { title: 'Sin foto', test: (f) => !f.foto && !f.color },
]

/* «ACABADOS»: la tabla de cuadrados con la foto de cada acabado de Leyenda, para reconocer el de
   la carta que tenés en la mano. La pidió Angel mirando la app de Ismael, que muestra una vista
   previa al elegir la variante. Es sólo para mirar: no marca nada. */
export default function FinishGuide({ expansions, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  useCloseOnEscape(onClose)
  /* El foco va al diálogo mismo y SIN scrollear: con el botón de abajo enfocado, la tabla (que es larga)
     se abría ya corrida hasta el final y no se veía ninguna foto. */
  useEffect(() => {
    box.current?.focus({ preventScroll: true })
    return trapFocus(box.current, prevFocus.current)
  }, [])
  const finishes = useMemo(() => finishGuide(expansions), [expansions])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Acabados de Leyenda"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Acabados de Leyenda</h3>
        <p>Así se ve cada acabado, para reconocer el de tu carta. Al lado, en cuántas cartas sale.</p>
        {SECTIONS.map(({ title, test }) => {
          const list = finishes.filter(test)
          if (!list.length) return null
          return (
            <section key={title} className="finish-section">
              <h4>{title}</h4>
              <ul className="finish-grid">
                {list.map((f) => (
                  <li key={f.id} className="finish-tile" title={f.expansiones.join(', ')}>
                    <FinishThumb finish={f} />
                    <b>{f.nombre}</b>
                    <small>{f.cartas === 1 ? '1 carta' : `${f.cartas} cartas`}</small>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <p className="exits">
          <button className="cancel" onClick={onClose}>Cerrar</button>
        </p>
      </div>
    </div>
  )
}
