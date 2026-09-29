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

/* LOS CATORCE DÍAS COMO UNA TIRA. Una serie de tiempo se lee de izquierda a derecha, no
   como catorce renglones apilados — que era además lo que hacía que el panel pareciera no
   terminar nunca.

   Las catorce columnas son FIJAS y salen de las fechas, no de las filas que devolvió la
   consulta: el servidor no manda los días en que no entró nadie, así que dibujando sólo lo
   que viene, dos días separados por una semana quedaban pegados y se leían como
   consecutivos. Un día sin nadie tiene que ocupar su lugar y verse vacío. */
function Tira({ dias, unidad = ['persona', 'personas'] }) {
  const porFecha = new Map(dias.map((x) => [x.dia, x]))
  const hoy = dias.length ? dias[dias.length - 1].dia : null
  const catorce = []
  if (hoy) {
    const base = new Date(`${hoy}T12:00:00Z`)
    for (let i = 13; i >= 0; i--) {
      const f = new Date(base)
      f.setUTCDate(f.getUTCDate() - i)
      const clave = f.toISOString().slice(0, 10)
      catorce.push({ dia: clave, ...(porFecha.get(clave) ?? { personas: 0, porApp: 0 }) })
    }
  }
  const pico = Math.max(1, ...catorce.map((x) => x.personas))
  const ultimo = catorce[catorce.length - 1]
  return (
    <div className="tira">
      {/* El máximo y el de hoy arriba: son los dos números que se miran. Poner el valor
          encima de cada barra sería catorce números de un dígito, que es de donde venimos. */}
      <p className="tira-resumen">
        <b>{ultimo?.personas ?? 0}</b> hoy · máximo <b>{pico}</b> en estos catorce días
      </p>
      <div className="tira-barras">
        {catorce.map((x) => (
          <span key={x.dia} className={`tira-dia${x.dia === hoy ? ' hoy' : ''}`}
                title={`${dia(x.dia)}: ${x.personas} ${unidad[x.personas === 1 ? 0 : 1]}${x.porApp ? `, ${x.porApp} por la app` : ''}`}>
            <span className="tira-barra" style={{ height: `${Math.max(2, (x.personas / pico) * 100)}%` }} />
            <em>{x.dia.slice(8, 10)}</em>
          </span>
        ))}
      </div>
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
  const { usuarios: u, cartas,  gente } = d

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

      {/* EL EMBUDO, EN CUADROS. Angel: «los contadores son unos textos, deberían ser unos
          cuadros o algo». Y son los MISMOS cuatro números del embudo de antes: lo que
          cambia es que ahora el número es lo primero que se ve y el rótulo lo explica,
          en vez de un rótulo con una barra al lado y el número al final.

          Va primero y sin párrafo que lo introduzca: los cuatro rótulos ya dicen qué es, y
          el panel existe para esto — «no cuánta gente entra, sino cuánta vuelve».

          Absorbe además cuatro de los seis textos sueltos que estaban más abajo repitiendo
          parte de esto. Un bloque menos, no uno más. */}
      <div className="cuadros">
        <Cuadro valor={u.total} rotulo="Se anotaron" pie={u.altas7 ? `+${u.altas7} esta semana` : 'ninguna esta semana'} />
        <Cuadro valor={u.conCartas} rotulo="Cargaron cartas" de={u.total} />
        <Cuadro valor={u.volvieron} rotulo="Volvieron otro día" de={u.total} />
        <Cuadro valor={u.conApp} rotulo="La instalaron" de={u.total} />
      </div>

      {/* EL PULSO, aparte y más chico. Es el «ahora» y no lo acumulado, así que no puede ir
          en la misma grilla: seis cuadros iguales se leen como una pared y se pierde cuál
          contesta qué. El salto de tamaño es lo que dice que son secundarios — no un
          `opacity`, que en este proyecto está prohibido sobre texto. */}
      <div className="cuadros chicos">
        <Cuadro valor={u.activosHoy} rotulo="La usaron hoy" />
        <Cuadro valor={u.activos7} rotulo="La usaron esta semana" />
      </div>

      {/* LA PASARELA: el tramo de ANTES de tener cuenta, que hasta el 2026-09-29 no se
          medía taxativamente — el propio panel decía «no hay denominador». Ahora lo hay:
          contadores anónimos de la landing (`temprano.js`) y de la llegada al formulario
          (`Entrar.jsx`, con el `?f=` de cada botón). Son VISITAS y no personas —sin IPs
          ni cookies no hay forma de deduplicar, y está bien que no la haya— y el bloque
          lo dice con esas palabras.

          Sólo se dibuja si el back ya lo manda (`funnel` en null = back viejo), y sus
          «se anotaron» son las altas DESDE que la pasarela existe: contra las históricas
          la conversión sería absurda.

          Y LA TIRA DE ALTAS VUELVE, acá adentro. El «altas por día» vertical se fue por
          pedido de Angel («cada vez más largo»); esto es otra cosa — la misma tira FIJA
          de 14 columnas del uso, que él pidió de vuelta el 2026-09-29 («faltan gráficos
          de registros»). El campo `porDia` seguía viniendo del servidor a propósito. */}
      {d.funnel && (
        <>
          <h4>La pasarela · desde el {dia(d.funnel.since)}</h4>
          <div className="cuadros">
            <Cuadro valor={d.funnel.landing} rotulo="Vieron la landing" pie="visitas, no personas" />
            <Cuadro valor={d.funnel.toSignup} rotulo="Salieron a anotarse" de={d.funnel.landing || undefined} />
            <Cuadro valor={d.funnel.signups ?? 0} rotulo="Se anotaron" de={d.funnel.landing || undefined} />
            <Cuadro valor={d.funnel.toLogin} rotulo="Fueron a entrar" pie="ya tenían cuenta, o directo" />
          </div>
          <p className="tira-cabeza">Visitas a la landing, por día</p>
          <Tira dias={d.funnel.days.map((x) => ({ dia: x.dia, personas: x.n }))} unidad={['visita', 'visitas']} />
          {(d.porDia ?? []).length > 0 && (
            <>
              <p className="tira-cabeza">Altas, por día</p>
              <Tira dias={d.porDia.map((x) => ({ dia: x.dia, personas: x.cuantos }))} unidad={['alta', 'altas']} />
            </>
          )}
        </>
      )}

      {cohortes.length > 0 && (
        <>
          <h4>Semana por semana</h4>
          {/* Sube acá, de sexta a segunda: es lo único del panel que contesta «¿está
              mejorando?», que es la pregunta que sigue al embudo. Antes estaba debajo de
              dos bloques de cartas.

              Un total acumulado no sirve mientras la app crece: cada semana entra gente que
              todavía no tuvo tiempo de volver, así que el promedio baja solo aunque nada
              empeore. Por semana de alta sí se puede comparar una contra otra.

              Y SE LE SACAN LOS PORCENTAJES. Con cohortes de cinco a ocho personas, «43%» es
              una precisión inventada: el denominador está en la columna de al lado y
              «7 / 3 / 1» alineado se lee solo. De paso desaparece el lugar donde el número
              y el porcentaje se veían pegados. */}
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
                    <td>{c.cargaron}</td>
                    <td>{c.volvieron}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nada">Antes del 18/09 los días de uso quedan cortos.</p>
        </>
      )}

      {/* LOS CATORCE DÍAS, EN UNA TIRA Y NO EN CATORCE RENGLONES. Acá había DOS listas
          verticales casi idénticas y pegadas —«La usaron, por día» y «Altas por día»— que
          juntas se comían dos pantallas de teléfono para mostrar veintiocho números de un
          dígito. Angel: «el "Lo usaron por día" es realmente una poronga» y «el gráfico de
          altas por día cada vez más largo». Es el mismo problema: catorce barras apiladas
          verticalmente son la forma equivocada para una serie de tiempo, que se lee de
          izquierda a derecha.

          SE VA «ALTAS POR DÍA» ENTERO, y es lo que más achica el panel. Mide cuánta gente
          LLEGA, que es textualmente lo que el CLAUDE.md dice que NO es la pregunta de este
          panel; hace un pico el día que se comparte el enlace y después nada, o sea catorce
          renglones para dibujar trece ceros; y lo que de verdad se quiere saber de las
          altas —cuántas esta semana— ya está en el primer cuadro. El servidor sigue
          mandando `porDia`: sacar un campo de la respuesta es un cambio en dos pasos, y
          éste es el primero.

          CATORCE COLUMNAS FIJAS, no una por día que vino, y eso arregla una mentira que
          había: la consulta no devuelve los días sin nadie, así que la lista los omitía y
          dos días separados por una semana salían pegados pareciendo consecutivos. Un día
          sin nadie ahora se dibuja: un tope finito, que se ve. */}
      {actividad.length > 0 && (
        <>
          <h4>La usaron, últimos 14 días</h4>
          <Tira dias={actividad} />
        </>
      )}

      <h4>Las cartas</h4>
      {/* TODO LO DE CARTAS, JUNTO. Antes «Qué colección usan» estaba entre el embudo y las
          cohortes —o sea en el medio de la parte que habla de gente— y «Cuántas cartas
          tiene cada uno» cuatro bloques más abajo, hablando de lo mismo. Angel: «"Qué
          colección usan" está acomodado medio mal». Van juntos y después de la gente,
          porque el cuello de botella no es cuántas cartas hay. */}
      {porCol && (
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
    </>
  )
}
