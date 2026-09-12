import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El front ya no guarda nada: se lo pide a la API. En desarrollo el proxy manda /api
// al servidor local, así que el navegador ve un solo origen y no hay CORS que arreglar.
// En producción lo construye Cloudflare con VITE_API_URL apuntando al servidor.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: process.env.DBZ_API ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
})
