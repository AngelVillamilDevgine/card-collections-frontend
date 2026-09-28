// Los números para decidir qué hacer con la app. Sólo los ve quien esté en DBZ_ADMINS.
//
// Está ordenado por la pregunta que importa, que no es cuánta gente entró sino cuánta
// vuelve: arriba el embudo de "se anotó" a "volvió otro día", y recién después el
// detalle. Si alguna vez se cobra algo, se le cobra a los que vuelven.
import { useEffect, useMemo, useRef, useState } from 'react'
import { usarEscape } from './foco'
import { estadisticas } from './almacenamiento'
import { albumPercent } from './collections'
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
  const p = salud.restauracion

  const cosas = [
    {
      que: 'Copia de la base',
      mal: !r || dias(r.hace) > 2,
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
      mal: !p || dias(p.hace) > 10,
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
export default function Estadisticas({ onCerrar, onSesionMuerta, colecciones }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
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
        {error && <p className="nada">{error}</p>}
        {!datos && !error && <p className="nada">Buscando…</p>}
        {datos && <Cuerpo d={datos} colecciones={colecciones ?? []} />}
      </div>
    </div>
  )
}

function Cuerpo({ d, colecciones }) {
  const { usuarios: u, cartas, porDia, tramos, gente } = d
  const pico = Math.max(1, ...porDia.map((x) => x.cuantos))
  const picoTramo = Math.max(1, ...tramos.map((x) => x.cuantos))

  const actividad = d.actividad ?? []
  const picoActivos = Math.max(1, ...actividad.map((x) => x.personas))
  const cohortes = d.cohortes ?? []

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
      <Salud salud={d.salud} />

      {/* El embudo: de arriba a abajo se va cayendo gente. Donde más cae es el problema. */}
      <p>De cada persona que se anota, cuántas llegan hasta el final.</p>
      <div className="grupo">
        <Barra rotulo="Se anotaron" valor={u.total} techo={u.total} />
        <Barra rotulo="Cargaron cartas" valor={u.conCartas} techo={u.total} nota={`${parte(u.conCartas, u.total)}%`} />
        <Barra rotulo="Volvieron otro día" valor={u.volvieron} techo={u.total} nota={`${parte(u.volvieron, u.total)}%`} />
        <Barra rotulo="La instalaron" valor={u.conApp} techo={u.total} nota={`${parte(u.conApp, u.total)}%`} />
      </div>

      {/* CUATRO RENGLONES DE ACLARACIÓN ERAN TRES DE MÁS. Explicaban por qué «volvieron»
          se cuenta con `visita` y no con `sesion`, y que lo anterior al 18/09 queda corto.
          Las dos cosas son ciertas y ninguna cambia una decisión: el porqué del método ya
          está escrito en el CLAUDE.md, que es donde vive el porqué. Angel: «la aclaración
          de volvieron es muy larga al pedo, no me hace falta saber tanto».

          Queda lo único que sí cambia cómo se lee el número: que antes del 18/09 los datos
          son incompletos, así que una caída vieja puede no ser real. */}
      <p className="nada">Antes del 18/09 los datos son incompletos.</p>

      <div className="sueltos">
        <span><b>{u.altas7}</b> altas en 7 días</span>
        <span><b>{u.altasHoy}</b> hoy</span>
        <span><b>{u.activosHoy}</b> la usaron hoy</span>
        <span><b>{u.activos7}</b> en la semana</span>
        <span><b>{cartas.total.toLocaleString('es-AR')}</b> cartas marcadas</span>
        <span><b>{cartas.repetidas.toLocaleString('es-AR')}</b> repetidas</span>
      </div>

      {porCol && (
        <>
          <h4>Qué colección usan</h4>
          <div className="grupo">
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
          {sueltas.length > 0 && (
            <p className="nada">
              Y hay {sueltas.reduce((a, t) => a + t.filas, 0)} cartas guardadas en tramos que
              no son de ninguna colección ({sueltas.map((t) => t.tramo).join(', ')}): son de un
              catálogo viejo y el pie de la app ofrece sacarlas.
            </p>
          )}
        </>
      )}

      {cohortes.length > 0 && (
        <>
          <h4>Cada semana que entró</h4>
          {/* Un total acumulado no sirve mientras la app crece: cada semana entra gente que
              todavía no tuvo tiempo de volver, así que el promedio baja solo aunque nada
              empeore. Por semana de alta sí se puede comparar una contra otra. */}
          <div className="tablon">
            <table className="gente">
              <thead>
                <tr><th>Semana</th><th>Entraron</th><th>Cargaron</th><th>Volvieron</th></tr>
              </thead>
              <tbody>
                {cohortes.map((c) => (
                  <tr key={c.semana}>
                    <td>{dia(c.semana)}</td>
                    <td>{c.gente}</td>
                    <td>{c.cargaron} <i>{parte(c.cargaron, c.gente)}%</i></td>
                    <td>{c.volvieron} <i>{parte(c.volvieron, c.gente)}%</i></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {actividad.length > 0 && (
        <>
          <h4>La usaron, por día</h4>
          {/* Distinto de «altas por día», que está abajo: las altas hacen un pico el día que
              se comparte el enlace y después nada. Esto dice si alguien sigue ahí. */}
          <div className="grupo">
            {actividad.map((x) => (
              <Barra key={x.dia} flaca rotulo={dia(x.dia)} valor={x.personas} techo={picoActivos}
                     nota={x.porApp ? `${x.porApp} por la app` : ''} />
            ))}
          </div>
        </>
      )}

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
                <td className="quien" title={g.usuario}>
                  {g.usuario}
                  {g.app && <span className="chip" title="Entra desde la app instalada">app</span>}
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
                          {/* Por `albumPercent` y no por `parte`: éste es el avance de un
                              álbum y ahí `Math.round` miente — 1096 de 1097 daría 100%.
                              `parte` se queda para los porcentajes de gente, donde 100
                              quiere decir «todos» y redondear está bien. */}
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
    </>
  )
}
