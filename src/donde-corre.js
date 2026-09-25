// Dónde está corriendo la app: si es un teléfono, si es iPhone, si está adentro del
// navegador de otra aplicación, y si ya está instalada.
//
// Vivía adentro de Instalar.jsx, que es el único lugar que las usa para decidir qué
// mostrar. Se mudó acá por una razón concreta: `almacenamiento.js` necesita `comoApp()`
// para marcar la visita, y para traerla tenía que importar un archivo con JSX adentro.
// Eso hacía que el módulo que guarda la colección no se pudiera cargar fuera de Vite —
// ni siquiera para probarlo—, por una función de tres líneas que no dibuja nada.
//
// Es además el único lugar del código donde se mira el user agent. No hay alternativa:
// no existe ninguna API que diga "estás adentro de Instagram".

const ua = () => navigator.userAgent ?? ''

/* Corriendo como app instalada. `navigator.standalone` es el de iPhone, que no soporta
   la consulta de display-mode. */
export const comoApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

/* `navigator.userAgentData.mobile` es `false` en escritorio, no `undefined`, así que el
   `??` se queda con ese `false` y está bien. Donde no existe, se cae al par
   puntero-grueso + pantalla chica, que es lo más cerca que se puede estar sin mirar el
   user agent. */
export const esTelefono = () =>
  navigator.userAgentData?.mobile ??
  (window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth <= 900)

export const esIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) ||
  // El iPad hace años se declara Mac; lo delata que la pantalla sea táctil.
  (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1)

/* El navegador adentro de otra app (Instagram, Facebook, WhatsApp). Ahí no se puede
   instalar de ninguna manera, y es por donde llega la gente desde un link. */
export const enOtraApp = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/i.test(ua())
