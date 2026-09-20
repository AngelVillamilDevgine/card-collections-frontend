// La colección vive en el servidor, en la cuenta del usuario. Acá sólo queda el token
// de la sesión: es lo único que el navegador necesita recordar entre visitas.
//
// Antes esto hacía malabares — unir el archivo con localStorage, marcas de migrado,
// una guarda contra StrictMode — porque el dueño del archivo era el dev server de Vite
// y no había usuarios. Con cuentas de verdad nada de eso hace falta.
const CLAVE_TOKEN = 'dbz-cromeros-token'

// En desarrollo se usa el proxy de Vite, así el navegador ve un solo origen y no hay
// CORS que arreglar. En producción se le pega directo a la API, que vive en el mismo
// dominio que la app. Si algún día cambia, se cambia acá (o se pisa con VITE_API_URL).
const API = import.meta.env.DEV ? '' : 'https://api.cromeros.com.ar'
const RAIZ = (import.meta.env.VITE_API_URL ?? API).replace(/\/$/, '') + '/api'

import { comoApp } from './Instalar'

export class ErrorApi extends Error {}

/* Si está corriendo como app instalada, se lo cuenta al servidor. Va como parámetro y
   no como cabecera para que no haga falta un pedido de permiso previo (preflight), que
   en un teléfono con datos es un viaje de ida y vuelta al pedo. */
const marcaApp = () => (comoApp() ? '?app=1' : '')

export function token() {
  try { return localStorage.getItem(CLAVE_TOKEN) } catch { return null }
}

function recordarToken(t) {
  try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN) }
  catch { /* modo privado: la sesión dura lo que dure la pestaña */ }
}

/* Corte para un pedido que queda COLGADO — que no es lo mismo que uno que falla. Sin
   esto, una conexión que se queda esperando deja el guardado de esa carta en el aire
   para siempre y, como los envíos de una misma carta van encadenados, congela en
   silencio todos los guardados siguientes de esa carta. */
const CORTE = 15000

async function pedir(ruta, opciones = {}) {
  const t = token()
  let r
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(), CORTE)
  try {
    r = await fetch(RAIZ + ruta, {
      signal: corte.signal,
      ...opciones,
      headers: {
        ...(opciones.cuerpo !== undefined && { 'Content-Type': 'application/json' }),
        ...(t && { Authorization: `Bearer ${t}` }),
        ...opciones.headers,
      },
      ...(opciones.cuerpo !== undefined && { body: JSON.stringify(opciones.cuerpo) }),
    })
  } catch {
    throw new ErrorApi('Sin conexión con el servidor.')
  } finally {
    clearTimeout(reloj)
  }

  if (r.status === 401) {
    // El token venció o lo revocaron: no sirve de nada guardarlo.
    recordarToken(null)
    // Marcado, porque quien lo reciba tiene que hacer algo muy distinto que con un
    // error de red: no hay nada que reintentar, hay que volver a entrar.
    const muerta = new ErrorApi('Tenés que entrar de nuevo.')
    muerta.sesion = true
    throw muerta
  }
  if (!r.ok) {
    const dicho = await r.json().catch(() => null)
    throw new ErrorApi(dicho?.error ?? 'No se pudo completar la operación.')
  }
  return r.status === 204 ? null : r.json()
}

/* ------------------------------------ sesión ----------------------------------- */

// Devuelve la cuenta, no el nombre a secas: el front necesita saber además si es
// administrador, para mostrarle el panel de números.
async function entrarPor(ruta, usuario, clave) {
  const dicho = await pedir(ruta + marcaApp(), { method: 'POST', cuerpo: { usuario, clave } })
  recordarToken(dicho.token)
  return { usuario: dicho.usuario, admin: !!dicho.admin }
}

export const registrarse = (usuario, clave) => entrarPor('/registro', usuario, clave)
export const entrar = (usuario, clave) => entrarPor('/sesion', usuario, clave)

export async function salir() {
  await pedir('/sesion', { method: 'DELETE' }).catch(() => {})
  recordarToken(null)
}

// Al abrir: ¿el token guardado sigue sirviendo? Si no, se muestra la pantalla de entrada.
export async function quienSoy() {
  if (!token()) return null
  return pedir('/yo' + marcaApp()).then((d) => ({ usuario: d.usuario, admin: !!d.admin })).catch(() => null)
}

// Los números de toda la app. A quien no es administrador el servidor le contesta
// 404, así que el botón ni se dibuja.
export const estadisticas = () => pedir('/admin/resumen')

/* ---------------------------------- colección ---------------------------------- */

export const leerColeccion = () => pedir('/coleccion')

// Un toque manda sólo la carta que cambió, no las 1936.
// keepalive deja que el pedido termine aunque se cierre la pestaña: se usa para
// vaciar lo que todavía no salió cuando te vas.
export const guardarCarta = (clave, cantidad, estado, opciones = {}) =>
  pedir(`/cartas/${encodeURIComponent(clave)}`, {
    method: 'PUT',
    cuerpo: { cantidad, estado: estado ?? null },
    ...opciones,
  })

export const reemplazarColeccion = (datos) =>
  pedir('/coleccion', { method: 'PUT', cuerpo: datos })

/* ------------------------------- copias en disco ------------------------------- */

export function descargar(datos) {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mi-coleccion-dbz.json'
  a.click()
  URL.revokeObjectURL(url)
}

// Un respaldo puede ser viejo: sigue entendiendo las dos formas anteriores del archivo.
export function normalizar(datos) {
  if (!datos || typeof datos !== 'object') return { estados: {}, cantidades: {} }
  const estados = datos.estados ?? (datos.cantidades ? {} : datos)
  if (datos.cantidades) return { estados, cantidades: datos.cantidades }
  const cantidades = {}
  for (const clave of Object.keys(estados)) cantidades[clave] = 1 + (datos.repetidas?.[clave] ?? 0)
  return { estados, cantidades }
}

export function restaurar(archivo) {
  return archivo.text().then((t) => normalizar(JSON.parse(t)))
}
