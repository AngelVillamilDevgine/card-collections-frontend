/* Service worker mínimo, y a propósito.

   No cachea nada. La colección vive en el servidor y esa es la única fuente: una copia
   vieja guardada en el teléfono sería justo el lío que esta app se sacó de encima
   cuando dejó de haber un archivo local. Si no hay internet, que falle y se vea.

   Está para una sola cosa: que el navegador la considere instalable y ofrezca el
   "agregar a pantalla de inicio" como app y no como acceso directo. El `fetch` vacío
   alcanza para eso — lo que se mira es que haya un manejador, no qué hace. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
