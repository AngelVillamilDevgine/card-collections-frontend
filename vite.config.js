import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = dirname(fileURLToPath(import.meta.url))

// El front ya no guarda nada: se lo pide a la API. En desarrollo el proxy manda /api
// al servidor local, así que el navegador ve un solo origen y no hay CORS que arreglar.
// En producción lo construye Cloudflare con VITE_API_URL apuntando al servidor.
/* LOS COMENTARIOS DEL HTML NO VIAJAN AL TELÉFONO DE NADIE. Vite no los saca —minifica el
   JS y el CSS, el HTML lo deja como está—, así que cada persona que abría la app se
   bajaba las explicaciones: MEDIDO el 2026-10-15, eran el 44% de `collection.html`, el
   32% de `login.html` y 6,7 KB de la landing. Lo vio Angel mirando el fuente servido.

   Se sacan ACÁ y no del archivo: lo que explican vale —el contrato del cartel de
   «Cargando…» entre tres archivos, por qué `resume.js` va bloqueante— y el lugar donde
   sirve es justo ese, al lado de la línea. Lo que no corresponde es que lo pague quien
   entra a marcar cartas.

   El `(?!\[if)` deja pasar los comentarios condicionales, que no son comentarios sino
   instrucciones para IE viejo. Hoy no hay ninguno; está para que agregar uno no se
   rompa en silencio. */
const stripHtmlComments = {
  name: 'sin-comentarios-en-el-html',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace(/<!--(?!\[if)[\s\S]*?-->\s*/g, ''),
  },
}

export default defineConfig({
  plugins: [react(), stripHtmlComments],
  base: './',
  build: {
    rollupOptions: {
      /* TRES PÁGINAS, TRES ARCHIVOS PLANOS. `index.html` es la landing y no carga el
         bundle; los otros dos son el mismo cascarón de la app.
       *
       * PLANOS Y NO CARPETAS, y eso está medido contra un preview real de Cloudflare
       * Pages: sirve `collection.html` en `/collection` sin ninguna redirección, mientras
       * que a una carpeta le agrega la barra final con un 308 (`/dir` → `/dir/`). Con
       * archivos planos, además, `./assets/…` resuelve desde `/collection` a `/assets/…`,
       * que es exactamente donde Vite los deja: el `base: './'` sigue andando sin tocar
       * nada, y la trampa de la barra final no existe.
       *
       * Y NO HACE FALTA `_redirects`. Se probó la regla de reescritura con código 200 y
       * Pages la devolvió como un 308, o sea que no se comporta como reescritura. Con tres
       * archivos de verdad no hay nada que reescribir. El fallback de SPA sigue vivo para
       * cualquier otra ruta, que cae en `index.html` — la landing, que es lo correcto para
       * una dirección que alguien tipeó mal.
       *
       * `login.html` y `collection.html` son casi iguales, y eso es una deuda conocida: el
       * contrato del cartel de «Cargando…» pasó de ser entre dos archivos a serlo entre
       * tres. Lo ata `test/pages.test.js`, que es más de lo que tenía antes. */
      input: {
        index: resolve(ROOT_DIR, 'index.html'),
        login: resolve(ROOT_DIR, 'login.html'),
        collection: resolve(ROOT_DIR, 'collection.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.DBZ_API ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
})
