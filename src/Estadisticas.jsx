// Los números para decidir qué hacer con la app. Sólo los ve quien esté en DBZ_ADMINS.
//
// Está ordenado por la pregunta que importa, que no es cuánta gente entró sino cuánta
// vuelve: arriba el embudo de "se anotó" a "volvió otro día", y recién después el
// detalle. Si alguna vez se cobra algo, se le cobra a los que vuelven.
import { useEffect, useRef, useState } from 'react'
import { atraparFoco, usarEscape } from './foco'
import { estadisticas } from './almacenamiento'
import './dashboard.css'

/* Con techo, y hace falta de verdad: `g.cartas` cuenta FILAS de esa persona y una carta
   que tengas en dos variantes son dos filas, mientras que el total son huecos del álbum.
   Sin el techo la columna «Álbum» puede pasarse de 100%, que se lee como un bug. */
const parte = (n, total) => (total ? Math.min(100, Math.round((n / total) * 100)) : 0)
const dia = (f) => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) : '—')

/* Hace cuánto, en palabras. El panel no tiene que hacer cuentas con husos: el servidor
   manda los minutos. */
function cuando(minutos) {
  if (minutos == null) return 'nunca'
  if (minutos < 90) return `hace ${Math.max(1, Math.round(minutos))} min`
  if (minutos < 60 * 36) return `hace ${Math.round(minutos / 60)} h`
  return `hace ${Math.round(minutos / 60 / 24)} días`
}

/* Cómo anda lo que corre FUERA de la app: el respaldo diario y el despliegue.

   Va arriba de todo y en silencio cuando está bien, porque sólo importa cuando está
   mal. Existe porque cuando esas dos cosas fallan no se entera nadie: el correo del
   servidor no sale —rebota antes de llegar a Gmail— y nadie mira los logs del VPS. La
   base es el único canal que ven los dos lados, así que ellos anotan ahí y esto lo lee.

   Si algo deja de correr, la fecha se pone vieja sola. Esa fecha vieja ES el aviso. */
function Salud({ salud }) {
  if (!salud) return null
  const dias = (m) => (m == null ? Infinity : m / 60 / 24)
  const r = salud.respaldo
  const d = salud.despliegue

  const cosas = [
    {
      que: 'Copia de la base',
      mal: !r || dias(r.hace) > 2,
      dice: r
        ? `${cuando(r.hace)} · ${Math.round((r.valor?.bytes ?? 0) / 1024)} KB · ${r.valor?.copias ?? '?'} guardadas`
        : 'nunca se anotó ninguna',
    },
    {
      que: 'Último despliegue',
      /* CUALQUIER estado que no sea «ok» va en rojo, y no sólo «descartado».
         `dbz-despliegue.sh` escribe cuatro estados y acá se miraba uno: un
         `dockerfile-sin-aprobar` —que es el portón puesto para que el Dockerfile de un
         commit no corra como root en la máquina de los clientes— se dibujaba en gris,
         idéntico a un deploy que salió bien. Y el correo del servidor no sale, así que
         este bloque es el único aviso que llega. Lista blanca y no negra: lo que no
         conocemos es sospechoso, no correcto. */
      mal: !!d && d.valor?.estado !== 'ok',
      dice: d
        ? `${cuando(d.hace)} · ${d.valor?.estado && d.valor.estado !== 'ok' ? `${d.valor.estado.toUpperCase()} ${d.valor?.commit ?? ''}`.trim() : d.valor?.commit ?? 'ok'}`
        : 'todavía no se anotó ninguno',
    },
  ]

  return (
    <div className={`salud${cosas.some((c) => c.mal) ? ' atencion' : ''}`}>
      {cosas.map((c) => (
        <span key={c.que} className={c.mal ? 'mal' : undefined}>
          <b>{c.que}:</b> {c.dice}
        </span>
      ))}
    </div>
  )
}

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

/* `totalCartas` llega del catálogo que la app ya tiene cargado, no del servidor. Antes
   venía en la respuesta como un 1936 escrito a mano en `estadisticas.js`: el catálogo se
   edita sin recompilar nada, así que el día que cambiara, la columna «Álbum» iba a
   calcular los porcentajes contra un número viejo sin que nada avisara. */
export default function Estadisticas({ onCerrar, onSesionMuerta, totalCartas }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const caja = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const abrio = useRef(document.activeElement)

  useEffect(() => {
    // Un 401 acá tiene que mandar a entrar de nuevo, igual que en el resto de la app,
    // y no pintar el error adentro del panel.
    estadisticas()
      .then(setDatos)
      .catch((e) => (e?.sesion ? onSesionMuerta?.() : setError(e.message)))
  }, [])

  usarEscape(onCerrar)

  /* Una sola vez, al abrir: si colgara de `onCerrar` —una flecha nueva en cada render—
     volvería a capturar el foco de antes y al cerrar lo devolvería acá adentro. */
  useEffect(() => atraparFoco(caja.current, abrio.current), [])

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo numeros" role="dialog" aria-modal="true" aria-label="Estadísticas" ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Los números</h3>
        {error && <p className="nada">{error}</p>}
        {!datos && !error && <p className="nada">Buscando…</p>}
        {datos && <Cuerpo d={datos} totalCartas={totalCartas} />}
        <button className="cancelar" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  )
}

function Cuerpo({ d, totalCartas }) {
  const { usuarios: u, cartas, porDia, tramos, gente } = d
  const pico = Math.max(1, ...porDia.map((x) => x.cuantos))
  const picoTramo = Math.max(1, ...tramos.map((x) => x.cuantos))

  return (
    <>
      <Salud salud={d.salud} />

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
      {/* La tabla va ordenada por cantidad de cartas, que es lo que sirve para decidir.
          Pero eso hunde al fondo a quien instaló la app y no cargó nada: con cuatro
          instalaciones, tres caían en las filas 2, 5 y 6 y la cuarta en la 25 de 28, así
          que mirando la tabla parecían tres y el embudo decía cuatro. Los números del
          embudo estaban bien —se comprobaron contra la base—; lo que engañaba era el
          orden. Este renglón dice de entrada cuántos son, así que la tabla ya no puede
          contradecir al embudo, y las filas de los que la instalaron van marcadas para
          poder encontrarlas sin recorrer las veintiocho. */}
      {/* Los tres números salen de los totales del servidor, NO de contar las filas de
          la tabla: la tabla puede venir cortada y entonces contarla mentiría. Es la
          misma lección del #97 al revés — una tabla que muestra una parte no puede ser
          la fuente de un total. */}
      <p className="resumen-tabla">
        {u.total} cuentas · {u.conCartas} con cartas ·{' '}
        <b>{u.conApp} entran desde la app</b>, marcadas abajo
        {u.total > gente.length && (
          <> · <i>se listan las {gente.length} con más cartas</i></>
        )}
      </p>
      <div className="tablon">
        <table className="gente">
          <thead>
            <tr>
              <th>Cuenta</th><th>Alta</th><th>Última</th><th title="Días distintos en que usó la app">Días</th><th>Cartas</th><th>Álbum</th><th>Repes</th>
            </tr>
          </thead>
          <tbody>
            {gente.map((g) => (
              <tr key={g.usuario}
                  className={[g.cartas ? '' : 'apagada', g.app ? 'con-app' : ''].filter(Boolean).join(' ') || undefined}>
                <td className="quien" title={g.usuario}>
                  {g.usuario}
                  {g.app && <span className="chip" title="Entra desde la app instalada">app</span>}
                </td>
                <td>{dia(g.alta)}</td>
                <td>{dia(g.ultima)}</td>
                <td>{g.dias}</td>
                <td>{g.cartas}</td>
                <td>{parte(g.cartas, totalCartas)}%</td>
                <td>{g.repetidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
