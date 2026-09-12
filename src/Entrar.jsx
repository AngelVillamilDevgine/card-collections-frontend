// La pantalla de entrada. Un solo formulario que hace las dos cosas: si no tenés
// cuenta, la crea. Dos pantallas separadas para dos campos iguales no se justifican.
//
// No usa la clase .hoja del resto de la app: acá no hay contenido que fluya hacia
// abajo, hay una sola cosa y va en el medio de la pantalla.
import { useState } from 'react'
import { entrar, registrarse } from './almacenamiento'

export default function Entrar({ onEntro }) {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [error, setError] = useState(null)
  const [yendo, setYendo] = useState(false)

  async function enviar(ev) {
    ev.preventDefault()
    setError(null)
    setYendo(true)
    try {
      onEntro(await (nuevo ? registrarse : entrar)(usuario.trim(), clave))
    } catch (e) {
      setError(e.message)
      setYendo(false)
    }
  }

  return (
    <main className="entrada">
      <div className="entrada-caja">
        <img className="entrada-logo" src="./logo.png" alt="Dragon Ball Z"
             width="1999" height="510" />
        <p className="entrada-bajada">Mi colección · Cartas Cromeros · 2007–2008</p>

        <form className="entrar" onSubmit={enviar}>
          <label>
            Usuario
            <input
              value={usuario}
              onChange={(ev) => setUsuario(ev.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              autoFocus
              required
            />
          </label>

          <label>
            Clave
            <input
              type="password"
              value={clave}
              onChange={(ev) => setClave(ev.target.value)}
              autoComplete={nuevo ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <button type="submit" className="principal" disabled={yendo}>
            {yendo ? 'Un segundo…' : nuevo ? 'Crear mi colección' : 'Entrar'}
          </button>

          <button
            type="button"
            className="secundario"
            onClick={() => { setNuevo(!nuevo); setError(null) }}
          >
            {nuevo ? 'Ya tengo cuenta' : 'No tengo cuenta todavía'}
          </button>
        </form>
      </div>
    </main>
  )
}
