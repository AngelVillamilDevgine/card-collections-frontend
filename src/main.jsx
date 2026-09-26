import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './boundary'
import './estilos.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* El último recurso: sin esto, cualquier throw en render es una pantalla en blanco
        sin una letra. Ver boundary.jsx. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

/* El service worker no guarda nada (ver public/sw.js): está para que el teléfono la
   ofrezca como app. Si falla, la app anda igual — por eso el catch vacío. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
