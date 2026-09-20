// La pantalla de entrada. Un solo formulario que hace las dos cosas: si no tenés
// cuenta, la crea. Dos pantallas separadas para dos campos iguales no se justifican.
//
// No usa la clase .hoja del resto de la app: acá no hay contenido que fluya hacia
// abajo, hay una sola cosa y va en el medio de la pantalla.
import { useState } from 'react'
import { entrar, registrarse } from './almacenamiento'

export default function Entrar({ onEntro, aviso }) {
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
             width="660" height="168" />
        <p className="entrada-bajada">Mi colección · Cartas Cromeros · 2007–2008</p>

        <form className="entrar" onSubmit={enviar}>
          <label>
            {nuevo ? 'Tu mail' : 'Mail o usuario'}
            {/* type="email" sólo al crear la cuenta. Al entrar va de texto: hay cuentas
                viejas con nombre a secas, y el navegador no las dejaría escribirlo. */}
            <input
              type={nuevo ? 'email' : 'text'}
              value={usuario}
              onChange={(ev) => setUsuario(ev.target.value)}
              autoComplete={nuevo ? 'email' : 'username'}
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

          {/* Si llegaste acá porque se venció la sesión, que se diga: si no, la
              colección entera desaparece de golpe y sin ninguna explicación. */}
          {aviso && !error && <p className="aviso-sesion">{aviso}</p>}
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
