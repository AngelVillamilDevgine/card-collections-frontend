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
  return pedir('/yo' + marcaApp())
    .then((d) => ({ usuario: d.usuario, admin: !!d.admin }))
    /* `null` quiere decir UNA sola cosa: no hay sesión, andá al formulario. Antes se
       tragaba cualquier error y devolvía null igual, así que el servidor caído, un
       deploy a medio terminar o el teléfono sin datos te mandaban al mismo lugar que
       una sesión vencida: parecía que había que volver a escribir la clave, cuando lo
       único que hacía falta era esperar. Lo demás sube, y la app lo muestra como lo
       que es, con un botón de reintentar. */
    .catch((e) => { if (e?.sesion) return null; throw e })
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

export function descargar(datos, nombre = 'mi-coleccion-dbz.json') {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  /* El <a> tiene que estar EN el documento, y la URL no se puede soltar en el mismo
     instante del click: revocarla ahí es una carrera con el navegador, que todavía no
     empezó a bajar nada. Antes andaba en Chrome por suerte y no por diseño — es el
     patrón que falla en Firefox —, y en headless directamente no bajaba nada.

     Ahora de esto depende la copia de seguridad que se baja antes de reemplazar la
     colección, así que no puede andar por suerte. */
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  /* Un minuto, no un segundo. Se midió con el navegador: con un segundo, la descarga
     empieza, recibe los bytes y el navegador la CANCELA — la URL se soltó antes de que
     terminara de escribir el archivo. La memoria de un blob de dos kilobytes no es
     problema; perder la copia de seguridad, sí. */
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 60000)
}

/* Qué cuenta como una copia de la colección, y qué no.

   Esto ANTES no fallaba nunca: cualquier cosa que no entendiera —un `null`, una lista,
   un `{}`, el json de otra cosa— se convertía en una colección VACÍA perfectamente
   válida, el servidor la aceptaba y te borraba todo contestando 200. Sin preguntar y sin
   avisar. Era el único camino de la app que borraba en masa, y el que menos validaba.

   Ahora, lo que no se reconoce se rechaza. Sigue entendiendo las dos formas anteriores
   del archivo, porque un respaldo puede ser viejo. Devuelve `null` si no es una copia. */
const esMapa = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// La forma de una clave de carta, para reconocer la forma más vieja del archivo.
const PARECE_CARTA = /^[a-z0-9-]{1,40}:\d{1,5}$/

export function normalizar(datos) {
  if (!esMapa(datos)) return null

  // La forma de hoy: { estados, cantidades }.
  if (esMapa(datos.cantidades))
    return { estados: esMapa(datos.estados) ? datos.estados : {}, cantidades: datos.cantidades }

  // Una anterior: { estados, repetidas }.
  if (esMapa(datos.estados)) {
    const cantidades = {}
    for (const clave of Object.keys(datos.estados))
      cantidades[clave] = 1 + (datos.repetidas?.[clave] ?? 0)
    return { estados: datos.estados, cantidades }
  }

  // La más vieja: un mapa de estados suelto. Se reconoce porque TODAS sus claves tienen
  // forma de carta; si alguna no, es otro archivo cualquiera y no se toca nada.
  const claves = Object.keys(datos)
  if (claves.length && claves.every((c) => PARECE_CARTA.test(c))) {
    const cantidades = {}
    for (const clave of claves) cantidades[clave] = 1
    return { estados: datos, cantidades }
  }

  return null
}

export function restaurar(archivo) {
  return archivo.text().then((t) => {
    let crudo
    try {
      crudo = JSON.parse(t)
    } catch {
      throw new ErrorApi('Ese archivo no es un .json válido.')
    }
    const datos = normalizar(crudo)
    if (!datos) throw new ErrorApi('Ese archivo no parece una copia de tu colección.')
    return datos
  })
}
