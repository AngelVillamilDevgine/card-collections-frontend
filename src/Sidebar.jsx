import { useEffect, useRef } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'

/* LA BARRA LATERAL de la cuenta: «Mi perfil», «Panel» (sólo el admin) y «Colecciones».
 *
 * De escritorio para arriba (1024 px) está siempre a la vista, a la izquierda. Abajo de eso
 * es un cajón que abre el botón del encabezado, y se cierra con Escape, con Atrás, tocando
 * el telón o eligiendo algo. El visual sale de UKO: fondo blanco, secciones en versalitas,
 * ítems redondeados con ícono y el activo como píldora teñida.
 *
 * «Colecciones» abre el diálogo que elige cuáles se ven en el selector. */

const ICONS = {
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
  panel: (
    <>
      <path d="M5 20v-7M12 20V5M19 20v-10" />
    </>
  ),
  collections: (
    <>
      <rect x="3" y="7" width="13" height="14" rx="2.2" />
      <path d="M8 3h10a3 3 0 0 1 3 3v11" />
    </>
  ),
}

function Icon({ name }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}

export default function Sidebar({ open, onClose, returnFocusTo, username, isAdmin, panelActive, panelAlert, panelLabel, onProfile, onPanel, onCollections }) {
  const box = useRef(null)
  useCloseOnEscape(() => { if (open) onClose() })
  // En el cajón (teléfono) el foco queda adentro mientras está abierto; en escritorio `open` nunca se prende.
  useEffect(() => (open ? trapFocus(box.current, returnFocusTo.current) : undefined), [open, returnFocusTo])

  return (
    <>
      <div className={`sidebar-scrim${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Menú de la cuenta" ref={box}>
        <div className="sidebar-brand">
          <img src="./icono-192.png" alt="" width="36" height="36" />
          <button type="button" className="sidebar-close" aria-label="Cerrar el menú" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="sidebar-label">Cuenta</p>
        <ul className="sidebar-list">
          <li>
            <button type="button" className="sidebar-item" onClick={onProfile}>
              <Icon name="profile" /><span>Mi perfil</span>
            </button>
          </li>
          {isAdmin && (
            <li>
              <button type="button"
                      className={`sidebar-item${panelActive ? ' active' : ''}${panelAlert ? ' has-alert' : ''}`}
                      aria-label={panelLabel} aria-current={panelActive ? 'page' : undefined}
                      onClick={onPanel}>
                <Icon name="panel" /><span>Panel</span>
              </button>
            </li>
          )}
          <li>
            <button type="button" className="sidebar-item" onClick={onCollections}>
              <Icon name="collections" /><span>Colecciones</span>
            </button>
          </li>
        </ul>

        <div className="sidebar-user">
          <span className="sidebar-avatar" aria-hidden="true">{(username ?? '?').slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-username">{username}</span>
        </div>
      </nav>
    </>
  )
}
