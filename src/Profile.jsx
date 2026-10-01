/* «Mi perfil», en su propio archivo y cargado recién al tocar el ícono: el campo de WhatsApp
   trae la librería de teléfonos, y no tiene sentido que la baje todo el que abre la app para
   marcar cartas. El panel la comparte (muestra el WhatsApp de cada uno), así que Vite la
   deja en un pedazo aparte que bajan los dos. */
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { atraparFoco, usarEscape } from './foco'
import { getProfile, saveProfile } from './almacenamiento'
import {
  canonical, countryOptions, dialCode, formatNational, fromStored, isTooLong,
  placeholderFor, readInput, toWire,
} from './phone'

const FIELDS = [
  ['firstName', 'Nombre', 'given-name'],
  ['middleName', 'Segundo nombre', 'additional-name'],
  ['lastName', 'Apellido', 'family-name'],
  ['whatsapp'],
  ['city', 'Ciudad', 'address-level2'],
]

/* Las banderas son SVG sueltos de `country-flag-icons` (de 250 bytes a 5 KB): cada una se
   baja recién cuando se elige su país, así que la lista entera no pesa nada. */
const FLAGS = import.meta.glob('/node_modules/country-flag-icons/3x2/*.svg', { query: '?url', import: 'default' })

function Flag({ country }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    const load = FLAGS[`/node_modules/country-flag-icons/3x2/${country}.svg`]
    if (!load) setSrc(null)
    else load().then((url) => { if (alive) setSrc(url) }, () => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [country])
  return src
    ? <img className="phone-flag" src={src} alt="" width="21" height="14" />
    : <span className="phone-flag" aria-hidden="true" />
}

/* El cursor se ubica contando dígitos, porque el formato mueve los espacios y el guion: si
   no, cada tecla en el medio del número lo mandaba al final. El «+» cuenta sólo cuando
   arranca un número internacional; en el medio de uno de acá no es nada. */
const isNum = (ch) => ch >= '0' && ch <= '9'
const counts = (plus) => (ch) => isNum(ch) || (plus && ch === '+')
const countDigits = (text, plus) => [...text].filter(counts(plus)).length
const indexOfDigit = (text, n, plus) => {
  const ok = counts(plus)
  for (let i = 0, seen = 0; i < text.length; i++) if (ok(text[i]) && ++seen === n) return i
  return -1
}
const caretAfter = (text, n) => {
  const plus = text.startsWith('+')
  return n <= 0 ? 0 : n >= countDigits(text, plus) ? text.length : indexOfDigit(text, n, plus) + 1
}

/* El WhatsApp: bandera y código del país adelante —un <select> de verdad, invisible encima,
   para que en el teléfono se abra la lista del sistema—, y el número partido como lo dice
   cada uno. Las letras no entran. */
function PhoneField({ value, onChange, disabled, invalid, describedBy, inputRef }) {
  const { country, national } = value
  const countries = useMemo(countryOptions, [])
  const shown = formatNational(country, national)
  const caret = useRef(null)
  const selection = useRef(null) // cómo estaba la selección ANTES de la tecla

  useLayoutEffect(() => {
    const el = inputRef.current
    if (caret.current === null || !el || document.activeElement !== el) return
    const at = caretAfter(shown, caret.current)
    el.setSelectionRange(at, at)
    caret.current = null
  })

  const remember = (ev) => { selection.current = [ev.target.selectionStart, ev.target.selectionEnd] }

  function type(ev) {
    const el = ev.target
    const kind = ev.nativeEvent?.inputType
    let text = el.value
    let prefix = text.slice(0, el.selectionStart ?? text.length)
    /* Un «+» tecleado delante de un número que ya está no arranca uno internacional: el 351
       de Córdoba se volvía el código de Portugal. Se ignora. Pegado o autocompletado sí
       vale, porque reemplaza todo, y también en el campo vacío. */
    if (kind === 'insertText' && national && !national.startsWith('+') && /\d/.test(text.replace(/\+/g, ''))) {
      text = text.replace(/\+/g, '')
      prefix = prefix.replace(/\+/g, '')
    }
    const plus = text.replace(/[^\d+]/g, '').startsWith('+')
    let before = countDigits(prefix, plus)
    /* Borrar un espacio o un guion no borraría nada: el formato lo vuelve a poner y la tecla
       parece muerta. Se borra el dígito de al lado, que es lo que se quería — pero sólo con
       el cursor quieto: si lo seleccionado era el guion y nada más, no se borra nada. */
    const [from, to] = selection.current ?? [0, 0]
    if (from === to && countDigits(text, plus) === countDigits(shown, plus) && text.length < shown.length) {
      if (kind === 'deleteContentBackward' && before > 0) {
        const at = indexOfDigit(text, before, plus)
        text = text.slice(0, at) + text.slice(at + 1)
        before -= 1
      } else if (kind === 'deleteContentForward') {
        const at = indexOfDigit(text, before + 1, plus)
        if (at >= 0) text = text.slice(0, at) + text.slice(at + 1)
      }
    }
    const next = readInput(country, text)
    /* Una tecla de más no entra. Borrar sí, siempre: un número que quedó largo al cambiar de
       país tiene que poder corregirse. Y el cursor se queda donde estaba: React repone el
       valor y el navegador lo manda al final, y el Backspace siguiente borraba otro dígito. */
    if (next.national.length > national.length && isTooLong(next.country, next.national)) {
      const keep = before - Math.max(0, countDigits(text, plus) - countDigits(shown, plus))
      setTimeout(() => {
        if (document.activeElement !== el) return
        const at = caretAfter(el.value, keep)
        el.setSelectionRange(at, at)
      })
      return
    }
    // Si el país salió del «+», el código se mudó a la bandera: el cursor va al final.
    caret.current = next.country === country && !plus ? before : Infinity
    onChange(next)
  }

  /* El foco NO salta al número al elegir país: con el teclado, cada flecha de un select
     cerrado es un «change», y saltar en la primera dejaba elegir de a un país (y lo que se
     tipeaba para buscar «uru» caía en el número). */
  const pickCountry = (ev) => onChange({ country: ev.target.value, national })

  return (
    <div className="phone">
      <span className="phone-country">
        <Flag country={country} />
        {/* Escondido para el lector: el select ya dice «Argentina +54». */}
        <span className="phone-dial" aria-hidden="true">+{dialCode(country)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
        <select value={country} onChange={pickCountry} disabled={disabled} aria-label="País del WhatsApp">
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name} +{c.dial}</option>)}
        </select>
      </span>
      <input
        id="profile-whatsapp"
        ref={inputRef}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={shown}
        onChange={type}
        onKeyDown={remember}
        onSelect={remember}
        onBlur={() => {
          const tidy = canonical(country, national)
          if (tidy.country !== country || tidy.national !== national) onChange(tidy)
        }}
        placeholder={placeholderFor(country)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
    </div>
  )
}

/* Lo pidió Angel el 2026-09-30: con sólo un mail no hay forma de saber quién es quién ni de
   contactar a nadie. NADA ES OBLIGATORIO — un campo vacío es «no lo cargué» —, y la nota
   dice quién ve estos datos, porque pedir un WhatsApp sin decir para qué es la forma más
   rápida de que nadie lo complete. El PUT manda los cinco campos y el servidor contesta con
   cómo quedaron: lo que se muestra después de guardar es lo guardado, no lo tipeado. */
export default function ProfileDialog({ onClose, onSesionMuerta }) {
  const [form, setForm] = useState(null) // null mientras llega
  const [phone, setPhone] = useState(() => fromStored(''))
  const [account, setAccount] = useState('')
  const [error, setError] = useState(null)
  const [phoneError, setPhoneError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const box = useRef(null)
  const phoneInput = useRef(null)
  const prevFocus = useRef(document.activeElement)

  usarEscape(onClose)
  useEffect(() => atraparFoco(box.current, prevFocus.current), [])
  useEffect(() => {
    getProfile()
      .then(({ usuario, ...fields }) => {
        setAccount(usuario)
        setForm(fields)
        setPhone(fromStored(fields.whatsapp))
      })
      .catch((e) => (e?.sesion ? onSesionMuerta() : setError(e.message)))
  }, [])

  async function submit(ev) {
    ev.preventDefault()
    setError(null)
    setPhoneError(false)
    /* El número se revisa acá antes de mandarlo, con la misma regla que el servidor: un
       número a medias se dice al lado del campo, sin viaje. */
    const wire = toWire(phone.country, phone.national)
    if (wire.error) {
      setError(wire.error)
      setPhoneError(true)
      phoneInput.current?.focus()
      return
    }
    setSaving(true)
    try {
      const { usuario, ...fields } = await saveProfile({ ...form, whatsapp: wire.value })
      setForm(fields)
      setPhone(fromStored(fields.whatsapp))
      setSaved(true)
    } catch (e) {
      if (e?.sesion) return onSesionMuerta()
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const change = (key) => (ev) => {
    setForm((f) => ({ ...f, [key]: ev.target.value }))
    setSaved(false)
  }

  function changePhone(next) {
    setPhone(next)
    setSaved(false)
    if (phoneError) { setPhoneError(false); setError(null) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Mi perfil"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Mi perfil</h3>
        {/* Región viva SIEMPRE en el DOM, con el texto cambiando adentro — la regla de
            este proyecto para que el «Guardado» se anuncie. */}
        <p className="dialog-note" role="status">
          {form === null && !error
            ? 'Cargando…'
            : saved
              ? 'Guardado.'
              : 'Nada es obligatorio. Lo que completes lo ve sólo el administrador de la app, para poder contactarte.'}
        </p>
        {account && <p className="profile-account">Tu cuenta: <b>{account}</b></p>}
        <form className="login-form" onSubmit={submit} noValidate>
          {FIELDS.map(([key, label, autoComplete]) => key === 'whatsapp'
            ? (
              <div className="phone-field" key={key}>
                <label htmlFor="profile-whatsapp">WhatsApp</label>
                <PhoneField value={phone} onChange={changePhone} disabled={form === null}
                            invalid={phoneError} inputRef={phoneInput}
                            describedBy={phoneError ? 'profile-whatsapp-error' : undefined} />
                {/* Al lado del campo y atado a él: abajo de todo, el lector anunciaba
                    «entrada no válida» sin decir por qué al volver al campo. */}
                {phoneError && <p className="error" id="profile-whatsapp-error" role="alert">{error}</p>}
              </div>
            )
            : (
              <label key={key}>
                {label}
                <input
                  type="text"
                  value={form?.[key] ?? ''}
                  onChange={change(key)}
                  autoComplete={autoComplete}
                  disabled={form === null}
                  maxLength={key === 'city' ? 80 : 60}
                />
              </label>
            ))}
          {error && !phoneError && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={saving || form === null}>
            {saving ? 'Un segundo…' : 'Guardar'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
        </form>
      </div>
    </div>
  )
}
