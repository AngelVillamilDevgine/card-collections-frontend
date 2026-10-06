// La pantalla de entrada. Un solo formulario que hace las dos cosas: si no tenés
// cuenta, la crea. Dos pantallas separadas para dos campos iguales no se justifican.
//
// No usa la clase .sheet del resto de la app: acá no hay contenido que fluya hacia
// abajo, hay una sola cosa y va en el medio de la pantalla.
import { useEffect, useState } from 'react'
import { login, signup, pulse } from './api'
import { albumNames } from './collections'
import { whatsappTo, forgotPasswordText } from './contact'

/* LA LLEGADA AL FORMULARIO, para la pasarela del panel: con qué botón de la landing se
   llegó (`?f=`), o directo. Lista cerrada — lo que no está acá cuenta como directo, así
   que un enlace pegado con una `f` inventada no estrena claves. Los valores son los
   mismos literales que pone `index.html` y que acepta `PULSE_KEYS` en el backend; el
   contrato de este lado lo ata `pages.test.js`.

   La marca es de MÓDULO y no un estado: una llegada es una carga de página. Salir y
   volver a caer en el formulario no es una llegada nueva, y el doble montaje de
   StrictMode tampoco. */
const FROM = new Set(['hero', 'closing', 'hero-acct', 'closing-acct'])
let arrivalSent = false

/* Quien se olvida la clave no tiene ningún camino solo: no hay mail de recupero ni
   cambio de clave (la app no manda correo, y el servidor tampoco puede: rebota antes de
   llegar a Gmail). Así que el camino es hablar con Angel, y que sea de un toque.
   El texto ya viene escrito y dice de qué sitio se trata: él atiende varios. El número y
   los textos viven en contact.js, que usa también el pie de la app. */

export default function Login({ onLogin, notice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  /* La landing tiene dos botones que llevan al mismo lugar: «Anotá tus faltantes» viene con
     `?new=1` y «Ya tengo cuenta» sin nada. Sale de la dirección y no de otro lado para que
     el enlace se pueda pegar en cualquier parte y siga queriendo decir lo mismo. */
  const [isSignup, setIsSignup] = useState(() => {
    try { return new URLSearchParams(location.search).get('new') === '1' } catch { return false }
  })
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (arrivalSent) return
    arrivalSent = true
    let f = null
    try { f = new URLSearchParams(location.search).get('f') } catch { /* sin query */ }
    pulse(FROM.has(f) ? `login:${f}` : 'login:direct')
  }, [])

  async function handleSubmit(ev) {
    ev.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      onLogin(await (isSignup ? signup : login)(username.trim(), password))
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <main className="login">
      <div className="login-box">
        <img className="login-logo" src="./logo.png" alt="Dragon Ball Z"
             width="660" height="168" />
        {/* Los álbumes salen de `COLLECTIONS`: acá decía «Cartas Cromeros · 2007–2008» y
            quedó sin cambiar el día que entró Leyenda, que es de otra editorial y de otra
            década. Es lo primero que lee alguien que llega. */}
        <p className="login-tagline">Mi colección · {albumNames()}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            {isSignup ? 'Tu mail' : 'Mail o usuario'}
            {/* type="email" sólo al crear la cuenta. Al entrar va de texto: hay cuentas
                viejas con nombre a secas, y el navegador no las dejaría escribirlo. */}
            <input
              type={isSignup ? 'email' : 'text'}
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              autoComplete={isSignup ? 'email' : 'username'}
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
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {/* Si llegaste acá porque se venció la sesión, que se diga: si no, la
              colección entera desaparece de golpe y sin ninguna explicación. */}
          {notice && !error && <p className="notice-session">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}

          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Un segundo…' : isSignup ? 'Crear mi colección' : 'Entrar'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => { setIsSignup(!isSignup); setError(null) }}
          >
            {isSignup ? 'Ya tengo cuenta' : 'No tengo cuenta todavía'}
          </button>

          {/* Sólo al entrar: a quien está creando la cuenta no se le perdió ninguna
              clave todavía. Se manda lo que haya escrito en el campo de usuario, así
              Angel no tiene que preguntar quién es. */}
          {!isSignup && (
            <a
              className="forgot"
              href={whatsappTo(forgotPasswordText(username.trim()))}
              target="_blank"
              rel="noopener noreferrer"
            >
              Me olvidé la clave
            </a>
          )}
        </form>
      </div>
    </main>
  )
}
