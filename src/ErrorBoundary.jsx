import { Component } from 'react'

/* Lo único que hace esto es que un error de render no sea una pantalla en blanco.
 *
 * React desmonta el árbol ENTERO cuando un render tira y nadie lo atrapa: no queda el
 * encabezado, ni el pie, ni una letra que explique qué pasó, y la única salida es que al
 * usuario se le ocurra recargar. Un `Suspense` no sirve para esto — atrapa la espera, no
 * el error.
 *
 * Hizo falta el día que el panel del administrador pasó a `React.lazy`: si ese `import()`
 * rechaza, el error sube hasta la raíz. Y el camino más probable no es un bache de red:
 * es tener la pestaña abierta de antes de un deploy de Pages y abrir el panel después,
 * porque producción sirve sólo los assets del deploy actual y el chunk con el hash viejo
 * devuelve 404. O sea: le pega justo a quien está desplegando.
 *
 * Va en DOS lugares y no en uno, y la diferencia importa:
 *
 * - Alrededor del panel, para que un panel que no baja NO se lleve puesta la colección.
 *   Ahí el respaldo es chico y la app sigue viva atrás.
 * - En la raíz, como último recurso para cualquier otro throw en render.
 *
 * `onReset` es opcional: si viene, el botón lo llama y se vuelve a intentar sin recargar.
 * Si no, el botón recarga la página, que es lo único honesto cuando no sabemos qué se
 * rompió.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    // A la consola y nada más: no hay a dónde mandarlo, y tragárselo entero deja a
    // cualquiera que abra las herramientas sin la única pista que hay.
    console.error('Se rompió al dibujar:', error)
  }

  retry = () => {
    this.setState({ hasError: false })
    if (this.props.onReset) this.props.onReset()
    else location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="sheet">
        <p className="loading">{this.props.message ?? 'Algo se rompió en la pantalla.'}</p>
        <p className="error-actions">
          <button className="retry" onClick={this.retry}>
            {this.props.onReset ? 'Reintentar' : 'Recargar'}
          </button>
        </p>
      </div>
    )
  }
}
