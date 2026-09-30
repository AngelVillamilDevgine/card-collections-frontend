// Los números para decidir qué hacer con la app. Sólo los ve quien esté en DBZ_ADMINS.
//
// Está ordenado por la pregunta que importa, que no es cuánta gente entró sino cuánta
// vuelve: arriba el embudo de "se anotó" a "volvió otro día", y recién después el
// detalle. Si alguna vez se cobra algo, se le cobra a los que vuelven.
import { useEffect, useMemo, useRef, useState } from 'react'
import { usarEscape, usarAtras, atraparFoco } from './foco'
import { estadisticas, resetUserPassword } from './almacenamiento'
import { albumPercent } from './collections'
import { isStale } from './health'
import './dashboard.css'

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
  const r = salud.respaldo
  const d = salud.despliegue
  const p = salud.restauracion

  const cosas = [
    {
      que: 'Copia de la base',
      mal: isStale(r, 'respaldo'),
      dice: r
        ? `${cuando(r.hace)} · ${Math.round((r.valor?.bytes ?? 0) / 1024)} KB · ${r.valor?.copias ?? '?'} guardadas`
        : 'nunca se anotó ninguna',
    },
    {
      /* TENER COPIAS NO ES LO MISMO QUE PODER RESTAURARLAS, y ése es el renglón que
         faltaba. El de arriba dice que el archivo se escribió; éste dice que se
         restauró de verdad, en una base aparte, con todas sus tablas y ninguna vacía.

         El timer es semanal, así que el umbral son 10 días: uno saltado no alarma, dos
         sí. Y `dbz-probar-restauracion.sh` anota SÓLO cuando la prueba pasa — si falla,
         no toca la fecha, así que esto se pone rojo solo. Un fracaso anotado con la
         fecha de hoy dejaría el panel en verde con una copia que no sirve. */
      que: 'Se restaura de verdad',
      mal: isStale(p, 'restauracion'),
      dice: p
        ? `${cuando(p.hace)} · ${p.valor?.tablas ?? '?'} tablas · ${(p.valor?.cartas ?? 0).toLocaleString('es-AR')} cartas`
        : 'nunca se probó',
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

/* UN CUADRO. Lo pidió Angel: «los contadores son unos textos, deberían ser unos cuadros o
   algo». El número primero y grande, el rótulo abajo explicándolo, y sólo si hay
   denominador un medidor fino con el «de N» — porque «7» no dice nada sin saber de cuántos.

   Sin sombra, sin gradiente, sin ícono y sin un color por métrica: eso es lo que hacía que
   la primera versión de la app gritara «hecho con IA», y el CLAUDE.md lo sigue prohibiendo
   aunque las cajas ahora estén permitidas. Lo que separa un cuadro del papel es un borde
   de un píxel. */
function Cuadro({ valor, rotulo, de, pie, chico }) {
  const parteDe = de ? Math.min(100, (valor / de) * 100) : null
  return (
    <div className={`cuadro${chico ? ' chico' : ''}`}>
      <b>{valor.toLocaleString('es-AR')}</b>
      <span className="cuadro-rotulo">{rotulo}</span>
      {parteDe != null && (
        <>
          {/* `min-width` para que «1 de 40» se vea: sin eso, una raya de 2.5% no se dibuja
              y el cuadro parece vacío. El relleno va en `--acento` y no en `--naranja`
              porque contra el riel tiene que llegar a 3:1, que es lo que pide un elemento
              no textual que informa. */}
          <span className="medidor"><span style={{ width: `${parteDe}%` }} /></span>
          <span className="cuadro-pie">de {de.toLocaleString('es-AR')}</span>
        </>
      )}
      {pie && parteDe == null && <span className="cuadro-pie">{pie}</span>}
    </div>
  )
}

/* ACÁ VIVIÓ «DÍA POR DÍA» (el ritmo: las series diarias alineadas) Y SE EXTINGUIÓ el
   2026-09-30, por pedido de Angel: con el filtro de período más el «antes» espejo de
   cada estación, la serie diaria era la forma de ver ventanas de cuando no había
   ventanas. El servidor sigue mandando `actividad`, `porDia` y `visitors.days` — sacar
   un campo de la respuesta es un cambio en dos pasos y éste es el primero. */

/* Cómo se llama cada aparato. La clasificación gruesa la hace el servidor sobre el
   User-Agent (sin guardarlo crudo); acá sólo se le pone nombre. */
/* «Sin identificar» y no «Otro»: es lo que pasó de verdad — el servidor no pudo decir
   qué aparato era. Desde el 2026-09-30 el clasificador reconoce Linux, ChromeOS, TV y
   consolas, saca a los robots, y deja en el log de la API el UA de lo que no reconozca,
   así que este renglón debería quedar vacío o casi. Los tres primeros sin identificar
   son anteriores a eso y no hay registro de qué fueron. */
const DEVICE_NAMES = {
  iphone: 'iPhone', android: 'Android', windows: 'Windows', mac: 'Mac', ipad: 'iPad',
  linux: 'Linux', chromeos: 'ChromeOS', tv: 'Smart TV', consola: 'Consola',
  otro: 'Sin identificar',
}

/* Un color FIJO por aparato, no por posición: así Android es dorado en «Hoy» y en «Mes
   pasado» aunque cambie el orden. Salen de la paleta del panel y de la cinta holo; todos
   pasan 3:1 contra el fondo de la tarjeta (el gris de «Otro», el más justo, da 4.3). El
   color no es el único canal: la leyenda lleva nombre, número y porcentaje. */
const DEVICE_COLORS = {
  android: '#e6b13c', iphone: '#7fa8e6', windows: '#7fd0c0',
  mac: '#c78fd6', ipad: '#f3ead7', linux: '#f08a5d', chromeos: '#9ed27e',
  tv: '#f28ab2', consola: '#b8c1d1', otro: '#8d8a7c',
}

/* LA TORTA — una dona en SVG con el truco del `stroke-dasharray`: con r = 15.9155 la
   circunferencia mide 100, así que cada tramo se dibuja con su porcentaje tal cual. Sin
   librería de gráficos: son veinte líneas y el panel viaja en su propio chunk. Arranca
   arriba (offset 25) y gira en el sentido del reloj. Entre tramos queda una ranura de
   0.8 para que dos colores vecinos no se fundan; con un solo aparato, círculo entero. */
function Pie({ rows, total }) {
  const R = 15.9155
  const gap = rows.length > 1 ? 0.8 : 0
  let acc = 0
  const segs = rows.map((r) => {
    const pct = (r.n / total) * 100
    const seg = { ...r, len: Math.max(0.4, pct - gap), offset: 25 - acc }
    acc += pct
    return seg
  })
  const summary = rows.map((r) => `${DEVICE_NAMES[r.device] ?? r.device} ${r.n}`).join(', ')
  return (
    <svg className="devices-pie" viewBox="0 0 42 42" role="img"
         aria-label={`${total} visitantes: ${summary}`}>
      <circle cx="21" cy="21" r={R} fill="none" stroke="var(--p-rail)" strokeWidth="6" />
      {segs.map((t) => (
        <circle key={t.device} cx="21" cy="21" r={R} fill="none"
                stroke={DEVICE_COLORS[t.device] ?? DEVICE_COLORS.otro} strokeWidth="6"
                strokeDasharray={`${t.len} ${100 - t.len}`} strokeDashoffset={t.offset} />
      ))}
      <text x="21" y="21" className="devices-pie-total" textAnchor="middle" dominantBaseline="central">{total}</text>
    </svg>
  )
}

/* EL MODAL DE LOS APARATOS. Lo pidió Angel: «Ver dispositivos» en el subtítulo de la
   primera estación, que abre la torta — y el bloque de barras del cuerpo desaparece.

   Es un diálogo DE VERDAD encima de una página, así que lleva lo que llevan los de la
   app (`foco.js`): Atrás lo cierra sin cerrar el panel (`usarAtras` empuja una entrada
   sin tocar el hash, así que `#panel` sigue en pie), el foco queda adentro y vuelve al
   botón al cerrar, y Escape cierra. El Escape del PANEL mira si hay un modal abierto y
   se hace a un lado — si no, un Escape cerraba los dos. Tocar el telón también cierra.

   La torta reparte los visitantes ÚNICOS del período (todos, no sólo los nuevos de la
   estación), y el subtítulo dice cuántos y que son de la landing: los logueados entran
   directo a sus cartas y no tienen aparato — fue la confusión de la vez anterior. */
/* EL ARMAZÓN DE LOS MODALES DEL PANEL — hoy los aparatos y la ficha de un usuario. Todo
   lo que hace de un modal un diálogo de verdad vive acá una sola vez: Atrás lo cierra sin
   cerrar el panel (`usarAtras`), el foco queda adentro y vuelve al botón, Escape y el
   telón cierran. El Escape del PANEL se hace a un lado cuando hay un `.panel-modal`. */
function PanelModal({ titleId, title, sub, onClose, children }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  usarEscape(onClose)
  usarAtras(true, onClose)
  useEffect(() => atraparFoco(box.current, prevFocus.current), [])
  return (
    <div className="panel-modal-backdrop" onClick={onClose}>
      <div className="panel-modal" ref={box} role="dialog" aria-modal="true"
           aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="panel-modal-close" onClick={onClose} aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <h2 id={titleId}>{title}</h2>
        {sub && <p className="panel-modal-sub">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

function DevicesModal({ rows, total, periodLabel, onClose }) {
  return (
    <PanelModal titleId="devices-modal-title" title="Visitantes por aparato" onClose={onClose}
                sub={`${periodLabel} · ${total} ${total === 1 ? 'visitante único' : 'visitantes únicos'} de la landing`}>
      <Pie rows={rows} total={total} />
      <ul className="devices-legend">
        {rows.map((r) => (
          <li key={r.device}>
            <span className="swatch" style={{ background: DEVICE_COLORS[r.device] ?? DEVICE_COLORS.otro }} />
            <span>{DEVICE_NAMES[r.device] ?? r.device}</span>
            <b>{r.n}</b>
            <i>{Math.round((r.n / total) * 100)}%</i>
          </li>
        ))}
      </ul>
    </PanelModal>
  )
}

/* LA FICHA DE UN USUARIO, al tocar su cuenta en la lista. Lo pidió Angel: un botón para
   sacarle la clave provisoria a quien se la olvidó — y como la ficha ya existe, muestra
   también su perfil, que es lo que hace falta para contactarlo.

   EL BOTÓN PIDE CONFIRMACIÓN, y no es ceremonia: la clave actual de esa persona deja de
   andar en el acto, y un toque de más en una lista de doscientas cuentas le cambiaría la
   clave a alguien que no pidió nada. La confirmación dice exactamente eso.

   La provisoria se muestra UNA vez, grande y con «Copiar»: el servidor no la guarda en
   claro en ningún lado, así que si se cierra la ficha sin copiarla hay que generar otra. */
function UserModal({ user, onClose, onSesionMuerta }) {
  const [step, setStep] = useState('idle') // idle | confirm | working | done
  const [temp, setTemp] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const pr = user.profile ?? {}
  const fullName = [pr.firstName, pr.middleName, pr.lastName].filter(Boolean).join(' ')

  async function generate() {
    setStep('working')
    setError(null)
    try {
      const r = await resetUserPassword(user.usuario)
      setTemp(r.temp)
      setStep('done')
    } catch (e) {
      if (e?.sesion) return onSesionMuerta?.()
      setError(e.message)
      setStep('confirm')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(temp)
      setCopied(true)
    } catch { /* sin permiso de portapapeles: la clave está a la vista igual */ }
  }

  const rows = [
    ['Nombre', fullName],
    ['WhatsApp', pr.whatsapp],
    ['Ciudad', pr.city],
    ['Alta', dia(user.alta)],
    ['Última vez', dia(user.ultima)],
    ['Cartas', user.cartas?.toLocaleString('es-AR')],
  ]

  return (
    <PanelModal titleId="user-modal-title" title="Usuario" sub={user.usuario} onClose={onClose}>
      <dl className="user-facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {user.mustChange && step !== 'done' && (
        <p className="user-note">Tiene una clave provisoria que todavía no cambió.</p>
      )}

      {/* Una región viva siempre en el DOM: la confirmación, el resultado y los errores
          cambian el texto de adentro, que es lo que un lector de pantalla anuncia. */}
      <div className="user-action" role="status">
        {step === 'idle' && (
          <button type="button" className="user-button" onClick={() => setStep('confirm')}>
            Generar clave provisoria
          </button>
        )}
        {(step === 'confirm' || step === 'working') && (
          <>
            <p className="user-note">
              Su clave actual deja de andar ya, y al entrar con la provisoria la app le va a
              pedir que elija una nueva. Sus cartas no se tocan.
            </p>
            {error && <p className="user-error">{error}</p>}
            <div className="user-buttons">
              <button type="button" className="user-button" onClick={generate} disabled={step === 'working'}>
                {step === 'working' ? 'Un segundo…' : 'Sí, generarla'}
              </button>
              <button type="button" className="user-button quiet" onClick={() => setStep('idle')}
                      disabled={step === 'working'}>
                Cancelar
              </button>
            </div>
          </>
        )}
        {step === 'done' && (
          <>
            <p className="user-note">Clave provisoria — dictásela, se muestra una sola vez:</p>
            <p className="user-temp">{temp}</p>
            <button type="button" className="user-button" onClick={copy}>
              {copied ? 'Copiada' : 'Copiar'}
            </button>
          </>
        )}
      </div>
    </PanelModal>
  )
}

/* EL VIAJE: la historia del panel contada como UNA línea — de la puerta al álbum. Lo
   pidió Angel el 2026-09-29: «que sea más como un storytelling, para darle seguimiento
   visual rápido a todo». Antes esto eran dos grillas de cuadros (el embudo histórico y
   la pasarela) que contaban la misma historia partida en dos.

   Siete estaciones sobre una espina dorada, cada una con su conversión respecto del paso
   anterior — SIN capar, como manda la regla del panel. Y con una COSTURA honesta en el
   medio: las tres primeras se miden desde que existe la pasarela (29/09) y las cuatro
   últimas son las cuentas de todas las épocas. Mezclar esos denominadores daría
   conversiones absurdas, así que la costura se dice, no se disimula: el nodo «Tienen
   cuenta» arranca la segunda escala y lo aclara. */
function HistoricFunnel({ f, u }) {
  const v = f?.visitors
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
  const nodes = []
  if (f && v) {
    nodes.push({ n: v.total, label: 'Pasaron por la puerta', note: `personas distintas, con o sin cuenta · desde el ${dia(f.since)}` })
    nodes.push({ n: f.toSignup, label: 'Salieron a anotarse', note: 'tocaron «Anotá tus faltantes»', conv: pct(f.toSignup, v.total) })
    nodes.push({ n: f.signups ?? 0, label: 'Se anotaron', note: 'cuentas nuevas desde que se mide la puerta', conv: pct(f.signups ?? 0, f.toSignup) })
  }
  nodes.push({ n: u.total, label: 'Tienen cuenta', note: `todas las épocas${u.altas7 ? ` · +${u.altas7} esta semana` : ''}`, section: nodes.length > 0 ? 'Totales históricos' : undefined })
  nodes.push({ n: u.conCartas, label: 'Cargaron cartas', conv: pct(u.conCartas, u.total), ofAccounts: true })
  nodes.push({ n: u.volvieron, label: 'Volvieron otro día', conv: pct(u.volvieron, u.total), ofAccounts: true })
  nodes.push({ n: u.conApp, label: 'La instalaron', note: 'el paso que más hace volver', conv: pct(u.conApp, u.total), ofAccounts: true })

  return <Spine nodes={nodes} />
}

/* La espina compartida: la dibujan el embudo histórico (cuando el back no manda
   períodos) y el del período. Un nodo con `costura` CORTA la lista y abre un título de
   sección con EXACTAMENTE el mismo estilo que los h4 — la primera versión lo dibujaba
   como un renglón adentro del nodo, corrido a la derecha, y Angel lo enterró con razón:
   un cambio de sección se marca como todas las demás secciones, no con un injerto. */
function Spine({ nodes }) {
  const segments = [{ title: null, items: [] }]
  for (const x of nodes) {
    if (x.section) segments.push({ title: x.section, items: [] })
    segments[segments.length - 1].items.push(x)
  }
  return segments.map((s, i) => (
    <div key={s.title ?? i}>
      {s.title && <p className="journey-break">{s.title}</p>}
      <ol className="journey">
        {s.items.map((x) => (
          <li key={x.label}>
            <b>{x.n.toLocaleString('es-AR')}</b>
            {/* Título y subtítulo, y NADA colgado a la derecha: la conversión va en el
                renglón de abajo, donde el ojo ya está — lo marcó Angel («es como si
                siempre algo tuviera que estar lejos»). */}
            <div className="journey-body">
              <span className="journey-label">{x.label}</span>
              {(x.conv != null || x.note) && (
                <span className="journey-note">
                  {x.conv != null && <i className="journey-conv">{x.conv}%{x.ofAccounts ? ' de las cuentas' : ''}</i>}
                  {x.conv != null && x.note ? ' · ' : ''}
                  {x.note}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  ))
}

/* EL VIAJE DEL PERÍODO — y acá la costura vieja DESAPARECE: con el filtro puesto, todas
   las estaciones se miden en la MISMA ventana y la historia queda en una sola escala,
   que era justo lo que el viaje histórico no podía tener. Queda una costura más suave
   («adentro, mientras tanto»): las dos primeras poblaciones son el flujo de afuera y las
   dos últimas la vida adentro — no son el mismo río, y decirlo evita leer «usaron la
   app» como si fuera un paso del embudo de conversión.

   Cada estación lleva su «antes»: el período equivalente anterior (ayer, la semana
   previa, el MISMO TRAMO del mes pasado), que calcula el servidor. */
/* Acá hubo un «antes» espejo por estación (ayer / sem. anterior / mismo seg…) y lo
   sacó Angel el 2026-09-30: «no quiero gastar procesamiento al pedo» — eran cuatro
   paquetes extra de COUNT(DISTINCT) por apertura. El back deja de calcularlos en el
   paso dos; este front ya no los lee. */
function PeriodFunnel({ p, periodLabel }) {
  const [showDevices, setShowDevices] = useState(false)
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
  const devices = p.devices ?? []
  /* Rótulos de DATO, no de relato — Angel: «quiero datos puros, es un dashboard». La
     estación de arriba cuenta VISITANTES NUEVOS (primera vez de ese navegador), que es
     el que entra al embudo — también pedido suyo: «4 / 4 nuevos» era el mismo número
     dicho dos veces.

     Su subtítulo era «N cargas» y Angel lo bajó («al pedo»): ahora es el botón que abre
     el reparto por aparato. Sin visitantes en el período no hay torta que mostrar, así
     que el botón no aparece — un modal vacío es peor que no ofrecerlo. */
  const nodes = [
    {
      n: p.visitorsNew, label: 'Visitantes únicos nuevos',
      note: devices.length > 0 && (
        <button type="button" className="journey-link" onClick={() => setShowDevices(true)}>
          Ver dispositivos
        </button>
      ),
    },
    { n: p.toSignup, label: 'Clicks a anotarse', conv: pct(p.toSignup, p.visitorsNew) },
    { n: p.signups, label: 'Registros', conv: pct(p.signups, p.toSignup) },
    /* El uso, partido por dónde entraron — lo pidió Angel: «usuarios que usaron la
       página, y abajo uno nuevo que diga usuarios que usaron la app». La bandera es por
       día, así que web y app pueden solaparse y no tienen por qué sumar el total; la
       conversión de abajo sigue siendo contra el total de activos (`usedApp`). Con un
       back viejo sin el desglose, queda la estación única de antes. */
    ...(p.usedWeb != null
      ? [
          { n: p.usedWeb, label: 'Usaron la página', section: 'Actividad en la app' },
          { n: p.usedInstalled, label: 'Usaron la app instalada' },
        ]
      : [{ n: p.usedApp, label: 'Usuarios activos', section: 'Actividad en la app' }]),
    {
      n: p.moved.gente, label: 'Movieron cartas',
      note: `${p.moved.cartas.toLocaleString('es-AR')} ${p.moved.cartas === 1 ? 'carta' : 'cartas'}`,
      conv: pct(p.moved.gente, p.usedApp),
    },
  ]
  return (
    <>
      <Spine nodes={nodes} />
      {/* El total de la torta es la SUMA DE SUS TRAMOS y no `p.visitors`: hoy son
          iguales (cada navegador tiene un solo aparato), pero si alguna vez divergieran,
          la dona mostraría un hueco sin explicación y los porcentajes no cerrarían. */}
      {showDevices && (
        <DevicesModal rows={devices} total={devices.reduce((a, r) => a + r.n, 0)}
                      periodLabel={periodLabel} onClose={() => setShowDevices(false)} />
      )}
    </>
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

/* `colecciones` llega del catálogo que la app ya tiene cargado, no del servidor: cada una
   con su nombre, cuántos huecos tiene y qué prefijos de clave son suyos. El catálogo se
   edita sin recompilar nada, así que el servidor no puede saberlo — antes acá hubo un
   1936 escrito a mano y por eso se sacó.

   Se le mandan los prefijos al servidor para que parta los números por colección. Angel:
   «el panel está para la verga desde el punto que no me diferencia los datos de cromeros y
   leyenda» — y tenía razón hasta el fondo: la columna «Álbum» dividía las filas de cada
   persona por la suma de los DOS catálogos, así que tener Cromeros entero se dibujaba
   como 64%. */
/* Los cuatro períodos del filtro. El id es el del campo `periodos` del servidor. */
const PERIODS = [['hoy', 'Hoy'], ['semana', '7 días'], ['mes', 'Este mes'], ['mesPasado', 'Mes pasado']]
const PERIOD_KEY = 'dbz-cromeros-panel-period'

export default function Estadisticas({ onCerrar, onSesionMuerta, colecciones }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  /* El período elegido se recuerda en el aparato, como las expansiones plegadas: es una
     preferencia de ESTE dispositivo, no un dato. Sin nada guardado (o con un valor
     inventado) arranca en HOY — lo pidió Angel: el panel se abre para ver qué está
     pasando ahora. */
  const [period, setPeriod] = useState(() => {
    try {
      const g = localStorage.getItem(PERIOD_KEY)
      return PERIODS.some(([id]) => id === g) ? g : 'hoy'
    } catch { return 'hoy' }
  })
  const pick = (id) => {
    setPeriod(id)
    try { localStorage.setItem(PERIOD_KEY, id) } catch { /* modo privado */ }
  }
  const titulo = useRef(null)
  /* Quién tenía el foco antes de abrir, leído en el render: para cuando corren los
     efectos, el autoFocus del diálogo ya se lo llevó. */
  const abrio = useRef(document.activeElement)

  useEffect(() => {
    // Un 401 acá tiene que mandar a entrar de nuevo, igual que en el resto de la app,
    // y no pintar el error adentro del panel.
    const mapa = colecciones?.length
      ? Object.fromEntries(colecciones.map((c) => [c.id, c.prefijos]))
      : null
    estadisticas(mapa)
      .then(setDatos)
      .catch((e) => (e?.sesion ? onSesionMuerta?.() : setError(e.message)))
  }, [])

  /* Con un modal abierto encima (los aparatos), Escape es SUYO: los dos escuchan en
     `window`, y sin esta guarda un Escape cerraba el modal Y el panel — dos
     `history.back()` seguidos. Se mira el DOM y no un estado porque el modal vive
     adentro de otro componente; este listener se registró antes, así que corre primero
     y todavía encuentra el modal en pantalla. */
  usarEscape(() => { if (!document.querySelector('.panel-modal')) onCerrar() })

  /* UNA PÁGINA NO ATRAPA EL FOCO, un diálogo sí. Esto era un `.dialogo` y usaba
     `atraparFoco`, que cicla el Tab adentro — correcto para algo que flota encima de otra
     cosa, y molesto para algo que ES la pantalla. Lo que sí hace falta es mover el foco al
     título, para que un lector de pantalla anuncie que cambió de vista, y devolverlo al
     botón de donde vino al cerrar. */
  useEffect(() => {
    titulo.current?.focus()
    const antes = abrio.current
    return () => { if (antes?.isConnected) antes.focus() }
  }, [])

  /* PÁGINA Y NO POPUP. Era un `.dialogo` centrado con techo de alto encima de las 1936
     cartas, y en un teléfono eso es lo peor posible: una tabla de siete columnas metida en
     una caja de 620 px con scroll propio adentro de otro scroll. Angel: «ese pop up me
     tiene cansado, me corta todo en celular».

     LA RUTA NO CAMBIA: sigue siendo el hash `#panel`, porque el argumento de siempre sigue
     en pie — Atás tiene que cerrarlo, y eso ya anda. Lo que cambia es que ocupa la
     pantalla entera y scrollea como una página, sin techo y sin ancho de diálogo. */
  return (
    <div className="pagina-panel">
      <header className="panel-cabecera">
        <button className="volver" onClick={onCerrar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver
        </button>
        {/* `tabIndex={-1}` para poder enfocarlo al entrar sin meterlo en el orden del Tab. */}
        <h1 tabIndex={-1} ref={titulo}>Los números</h1>
      </header>
      <div className="panel-cuerpo numeros">
        {/* EL FILTRO DE PERÍODO, PRIMERO EN EL CUERPO y NO en la cabecera — lo marcó
            Angel: un filtro no comparte estructura con un título y un botón de volver.
            Sólo aparece si el back ya manda los períodos. */}
        {datos?.periodos && (
          <div className="periods" role="group" aria-label="Período">
            {PERIODS.map(([id, rotulo]) => (
              <button key={id} type="button" aria-pressed={period === id}
                      className={period === id ? 'activo' : undefined}
                      onClick={() => pick(id)}>
                {rotulo}
              </button>
            ))}
          </div>
        )}
        {error && <p className="nada">{error}</p>}
        {!datos && !error && <p className="nada">Buscando…</p>}
        {datos && <Cuerpo d={datos} colecciones={colecciones ?? []} period={period} onSesionMuerta={onSesionMuerta} />}
      </div>
    </div>
  )
}

function Cuerpo({ d, colecciones, period, onSesionMuerta }) {
  const [selectedUser, setSelectedUser] = useState(null)
  const { usuarios: u, cartas,  gente } = d


  /* EL PERÍODO ELEGIDO, si el back ya lo manda. Sin `periodos` (back viejo) el panel cae
     al embudo histórico, que es lo que había. */
  const p = d.periodos?.[period] ?? null


  /* Cada colección con lo que trajo el servidor. `porColeccion` puede venir en null si el
     back es más viejo que el front: entonces no se dibuja nada partido, que es mejor que
     dibujar ceros. */
  const partido = d.porColeccion
  const porCol = partido
    ? colecciones.map((c) => ({
        ...c,
        ...(partido.find((p) => p.col === c.id) ?? { cartas: 0, repetidas: 0, huecos: 0, personas: 0 }),
      }))
    : null
  const picoCol = Math.max(1, ...(porCol ?? []).map((c) => c.cartas))

  /* LAS COLUMNAS SE ORDENAN, y cada una sabe de qué sacar su valor. Una sola lista para el
     encabezado y para el criterio: si se separaran, agregar una columna dejaría un botón
     que ordena por otra cosa. Lo pidió Angel.

     Arranca por la columna de la primera colección, de mayor a menor, que es como venía
     ordenada del servidor: la tabla no cambia de aspecto hasta que la tocás. */
  const columnas = useMemo(() => [
    { id: 'usuario', rotulo: 'Cuenta', valor: (g) => g.usuario.toLowerCase(), texto: true },
    { id: 'alta', rotulo: 'Alta', valor: (g) => g.alta ?? '' },
    { id: 'ultima', rotulo: 'Última', valor: (g) => g.ultima ?? '' },
    { id: 'dias', rotulo: 'Días', ayuda: 'Días distintos en que usó la app', valor: (g) => g.dias },
    ...(porCol
      ? porCol.map((c) => ({
          id: `col:${c.id}`, rotulo: c.nombre, ayuda: `De ${c.total} huecos`,
          /* Se ordena por HUECOS, que es lo que muestra el porcentaje; si no, la flecha
             ordenaría por un número distinto del que se está mirando. */
          valor: (g) => g.porColeccion?.[c.id]?.huecos ?? g.porColeccion?.[c.id]?.cartas ?? 0,
        }))
      : [{ id: 'cartas', rotulo: 'Cartas', valor: (g) => g.cartas }, { id: 'album', rotulo: 'Álbum', valor: () => 0 }]),
    { id: 'repetidas', rotulo: 'Repes', valor: (g) => g.repetidas },
  ], [porCol])

  const [orden, setOrden] = useState(() => ({ col: null, desc: true }))
  const ordenarPor = (id) =>
    setOrden((o) => (o.col === id ? { col: id, desc: !o.desc } : { col: id, desc: true }))

  const ordenada = useMemo(() => {
    if (!orden.col) return gente
    const c = columnas.find((x) => x.id === orden.col)
    if (!c) return gente
    const signo = orden.desc ? -1 : 1
    /* Copia: `gente` viene del servidor y ordenar en el lugar lo dejaría revuelto para
       cualquier otra cosa que lo mire. Y el desempate por nombre es lo que hace que dos
       renglones con el mismo valor no salten de lugar en cada render. */
    return [...gente].sort((a, b) => {
      const va = c.valor(a), vb = c.valor(b)
      if (va < vb) return -1 * signo
      if (va > vb) return 1 * signo
      return a.usuario.localeCompare(b.usuario)
    })
  }, [gente, orden, columnas])

  /* Tramos que no son de ninguna colección: claves guardadas de un catálogo que ya no
     existe. Es el único lugar donde aparecen, y si alguna vez hay una conviene verla.

     Se compara POR PREFIJO y no por igualdad, igual que en el servidor: `ley-6-dor` es una
     variante de `ley-6` y es una carta perfectamente válida. Comparando entero, las once
     que Angel tenía cargadas salían acá como «de un catálogo viejo» y el texto invitaba a
     borrarlas. */
  const esDeAlguna = (tramo) =>
    colecciones.some((c) => c.prefijos.some((p) => tramo === p || tramo.startsWith(p + '-')))
  const sueltas = (d.porTramo ?? []).filter((t) => !esDeAlguna(t.tramo))

  return (
    <>
      {/* LA HISTORIA: el embudo del período sobre la espina, con su «antes» espejo en
          cada estación. Hubo además un «Hoy» y un «Día por día» y los dos se
          extinguieron: el filtro de período los volvió redundantes — sus datos viven en
          las estaciones, en cards y filtrados. */}
      {/* EL EMBUDO DEL PERÍODO. Con filtro, todas las estaciones comparten la ventana y
          la conversión va en una sola escala; sin `periodos` (back viejo) cae al embudo
          histórico. Títulos de dato y no de relato — Angel: «quiero datos puros». */}
      <h4>Embudo</h4>
      {p
        ? <PeriodFunnel p={p} periodLabel={PERIODS.find(([id]) => id === period)?.[1] ?? ''} />
        : <HistoricFunnel f={d.funnel} u={u} />}

      {/* «Visitantes por aparato» vivió acá como bloque de barras y se mudó al modal de
          la torta, que abre el «Ver dispositivos» de la primera estación — pedido de
          Angel: un dato de detalle no ocupa lugar en el principal. */}

      {/* Los totales históricos, aparte del período. */}
      {p && (
        <>
          <h4>Totales históricos</h4>
          <div className="cuadros chicos cuatro">
            <Cuadro valor={u.total} rotulo="Cuentas" pie={u.altas7 ? `+${u.altas7} esta semana` : undefined} />
            <Cuadro valor={u.conCartas} rotulo="Con cartas" de={u.total} />
            <Cuadro valor={u.volvieron} rotulo="Volvieron alguna vez" de={u.total} />
            <Cuadro valor={u.conApp} rotulo="Con la app" de={u.total} />
          </div>
        </>
      )}

      {/* ACÁ VIVIERON «Semana por semana» (las cohortes) y antes la tira de uso, y los
          dos se extinguieron el 2026-09-30 por lo mismo: con el embudo filtrado por
          período se leían como la misma información repetida — lo marcó Angel. El
          servidor sigue mandando `cohortes` (dos pasos). Si algún día vuelve la
          pregunta de las camadas («¿las cohortes nuevas retienen mejor?»), esa tabla es
          la respuesta y está a un git log de distancia. */}

      <h4>Las cartas</h4>
      {/* TODO LO DE CARTAS, JUNTO. Antes «Qué colección usan» estaba entre el embudo y las
          cohortes —o sea en el medio de la parte que habla de gente— y «Cuántas cartas
          tiene cada uno» cuatro bloques más abajo, hablando de lo mismo. Angel: «"Qué
          colección usan" está acomodado medio mal». Van juntos y después de la gente,
          porque el cuello de botella no es cuántas cartas hay. */}
      {porCol && (
        /* `colecciones` además de `grupo`: la dualidad dorado/azul del CSS es SÓLO de
           este bloque — puesta sobre `.grupo` a secas, teñía de azul renglón por medio
           a los devices, donde el azul no significa nada. */
        <div className="grupo colecciones">
          {porCol.map((c) => (
            /* SIN porcentaje, a propósito: acá `cartas` son las filas de TODA la gente
               sumadas, y dividirlas por los huecos de un álbum no significa nada — con
               19 personas dan 8026 sobre 1936 y el tope de 100% lo disfrazaba de
               «álbum completo». El porcentaje sólo tiene sentido por persona, y ahí
               está, en la tabla de abajo. */
            <Barra key={c.id} rotulo={c.nombre} valor={c.cartas} techo={picoCol}
                   nota={`${c.personas} ${c.personas === 1 ? 'persona' : 'personas'}${c.repetidas ? ` · ${c.repetidas} ${c.repetidas === 1 ? 'repetida' : 'repetidas'}` : ''}`} />
          ))}
        </div>
      )}
      {/* SE VA «CUÁNTAS TIENE CADA UNO», que no era eso. Dibujaba `tramos`, o sea las filas
          POR EXPANSIÓN, con dos problemas encima: el rótulo era el id crudo —«exp-1», que no
          le dice nada a nadie— y el porcentaje dividía cartas por USUARIOS. Con 932 cartas y
          40 cuentas daba 2330%, que el tope de `parte` disfrazaba de un 100% redondo. Es
          exactamente el «porcentajes inentendibles» que marcó Angel, y el título encima
          prometía un reparto por persona que ese dato no tiene.
          Lo que sí se quiere saber está en los dos lugares donde el número significa algo:
          qué colección se usa, acá arriba; y cuánto tiene cada persona, en la tabla de
          abajo, que además ahora se ordena por esa columna. */}
      <p className="nada">
        {cartas.total.toLocaleString('es-AR')} cartas marcadas
        {' · '}{cartas.repetidas.toLocaleString('es-AR')} repetidas
        {sueltas.length > 0 && (
          <> · y {sueltas.reduce((a, t) => a + t.filas, 0)} en tramos que ya no están en
            ningún catálogo ({sueltas.map((t) => t.tramo).join(', ')}), que el pie de la app
            ofrece sacar</>
        )}
      </p>

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
        <table className="gente grande">
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c.id} title={c.ayuda} aria-sort={orden.col === c.id ? (orden.desc ? 'descending' : 'ascending') : undefined}>
                  <button type="button" className="ordenar" onClick={() => ordenarPor(c.id)}>
                    {c.rotulo}
                    {/* La flecha sólo en la columna por la que se está ordenando: una en
                        cada encabezado es ruido y no dice cuál manda. */}
                    <span aria-hidden="true">{orden.col === c.id ? (orden.desc ? ' ↓' : ' ↑') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenada.map((g) => (
              <tr key={g.usuario}
                  className={[g.cartas ? '' : 'apagada', g.app ? 'con-app' : ''].filter(Boolean).join(' ') || undefined}>
                {/* El chip ANTES del nombre: después, un mail largo lo recortaba con el
                    elipsis y quedaba una cajita vacía. Adelante queda entero siempre y los
                    de la app se encuentran bajando por la columna. */}
                {/* LA CUENTA ES EL BOTÓN DE SU FICHA (perfil y clave provisoria). Se ve
                    como texto con subrayado punteado: un botón de verdad por renglón sería
                    doscientos botones compitiendo con los datos. */}
                <td className="quien">
                  <button type="button" className="who" title={g.usuario} onClick={() => setSelectedUser(g)}>
                    {g.app && <span className="chip" title="Entra desde la app instalada">app</span>}
                    {g.usuario}
                  </button>
                </td>
                <td>{dia(g.alta)}</td>
                <td>{dia(g.ultima)}</td>
                <td>{g.dias}</td>
                {porCol
                  ? porCol.map((c) => {
                      const suyo = g.porColeccion?.[c.id]
                      const n = suyo?.cartas ?? 0
                      /* EL PORCENTAJE VA SOBRE LOS HUECOS, no sobre las filas. Una variante
                         es una fila propia pero no es un hueco del álbum: contándolas, el
                         número de arriba incluía variantes y el de abajo no, podía pasarse
                         de 100% y el tope lo disfrazaba de álbum completo. Ahora es el
                         mismo par que la persona ve en su propio encabezado.

                         `huecos` puede no venir si el back es más viejo que el front: ahí
                         no se dibuja el porcentaje, que es mejor que dibujar uno falso. */
                      const h = suyo?.huecos
                      return (
                        <td key={c.id}>
                          {/* `albumPercent` y NO un `Math.round` cualquiera: éste es el
                              avance de un álbum, y ahí redondear miente en el único punto
                              donde importa — 1096 de 1097 daría 100% y se leería
                              «completo». Tapa a 99 hasta que estén todas.
                              Ya no queda ningún otro porcentaje en el panel: el que había
                              se recortaba a 100 y disfrazaba cuentas absurdas de números
                              redondos. Si hace falta uno nuevo, que no se recorte. */}
                          {/* EL NÚMERO Y EL PORCENTAJE NO PUEDEN IR PEGADOS. Iban, y se
                              leían como uno solo: «1673» y «86%» salían «167386%», un
                              número de seis cifras sin sentido. Angel: «porcentajes
                              inentendibles». El `<i>` estaba, pero sin separación y sin
                              suficiente diferencia no alcanza para partirlos con el ojo. */}
                          {n ? <>{n.toLocaleString('es-AR')}{h != null && <i>{albumPercent(h, c.total)}%</i>}</> : '—'}
                        </td>
                      )
                    })
                  : <><td>{g.cartas}</td><td>—</td></>}
                <td>{g.repetidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* LA SALUD DEL FIERRO, AL FONDO — Angel: «ese cuadro con datos de la vm no va
          ahí». Es información de operación, no del producto, así que cierra el panel en
          vez de abrirlo. La ALARMA no depende de este lugar: cuando algo está vencido, el
          botón «Panel» de la app ya lleva el punto rojo, y acá abajo el bloque se pinta
          entero — no hace falta verlo primero para verlo. */}
      <h4>Infra</h4>
      <Salud salud={d.salud} />

      {selectedUser && (
        <UserModal user={selectedUser} onClose={() => setSelectedUser(null)} onSesionMuerta={onSesionMuerta} />
      )}
    </>
  )
}
