import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aca = dirname(fileURLToPath(import.meta.url))

// El front ya no guarda nada: se lo pide a la API. En desarrollo el proxy manda /api
// al servidor local, así que el navegador ve un solo origen y no hay CORS que arreglar.
// En producción lo construye Cloudflare con VITE_API_URL apuntando al servidor.
export default defineConfig({
  plugins: [react()],
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
        index: resolve(aca, 'index.html'),
        login: resolve(aca, 'login.html'),
        collection: resolve(aca, 'collection.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.DBZ_API ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
})
