import { useEffect, useMemo, useRef, useState } from 'react'
import { ESTADOS, FALTA, etiqueta } from './estados'
import Entrar from './Entrar'
import {
  descargar, restaurar, quienSoy, salir,
  leerColeccion, guardarCarta, reemplazarColeccion,
} from './almacenamiento'

function numerosDe(exp) {
  const out = []
  for (let n = exp.desde; n <= exp.hasta; n++) out.push(n)
  return out
}

/* Los tres listados que un coleccionista realmente necesita: qué buscar,
   qué puede cambiar y qué le conviene reemplazar. */
export const FILTROS = [
  { id: 'todas',      label: 'Todas',           pasa: () => true },
  { id: 'falta',      label: 'Me faltan',       pasa: (cant) => cant === 0 },
  { id: 'repetidas',  label: 'Repetidas',       pasa: (cant) => cant > 1 },
  { id: 'reemplazar', label: 'Para reemplazar', pasa: (cant, est) => cant > 0 && est === 'reemplazar' },
]

const CLARO = '#ffffff'
const OSCURO = '#1f1c19'

/* Luminancia relativa (WCAG). */
function luz(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a, b) {
  const [alta, baja] = [luz(a), luz(b)].sort((x, y) => y - x)
  return (alta + 0.05) / (baja + 0.05)
}

/* Se elige el que mida más contraste, no el que caiga de un lado de un umbral:
   con umbral fijo, el naranja de Expansión 1 quedaba con texto blanco a 2.47. */
function textoSobre(fondo) {
  return contraste(fondo, CLARO) >= contraste(fondo, OSCURO) ? CLARO : OSCURO
}

/* ---------------------------------- carta --------------------------------- */

const MANTENIDO = 420 // ms a partir de los cuales deja de ser un toque

function Carta({ numero, estado, cantidad, onTocar, onMantener }) {
  const reloj = useRef(null)
  const fueLargo = useRef(false)

  function apretar() {
    fueLargo.current = false
    reloj.current = setTimeout(() => {
      fueLargo.current = true
      onMantener()
    }, MANTENIDO)
  }

  function soltar() {
    clearTimeout(reloj.current)
  }

  useEffect(() => () => clearTimeout(reloj.current), [])

  const titulo = cantidad
    ? `${etiqueta(estado)} · tenés ${cantidad}`
    : 'Me falta'

  return (
    <button
      className={`carta ${cantidad ? estado : FALTA}`}
      title={titulo}
      aria-label={`Carta ${numero}. ${titulo}`}
      onPointerDown={apretar}
      onPointerUp={soltar}
      onPointerLeave={soltar}
      onPointerCancel={soltar}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => { if (!fueLargo.current) onTocar() }}
    >
      {numero}
      {cantidad > 1 && <b className="repes">{cantidad}</b>}
    </button>
  )
}

/* -------------------------------- diálogo --------------------------------- */

function Pregunta({ numero, onElegir, onCerrar }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])

  return (
    <div className="telon" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-label={`Carta ${numero}`} onClick={(e) => e.stopPropagation()}>
        <h3>Carta {numero}</h3>
        <p>¿En qué estado está?</p>
        {ESTADOS.map((e) => (
          <button key={e.id} className={`opcion ${e.id}`} onClick={() => onElegir(e.id)} autoFocus={e.id === 'bien'}>
            {e.label}
          </button>
        ))}
        <button className="cancelar" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  )
}

/* ----------------------------------- app ---------------------------------- */

const VACIA = { estados: {}, cantidades: {} }

/* Lo que tarda en mandarse una carta después del último toque. Existe por el orden:
   si tocás tres veces rápido y salen tres pedidos, pueden llegar desordenados y
   quedar guardado el 2 después del 3. Esperando, sale uno solo con el número final. */
const ESPERA = 250

export default function App() {
  const [catalogo, setCatalogo] = useState(null)
  const [error, setError] = useState(null)
  const [usuario, setUsuario] = useState(undefined) // undefined = todavía no sé
  const [datos, setDatos] = useState(VACIA)
  const [filtro, setFiltro] = useState('todas')
  const [preguntando, setPreguntando] = useState(null)
  const [fallo, setFallo] = useState(false)
  const archivoRef = useRef(null)
  const pendientes = useRef(new Map())

  const { estados, cantidades } = datos

  useEffect(() => {
    fetch(new URL('data/expansiones.json', document.baseURI))
      .then((r) => r.json())
      .then((raw) => setCatalogo(raw.expansiones.map((e) => ({ ...e, lista: numerosDe(e) }))))
      .catch(() => setError('No se pudo cargar el catálogo de cartas.'))
  }, [])

  /* ¿El token guardado sigue sirviendo? Si no, se muestra la pantalla de entrada. */
  useEffect(() => { quienSoy().then((u) => setUsuario(u)) }, [])

  /* La colección es la del usuario: se pide al entrar y se olvida al salir. */
  useEffect(() => {
    if (!usuario) return setDatos(VACIA)
    leerColeccion()
      .then(setDatos)
      .catch((e) => setError(e.message))
  }, [usuario])

  /* Manda una carta sola, esperando por si vienen más toques de la misma. */
  function mandar(clave, cantidad, estado) {
    const previo = pendientes.current.get(clave)
    if (previo) clearTimeout(previo.reloj)

    const reloj = setTimeout(() => {
      const ultimo = pendientes.current.get(clave)
      pendientes.current.delete(clave)
      guardarCarta(clave, ultimo.cantidad, ultimo.estado)
        .then(() => setFallo(false))
        .catch(() => setFallo(true))
    }, ESPERA)

    pendientes.current.set(clave, { cantidad, estado, reloj })
  }

  /* Si cerrás la pestaña justo después de un toque, eso todavía no salió. */
  useEffect(() => {
    function vaciar() {
      for (const [clave, { cantidad, estado, reloj }] of pendientes.current) {
        clearTimeout(reloj)
        guardarCarta(clave, cantidad, estado, { keepalive: true }).catch(() => {})
      }
      pendientes.current.clear()
    }
    addEventListener('pagehide', vaciar)
    return () => { removeEventListener('pagehide', vaciar); vaciar() }
  }, [])

  /* Cambiar una carta: primero se ve en pantalla, después sale para el servidor. */
  function aplicar(clave, cantidad, estado) {
    setDatos((d) => {
      const cant = { ...d.cantidades }
      const est = { ...d.estados }
      if (cantidad > 0) {
        cant[clave] = cantidad
        if (estado) est[clave] = estado; else delete est[clave]
      } else {
        // Cantidad 0 es no tenerla, y entonces tampoco tiene condición.
        delete cant[clave]
        delete est[clave]
      }
      return { estados: est, cantidades: cant }
    })
    mandar(clave, cantidad, cantidad > 0 ? estado : null)
  }

  const resumen = useMemo(() => {
    if (!catalogo) return null
    let total = 0, tengo = 0, sobrantes = 0
    const cuenta = { bien: 0, perfecta: 0, reemplazar: 0 }
    const porFiltro = Object.fromEntries(FILTROS.map((f) => [f.id, 0]))

    for (const exp of catalogo) {
      for (const n of exp.lista) {
        const clave = `${exp.id}:${n}`
        const cant = cantidades[clave] ?? 0
        const est = estados[clave]
        total++
        if (cant > 0) {
          tengo++
          sobrantes += cant - 1
          cuenta[est ?? 'bien']++
        }
        for (const f of FILTROS) if (f.pasa(cant, est)) porFiltro[f.id]++
      }
    }
    return { total, tengo, sobrantes, porFiltro, ...cuenta }
  }, [catalogo, estados, cantidades])

  /* Un toque: si no la tenés, pregunta la condición. Si ya la tenés, suma una. */
  function tocar(clave, numero) {
    if (!cantidades[clave]) return setPreguntando({ clave, numero })
    aplicar(clave, cantidades[clave] + 1, estados[clave])
  }

  /* Mantener apretado: resta una. Al llegar a cero se olvida también la condición. */
  function restar(clave) {
    aplicar(clave, (cantidades[clave] ?? 0) - 1, estados[clave])
  }

  function responder(estado) {
    aplicar(preguntando.clave, 1, estado)
    setPreguntando(null)
  }

  async function cerrar() {
    await salir()
    setUsuario(null)
    setError(null)
  }

  /* Restaurar un respaldo: se manda entera y se pisa lo que había en la cuenta. */
  function restaurarCopia(archivo) {
    restaurar(archivo)
      .then((d) => reemplazarColeccion(d).then(() => { setDatos(d); setFallo(false) }))
      .catch((e) => setError(e.message ?? 'No pude leer ese archivo.'))
  }

  if (usuario === undefined) return <div className="hoja"><p className="cargando">Cargando…</p></div>
  if (!usuario) return <Entrar onEntro={setUsuario} />

  if (error) return (
    <div className="hoja">
      <p className="cargando">{error}</p>
      <p><button className="secundario" onClick={cerrar}>Salir</button></p>
    </div>
  )
  if (!catalogo) return <div className="hoja"><p className="cargando">Cargando…</p></div>

  const pct = (n) => (n / resumen.total) * 100

  return (
    <div className="hoja">
      <header className="encabezado">
        <h1>
          <img src="./logo.png" alt="Dragon Ball Z" width="1999" height="510" />
        </h1>
        <p>Mi colección · Cartas Cromeros · 2007–2008</p>

        <div className="avance">
          <span className="grande">{resumen.tengo}</span>
          <span className="de">de {resumen.total} cartas</span>
          {resumen.sobrantes > 0 && (
            <span className="sobrantes">
              {resumen.sobrantes} repetida{resumen.sobrantes > 1 ? 's' : ''} para cambiar
            </span>
          )}
        </div>
        <div className="barra">
          <span className="s-bien" style={{ width: `${pct(resumen.bien)}%` }} />
          <span className="s-perfecta" style={{ width: `${pct(resumen.perfecta)}%` }} />
          <span className="s-reemplazar" style={{ width: `${pct(resumen.reemplazar)}%` }} />
        </div>
      </header>

      <div className="herramientas">
        <div className="filtros">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              className={`filtro${filtro === f.id ? ' activo' : ''}`}
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
            >
              {f.label}
              <b>{resumen.porFiltro[f.id]}</b>
            </button>
          ))}
        </div>

        <p className="ayuda">
          Tocá para marcar · de nuevo si tenés otra igual · mantené apretado para restar
        </p>
      </div>

      {catalogo.map((exp) => {
        const activo = FILTROS.find((f) => f.id === filtro)
        const visibles = exp.lista.filter((n) => {
          const clave = `${exp.id}:${n}`
          return activo.pasa(cantidades[clave] ?? 0, estados[clave])
        })
        if (!visibles.length) return null

        const tengoAca = exp.lista.filter((n) => cantidades[`${exp.id}:${n}`]).length
        return (
          <section className="expansion" key={exp.id}>
            <div className="banda" style={{ background: exp.color, color: textoSobre(exp.color) }}>
              <h2>{exp.nombre}</h2>
              <span className="rango">{exp.desde}–{exp.hasta}</span>
              <span className="cuenta">{tengoAca} de {exp.lista.length}</span>
            </div>
            <div className="grilla">
              {visibles.map((n) => {
                const clave = `${exp.id}:${n}`
                return (
                  <Carta
                    key={clave}
                    numero={n}
                    estado={estados[clave]}
                    cantidad={cantidades[clave] ?? 0}
                    onTocar={() => tocar(clave, n)}
                    onMantener={() => restar(clave)}
                  />
                )
              })}
            </div>
          </section>
        )
      })}

      {resumen.porFiltro[filtro] === 0 && (
        <p className="vacio">No hay ninguna carta en este listado.</p>
      )}

      <footer className="pie">
        {fallo ? (
          <span className="aviso">
            No se pudo guardar el último cambio. Fijate la conexión.
          </span>
        ) : (
          <span className="guardando">
            Guardando en tu cuenta, <b>{usuario}</b>, a cada cambio
          </span>
        )}

        <button onClick={() => descargar(datos)} className="secundario">Bajar una copia</button>
        <input
          ref={archivoRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(ev) => {
            const f = ev.target.files?.[0]
            if (f) restaurarCopia(f)
            ev.target.value = ''
          }}
        />
        <button onClick={() => archivoRef.current.click()} className="secundario">
          Restaurar una copia
        </button>
        <button onClick={cerrar} className="secundario">Salir</button>
      </footer>

      {preguntando && (
        <Pregunta
          numero={preguntando.numero}
          onElegir={responder}
          onCerrar={() => setPreguntando(null)}
        />
      )}
    </div>
  )
}
