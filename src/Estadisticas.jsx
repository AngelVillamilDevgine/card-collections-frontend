// Los números para decidir qué hacer con la app. Sólo los ve quien esté en DBZ_ADMINS.
//
// Está ordenado por la pregunta que importa, que no es cuánta gente entró sino cuánta
// vuelve: arriba el embudo de "se anotó" a "volvió otro día", y recién después el
// detalle. Si alguna vez se cobra algo, se le cobra a los que vuelven.
import { useEffect, useState } from 'react'
import { estadisticas } from './almacenamiento'

const parte = (n, total) => (total ? Math.round((n / total) * 100) : 0)
const dia = (f) => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) : '—')

function Barra({ rotulo, valor, techo, nota, flaca }) {
  return (
    <div className={`renglon${flaca ? ' flaca' : ''}`}>
      <span className="renglon-rotulo">{rotulo}</span>
      <span className="riel">
        <span className="relleno" style={{ width: `${techo ? (valor / techo) * 100 : 0}%` }} />
      </span>
      <b>{valor}</b>
      <span className="renglon-nota">{nota ?? ''}</span>
    </div>
  )
}

export default function Estadisticas({ onCerrar }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    estadisticas().then(setDatos).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo numeros" role="dialog" aria-label="Estadísticas" onClick={(e) => e.stopPropagation()}>
        <h3>Los números</h3>
        {error && <p className="nada">{error}</p>}
        {!datos && !error && <p className="nada">Buscando…</p>}
        {datos && <Cuerpo d={datos} />}
        <button className="cancelar" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  )
}

function Cuerpo({ d }) {
  const { usuarios: u, cartas, porDia, tramos, gente } = d
  const pico = Math.max(1, ...porDia.map((x) => x.cuantos))
  const picoTramo = Math.max(1, ...tramos.map((x) => x.cuantos))

  return (
    <>
      {/* El embudo: de arriba a abajo se va cayendo gente. Donde más cae es el problema. */}
      <p>De cada persona que se anota, cuántas llegan hasta el final.</p>
      <div className="grupo">
        <Barra rotulo="Se anotaron" valor={u.total} techo={u.total} />
        <Barra rotulo="Cargaron cartas" valor={u.conCartas} techo={u.total} nota={`${parte(u.conCartas, u.total)}%`} />
        <Barra rotulo="Volvieron otro día" valor={u.volvieron} techo={u.total} nota={`${parte(u.volvieron, u.total)}%`} />
        <Barra rotulo="La instalaron" valor={u.conApp} techo={u.total} nota={`${parte(u.conApp, u.total)}%`} />
      </div>

      <p className="nada">
        «Volvieron» se cuenta por días de uso, no por veces que escribieron la clave —
        la sesión dura 30 días, así que casi nadie vuelve a escribirla. Lo anterior al
        18/09 queda corto: de antes sólo se sabe el día del alta y los días en que
        alguien entró de nuevo.
      </p>

      <div className="sueltos">
        <span><b>{u.altas7}</b> altas en 7 días</span>
        <span><b>{u.altasHoy}</b> hoy</span>
        <span><b>{u.activosHoy}</b> la usaron hoy</span>
        <span><b>{u.activos7}</b> en la semana</span>
        <span><b>{cartas.total.toLocaleString('es-AR')}</b> cartas marcadas</span>
        <span><b>{cartas.repetidas.toLocaleString('es-AR')}</b> repetidas</span>
      </div>

      <h4>Altas por día</h4>
      {porDia.length ? (
        <div className="grupo">
          {porDia.map((x) => <Barra key={x.dia} flaca rotulo={dia(x.dia)} valor={x.cuantos} techo={pico} />)}
        </div>
      ) : <p className="nada">Nadie se anotó en estos catorce días.</p>}

      <h4>Cuántas cartas tiene cada uno</h4>
      <div className="grupo">
        {tramos.map((x) => (
          <Barra key={x.tramo} rotulo={x.tramo} valor={x.cuantos} techo={picoTramo}
                 nota={`${parte(x.cuantos, u.total)}%`} />
        ))}
      </div>

      <h4>Uno por uno</h4>
      <div className="tablon">
        <table className="gente">
          <thead>
            <tr>
              <th>Cuenta</th><th>Alta</th><th>Última</th><th title="Días distintos en que usó la app">Días</th><th>Cartas</th><th>Álbum</th><th>Repes</th>
            </tr>
          </thead>
          <tbody>
            {gente.map((g) => (
              <tr key={g.usuario} className={g.cartas ? undefined : 'apagada'}>
                <td className="quien" title={g.usuario}>
                  {g.usuario}
                  {g.app && <span className="chip" title="Entra desde la app instalada">app</span>}
                </td>
                <td>{dia(g.alta)}</td>
                <td>{dia(g.ultima)}</td>
                <td>{g.dias}</td>
                <td>{g.cartas}</td>
                <td>{parte(g.cartas, d.total)}%</td>
                <td>{g.repetidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
