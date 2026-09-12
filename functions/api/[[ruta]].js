// Todo lo que la app pide a /api pasa por acá y se reenvía al VPS.
//
// Existe porque la API no tiene dominio propio: no hay forma de crear un registro DNS
// en devgine.com.ar. Como el front ya pide /api sobre su propio origen, esta Function
// intercepta justo esas llamadas. De paso no hay CORS: para el navegador es el mismo sitio.
//
// El tramo de acá al VPS va por HTTP sin cifrar. Es una decisión tomada a sabiendas
// (ver el README). La cabecera secreta autentica a esta Function contra la API, pero
// no cifra nada: quien esté en el camino ve lo que pasa, claves de login incluidas.

export async function onRequest({ request, env }) {
  const origen = env.DBZ_API_ORIGEN
  const secreto = env.DBZ_SECRETO_PROXY

  if (!origen || !secreto) {
    return Response.json(
      { error: 'El front no está configurado: faltan DBZ_API_ORIGEN o DBZ_SECRETO_PROXY.' },
      { status: 500 }
    )
  }

  const pedida = new URL(request.url)
  const destino = origen.replace(/\/$/, '') + pedida.pathname + pedida.search

  const cabeceras = new Headers(request.headers)
  cabeceras.set('X-Dbz-Proxy', secreto)
  // El Host de Cloudflare no le sirve de nada a la API y confunde al proxy.
  cabeceras.delete('host')
  // Sin esto, la API vería a todos los usuarios con la misma IP —la de Cloudflare— y el
  // freno de intentos de login sería uno solo para todos: diez claves erradas de
  // cualquiera y quedan todos afuera.
  const suIp = request.headers.get('CF-Connecting-IP')
  if (suIp) cabeceras.set('X-Forwarded-For', suIp)

  const sinCuerpo = request.method === 'GET' || request.method === 'HEAD'

  let respuesta
  try {
    respuesta = await fetch(destino, {
      method: request.method,
      headers: cabeceras,
      body: sinCuerpo ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    })
  } catch {
    // Que el usuario vea "no hay servidor" y no una pantalla en blanco.
    return Response.json({ error: 'No se pudo hablar con el servidor.' }, { status: 502 })
  }

  // Se devuelve tal cual vino: el estado y el cuerpo son los que espera la app.
  return new Response(respuesta.body, {
    status: respuesta.status,
    headers: { 'Content-Type': respuesta.headers.get('Content-Type') ?? 'application/json' },
  })
}
