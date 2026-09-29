// Los números para decidir qué hacer con la app. Sólo los ve quien esté en DBZ_ADMINS.
//
// Está ordenado por la pregunta que importa, que no es cuánta gente entró sino cuánta
// vuelve: arriba el embudo de "se anotó" a "volvió otro día", y recién después el
// detalle. Si alguna vez se cobra algo, se le cobra a los que vuelven.
import { useEffect, useMemo, useRef, useState } from 'react'
import { usarEscape } from './foco'
import { estadisticas } from './almacenamiento'
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
const APARATOS = { iphone: 'iPhone', android: 'Android', windows: 'Windows', mac: 'Mac', ipad: 'iPad', otro: 'Otro' }

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
    nodes.push({ n: v.total, rotulo: 'Pasaron por la puerta', nota: `personas distintas, con o sin cuenta · desde el ${dia(f.since)}` })
    nodes.push({ n: f.toSignup, rotulo: 'Salieron a anotarse', nota: 'tocaron «Anotá tus faltantes»', conv: pct(f.toSignup, v.total) })
    nodes.push({ n: f.signups ?? 0, rotulo: 'Se anotaron', nota: 'cuentas nuevas desde que se mide la puerta', conv: pct(f.signups ?? 0, f.toSignup) })
  }
  nodes.push({ n: u.total, rotulo: 'Tienen cuenta', nota: `todas las épocas${u.altas7 ? ` · +${u.altas7} esta semana` : ''}`, costura: nodes.length > 0 ? 'Totales históricos' : undefined })
  nodes.push({ n: u.conCartas, rotulo: 'Cargaron cartas', conv: pct(u.conCartas, u.total), deCuentas: true })
  nodes.push({ n: u.volvieron, rotulo: 'Volvieron otro día', conv: pct(u.volvieron, u.total), deCuentas: true })
  nodes.push({ n: u.conApp, rotulo: 'La instalaron', nota: 'el paso que más hace volver', conv: pct(u.conApp, u.total), deCuentas: true })

  return <Spine nodes={nodes} />
}

/* La espina compartida: la dibujan el embudo histórico (cuando el back no manda
   períodos) y el del período. Un nodo con `costura` CORTA la lista y abre un título de
   sección con EXACTAMENTE el mismo estilo que los h4 — la primera versión lo dibujaba
   como un renglón adentro del nodo, corrido a la derecha, y Angel lo enterró con razón:
   un cambio de sección se marca como todas las demás secciones, no con un injerto. */
function Spine({ nodes }) {
  const segmentos = [{ titulo: null, items: [] }]
  for (const x of nodes) {
    if (x.costura) segmentos.push({ titulo: x.costura, items: [] })
    segmentos[segmentos.length - 1].items.push(x)
  }
  return segmentos.map((s, i) => (
    <div key={s.titulo ?? i}>
      {s.titulo && <p className="journey-break">{s.titulo}</p>}
      <ol className="journey">
        {s.items.map((x) => (
          <li key={x.rotulo}>
            <b>{x.n.toLocaleString('es-AR')}</b>
            {/* Título y subtítulo, y NADA colgado a la derecha: la conversión va en el
                renglón de abajo, donde el ojo ya está — lo marcó Angel («es como si
                siempre algo tuviera que estar lejos»). */}
            <div className="journey-body">
              <span className="journey-label">{x.rotulo}</span>
              {(x.conv != null || x.nota) && (
                <span className="journey-note">
                  {x.conv != null && <i className="journey-conv">{x.conv}%{x.deCuentas ? ' de las cuentas' : ''}</i>}
                  {x.conv != null && x.nota ? ' · ' : ''}
                  {x.nota}
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
/* Acá hubo un «antes» espejo por estación (ayer / sem. anterior / mismo tramo…) y lo
   sacó Angel el 2026-09-30: «no quiero gastar procesamiento al pedo» — eran cuatro
   paquetes extra de COUNT(DISTINCT) por apertura. El back deja de calcularlos en el
   paso dos; este front ya no los lee. */
function PeriodFunnel({ p }) {
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
  /* Rótulos de DATO, no de relato — Angel: «quiero datos puros, es un dashboard». La
     estación de arriba cuenta VISITANTES NUEVOS (primera vez de ese navegador), que es
     el que entra al embudo — también pedido suyo: «4 / 4 nuevos» era el mismo número
     dicho dos veces. Los devices siguen repartiendo sobre los únicos totales. */
  const nodes = [
    { n: p.visitorsNew, rotulo: 'Visitantes únicos nuevos', nota: `${p.landing} cargas` },
    { n: p.toSignup, rotulo: 'Clicks a anotarse', conv: pct(p.toSignup, p.visitorsNew) },
    { n: p.signups, rotulo: 'Registros', conv: pct(p.signups, p.toSignup) },
    { n: p.usedApp, rotulo: 'Usuarios activos', costura: 'Actividad en la app' },
    {
      n: p.moved.gente, rotulo: 'Movieron cartas',
      nota: `${p.moved.cartas.toLocaleString('es-AR')} ${p.moved.cartas === 1 ? 'carta' : 'cartas'}`,
      conv: pct(p.moved.gente, p.usedApp),
    },
  ]
  return <Spine nodes={nodes} />
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

  usarEscape(onCerrar)

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
        {datos && <Cuerpo d={datos} colecciones={colecciones ?? []} period={period} />}
      </div>
    </div>
  )
}

function Cuerpo({ d, colecciones, period }) {
  const { usuarios: u, cartas,  gente } = d


  /* EL PERÍODO ELEGIDO, si el back ya lo manda. Sin `periodos` (back viejo) el panel cae
     al embudo histórico, que es lo que había. */
  const p = d.periodos?.[period] ?? null

  /* Aparatos: del período cuando hay filtro, del total histórico cuando no. */
  const devices = p ? { devices: p.devices, total: p.visitors } :
    d.funnel?.visitors ? { devices: d.funnel.visitors.devices, total: d.funnel.visitors.total } : null

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
      {p ? <PeriodFunnel p={p} /> : <HistoricFunnel f={d.funnel} u={u} />}
      {p && p.toLogin > 0 && (
        <p className="nada">Logins desde la landing: {p.toLogin}</p>
      )}

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

      {/* EL RITMO: las series con las columnas ALINEADAS sobre el rango del filtro —
          7 columnas la semana, el mes corrido, el mes pasado entero. Con «Hoy» no hay
          nada que dibujar: un gráfico de una columna es un número disfrazado. */}
      {devices && devices.devices.length > 0 && (
        <>
          <h4>Por aparato</h4>
          <div className="grupo">
            {devices.devices.map((x) => (
              <Barra key={x.device} rotulo={APARATOS[x.device] ?? x.device} valor={x.n}
                     techo={devices.total}
                     nota={`${Math.round((x.n / devices.total) * 100)}%`} />
            ))}
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
                <td className="quien" title={g.usuario}>
                  {g.app && <span className="chip" title="Entra desde la app instalada">app</span>}
                  {g.usuario}
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
    </>
  )
}
