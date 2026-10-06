/* «Mi perfil», en su propio archivo y cargado recién al tocar el ícono: el campo de WhatsApp
   trae la librería de teléfonos, y no tiene sentido que la baje todo el que abre la app para
   marcar cartas. El panel la comparte (muestra el WhatsApp de cada uno), así que Vite la
   deja en un pedazo aparte que bajan los dos. */
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'
import { getProfile, saveProfile } from './api'
import {
  canonical, countryOptions, dialCode, formatNational, fromStored, isTooLong,
  placeholderFor, readInput, toWire,
} from './phone'
import { PROVINCES, findProvinces, fold, resolveProvince } from './provinces'

const FIELDS = [
  ['firstName', 'Nombre', 'given-name'],
  ['middleName', 'Segundo nombre', 'additional-name'],
  ['lastName', 'Apellido', 'family-name'],
  ['whatsapp'],
  ['province'],
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

/* LA PROVINCIA: se escribe para buscar y se elige de la lista. Un combobox de los de la
   guía de ARIA y no un <select>, porque con 24 opciones escribir «cord» es más rápido que
   recorrerlas, y no un <datalist>, porque el del navegador no encuentra «Córdoba» si se
   escribe «cordoba», que es como lo escribe medio país desde el teléfono.

   - Escribir abre la lista filtrada, con la primera marcada: «cord» + Enter es Córdoba. Con
     el campo vacío no se marca ninguna: si no, borrar la provincia y apretar Enter elegía
     Buenos Aires.
   - Flechas para recorrer, Enter para elegir, Escape cierra la lista SIN cerrar el diálogo
     (la segunda Escape, con la lista cerrada, sí lo cierra). Tab se lleva la opción sólo
     si se llegó a ella con las flechas, no la que quedó marcada sola al escribir.
   - Tocar una opción la elige sin que el campo pierda el foco (onMouseDown la frena).
   - Lo que queda guardado lo decide resolveProvince, igual al salir, con Enter o con Guardar.
   - La lista se abre donde entra, medido contra lo que de verdad se ve: la caja del
     diálogo, que scrollea y recorta, y la pantalla menos el teclado del teléfono. */
const LIST_HEIGHT = 232

function ProvinceField({ value, onChange, disabled, invalid, describedBy, inputRef }) {
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false) // false: muestra las 24 aunque haya una elegida
  const [active, setActive] = useState(-1)
  const [room, setRoom] = useState({ up: false, max: LIST_HEIGHT })
  const navigated = useRef(false) // ¿la marcada la eligió con las flechas?
  const list = useRef(null)
  const options = filtering ? findProvinces(value) : PROVINCES
  const expanded = open && options.length > 0
  const unknown = !invalid && resolveProvince(value) === null && findProvinces(value).length === 0

  /* Medido contra la ventana —lo primero que se hizo— abría para abajo con lugar de sobra en
     la pantalla, pero la caja del diálogo recortaba los últimos 90 px de la lista. */
  function place() {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vv = window.visualViewport
    let top = vv ? vv.offsetTop : 0
    let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
    const box = el.closest('.dialog')?.getBoundingClientRect()
    if (box) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    const below = bottom - r.bottom - 8
    const above = r.top - top - 8
    const up = below < LIST_HEIGHT && above > below
    setRoom({ up, max: Math.max(88, Math.min(LIST_HEIGHT, up ? above : below)) })
  }

  function show(filter) {
    setFiltering(filter)
    const shown = filter ? findProvinces(value) : PROVINCES
    setActive(filter && fold(value) ? (shown.length ? 0 : -1) : shown.indexOf(value))
    navigated.current = false
    place()
    setOpen(true)
  }

  // El teclado del teléfono aparece DESPUÉS de abrir: se vuelve a medir.
  useEffect(() => {
    if (!open || !window.visualViewport) return
    const vv = window.visualViewport
    vv.addEventListener('resize', place)
    return () => vv.removeEventListener('resize', place)
  }, [open])

  /* La marcada a la vista moviendo SÓLO la lista. Con scrollIntoView se movía también el
     diálogo —la lista colgaba fuera de su caja—, y el toque siguiente, en el mismo lugar,
     caía sobre otra provincia y la elegía sin aviso. */
  useEffect(() => {
    const ul = list.current
    const li = ul?.children[active]
    if (!expanded || !li) return
    const pop = ul.parentElement
    if (li.offsetTop < pop.scrollTop) pop.scrollTop = li.offsetTop
    else if (li.offsetTop + li.offsetHeight > pop.scrollTop + pop.clientHeight)
      pop.scrollTop = li.offsetTop + li.offsetHeight - pop.clientHeight
  }, [expanded, active])

  function pick(name) {
    onChange(name)
    setOpen(false)
    setFiltering(false)
    setActive(-1)
  }

  function type(ev) {
    const text = ev.target.value
    /* Sin el foco, lo que llega es el autocompletado del navegador (que ignora el «off»):
       se resuelve como al salir y la lista no se abre, porque sin foco no habría blur que
       la cierre y quedaría tapando Guardar. */
    if (document.activeElement !== ev.target) {
      onChange(resolveProvince(text) ?? text)
      return
    }
    onChange(text)
    const shown = findProvinces(text)
    setFiltering(true)
    setActive(fold(text) && shown.length ? 0 : -1)
    navigated.current = false
    if (!open) place()
    setOpen(true)
  }

  function move(step) {
    navigated.current = true
    setActive((a) => {
      if (!options.length) return -1
      if (a < 0) return step > 0 ? 0 : options.length - 1
      return (a + step + options.length) % options.length
    })
  }

  function key(ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      if (!expanded) return show(filtering)
      move(ev.key === 'ArrowDown' ? 1 : -1)
    } else if (ev.key === 'Enter' && expanded) {
      // Con la lista a la vista, Enter elige; no manda el formulario.
      ev.preventDefault()
      if (active >= 0) pick(options[active])
      else setOpen(false)
    } else if (ev.key === 'Escape' && expanded) {
      // Cierra la lista y nada más: el diálogo escucha Escape en window, y esto lo frena antes.
      ev.preventDefault()
      ev.stopPropagation()
      setOpen(false)
    } else if (ev.key === 'Tab' && expanded && active >= 0 && navigated.current) {
      pick(options[active]) // sin preventDefault: el foco sigue de largo
    }
  }

  function leave() {
    setOpen(false)
    setActive(-1)
    setFiltering(false)
    const chosen = resolveProvince(value)
    if (chosen !== null && chosen !== value) onChange(chosen)
  }

  const hint = unknown ? 'profile-province-hint' : null
  return (
    <div className={`province${room.up ? ' up' : ''}`}>
      <input
        id="profile-province"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls="profile-province-list"
        aria-activedescendant={expanded && active >= 0 ? `profile-province-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, hint].filter(Boolean).join(' ') || undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        placeholder="Elegí o escribí la tuya"
        value={value}
        disabled={disabled}
        onChange={type}
        onKeyDown={key}
        onClick={() => (expanded ? setOpen(false) : show(false))}
        onBlur={leave}
      />
      <svg className="province-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
      {expanded && (
        // onMouseDown frena el blur del campo: sin eso, tocar una opción —o la barra de
        // desplazamiento de la lista— cerraba la lista antes del click.
        <div className="province-pop" style={{ maxHeight: room.max }} onMouseDown={(e) => e.preventDefault()}>
          <ul id="profile-province-list" role="listbox" aria-label="Provincias" ref={list}>
            {options.map((name, i) => (
              <li key={name} id={`profile-province-${i}`} role="option" aria-selected={i === active}
                  className={name === value ? 'chosen' : undefined}
                  onClick={() => pick(name)}
                  onMouseMove={() => i !== active && setActive(i)}>
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Abajo del campo y NO flotando: flotando caía justo encima de Guardar, y en el
          teléfono el toque le daba al cartel. Y depende de lo escrito, no del foco: si se
          fuera al salir del campo, todo lo de abajo subiría entre que se apoya el dedo en
          Guardar y se levanta, y el toque erraría el botón. Atado al campo por
          aria-describedby: si no, el lector no lo decía nunca. */}
      {unknown && <p className="province-none" id="profile-province-hint">Ninguna provincia se llama así.</p>}
    </div>
  )
}

/* Lo pidió Angel el 2026-09-30: con sólo un mail no hay forma de saber quién es quién ni de
   contactar a nadie. NADA ES OBLIGATORIO — un campo vacío es «no lo cargué» —, y la nota
   dice quién ve estos datos, porque pedir un WhatsApp sin decir para qué es la forma más
   rápida de que nadie lo complete. El PUT manda los cinco campos.

   GUARDAR BIEN CIERRA EL DIÁLOGO (Angel, 2026-09-30: «si toco guardar debería cerrar»), y
   que se cierre es la confirmación. Lo que no sale bien —un dato que no va, el servidor que
   no contesta, una provincia que el servidor todavía no conoce— lo deja abierto diciendo
   qué pasó, con lo tipeado intacto para corregirlo. */
export default function ProfileDialog({ onClose, onSessionExpired }) {
  const [form, setForm] = useState(null) // null mientras llega
  const [phone, setPhone] = useState(() => fromStored(''))
  const [account, setAccount] = useState('')
  const [error, setError] = useState(null)
  const [fieldError, setFieldError] = useState(null) // 'whatsapp' | 'province': el error va al lado de ése
  const [saving, setSaving] = useState(false)
  const box = useRef(null)
  const phoneInput = useRef(null)
  const provinceInput = useRef(null)
  const prevFocus = useRef(document.activeElement)

  useCloseOnEscape(onClose)
  useEffect(() => trapFocus(box.current, prevFocus.current), [])
  useEffect(() => {
    getProfile()
      .then(({ usuario: username, ...fields }) => {
        setAccount(username)
        setForm(fields)
        setPhone(fromStored(fields.whatsapp))
      })
      .catch((e) => (e?.sessionExpired ? onSessionExpired() : setError(e.message)))
  }, [])

  function flag(field, message, input) {
    setError(message)
    setFieldError(field)
    input.current?.focus()
  }

  async function submit(ev) {
    ev.preventDefault()
    setError(null)
    setFieldError(null)
    /* El número y la provincia se revisan acá antes de mandarlos, con la misma regla que el
       servidor: lo que no va se dice al lado del campo, sin viaje. */
    const wire = toWire(phone.country, phone.national)
    if (wire.error) return flag('whatsapp', wire.error, phoneInput)
    const province = resolveProvince(form.province ?? '')
    if (province === null) return flag('province', 'Elegí la provincia de la lista.', provinceInput)
    setSaving(true)
    try {
      const { usuario: username, ...fields } = await saveProfile({ ...form, whatsapp: wire.value, province })
      /* Un servidor que todavía no sabe de provincias —el rato de un deploy, o un rollback—
         guarda todo lo demás y la tira sin decir nada. Se dice, y no se borra del campo. */
      if (!('province' in fields)) {
        setForm({ ...fields, province })
        setPhone(fromStored(fields.whatsapp))
        setError('Se guardó todo menos la provincia: la app se está actualizando. Probá de nuevo en unos minutos.')
      } else {
        return onClose()
      }
    } catch (e) {
      if (e?.sessionExpired) return onSessionExpired()
      setError(e.message)
    }
    setSaving(false)
  }

  function edited(field) {
    if (fieldError === field) { setFieldError(null); setError(null) }
  }
  const change = (key) => (ev) => {
    setForm((f) => ({ ...f, [key]: ev.target.value }))
    edited(key)
  }
  function changePhone(next) {
    setPhone(next)
    edited('whatsapp')
  }
  function changeProvince(text) {
    setForm((f) => ({ ...f, province: text }))
    edited('province')
  }

  /* El error del campo, al lado del campo y atado a él: abajo de todo, el lector anunciaba
     «entrada no válida» sin decir por qué al volver al campo. */
  const errorOf = (field) => fieldError === field && (
    <p className="error" id={`profile-${field}-error`} role="alert">{error}</p>
  )
  const describe = (field) => (fieldError === field ? `profile-${field}-error` : undefined)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Mi perfil"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Mi perfil</h3>
        {/* Región viva SIEMPRE en el DOM, con el texto cambiando adentro — la regla de
            este proyecto para que el cambio de «Cargando…» se anuncie. */}
        <p className="dialog-note" role="status">
          {form === null && !error
            ? 'Cargando…'
            : 'Nada es obligatorio. Lo que completes lo ve sólo el administrador de la app, para poder contactarte.'}
        </p>
        {account && <p className="profile-account">Tu cuenta: <b>{account}</b></p>}
        <form className="login-form" onSubmit={submit} noValidate>
          {FIELDS.map(([key, label, autoComplete]) => key === 'whatsapp'
            ? (
              <div className="stacked-field" key={key}>
                <label htmlFor="profile-whatsapp">WhatsApp</label>
                <PhoneField value={phone} onChange={changePhone} disabled={form === null}
                            invalid={fieldError === 'whatsapp'} inputRef={phoneInput}
                            describedBy={describe('whatsapp')} />
                {errorOf('whatsapp')}
              </div>
            )
            : key === 'province'
              ? (
                <div className="stacked-field" key={key}>
                  <label htmlFor="profile-province">Provincia</label>
                  <ProvinceField value={form?.province ?? ''} onChange={changeProvince} disabled={form === null}
                                 invalid={fieldError === 'province'} inputRef={provinceInput}
                                 describedBy={describe('province')} />
                  {errorOf('province')}
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
                    maxLength={60}
                  />
                </label>
              ))}
          {error && !fieldError && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={saving || form === null}>
            {saving ? 'Un segundo…' : 'Guardar'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
        </form>
      </div>
    </div>
  )
}
