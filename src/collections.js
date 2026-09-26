/* Las colecciones que la app sabe mostrar.
 *
 * Son DOS ÁLBUMES DISTINTOS y no dos vistas del mismo. Leyenda la hace Flash Gondor, no
 * Cromeros, y aunque reimprime las mismas cartas, agrupa los números en tramos distintos
 * (Expansión 5 es 544-679 en Cromeros y 551-726 en Leyenda). Angel lo pidió explícito:
 * «no compares con cromeros a las leyenda en lo posible». Así que no hay mapeo, ni
 * números equivalentes, ni un contador que sume las dos.
 *
 * Cada una es un archivo de catálogo propio en `public/data/`, que se lee en caliente.
 * Agregar una tercera es agregar un renglón acá y un json — nada más.
 */

export const COLLECTIONS = [
  { id: 'cromeros', nombre: 'Cromeros', archivo: 'data/expansiones.json' },
  { id: 'leyenda', nombre: 'Leyenda', archivo: 'data/leyenda.json' },
]

export const DEFAULT_COLLECTION = 'cromeros'

/* Qué álbum estás mirando es una preferencia de ESTE aparato, igual que qué expansiones
   dejaste plegadas: la compu y el celular se acuerdan cada uno del suyo. Por eso va en
   `localStorage` y no en la cuenta.

   Y NO va en el hash. El hash es de `#panel`, y ahí el argumento es que Atrás tiene que
   cerrar lo que tapa la pantalla. Cambiar de álbum no tapa nada, y Atrás deshaciendo cada
   cambio dejaría una pila de entradas invisibles. */
const CLAVE = 'dbz-cromeros-coleccion'

export function readCollection() {
  try {
    const guardada = localStorage.getItem(CLAVE)
    if (COLLECTIONS.some((c) => c.id === guardada)) return guardada
  } catch { /* modo privado */ }
  return DEFAULT_COLLECTION
}

export function rememberCollection(id) {
  try { localStorage.setItem(CLAVE, id) } catch { /* modo privado */ }
}

/* LA CLAVE DE UN CASILLERO, y acá está todo el diseño de las variantes.

   Una variante NO es una columna nueva ni un campo nuevo: es un SUFIJO en el id de la
   expansión. La 551 mate es `ley-5:551` y la 551 estrellada es `ley-5-e:551`. Son dos
   filas en la base, con la forma de clave que el servidor ya valida, así que no hay ni
   un ALTER, ni una migración, ni una sola fila que tocar.

   Y por eso el id de la variante va corto: entra en los 34 caracteres que `claveValida`
   acepta antes de los dos puntos. Hay un test que lo obliga (`leyenda.test.js`). */
export const slotKey = (expId, n, variantId) => `${expId}${variantId ? `-${variantId}` : ''}:${n}`

/* Los casilleros que hay que dibujar para un hueco del álbum: SIEMPRE el base, y cada
   variante de la que tengas al menos una.

   Que la variante sólo aparezca cuando la tenés es lo que deja la grilla igual que
   siempre mientras no uses ninguna: 1097 botones y punto. */
export function slotsOf(exp, n, variantes, cantidades) {
  const base = slotKey(exp.id, n)
  const conBase = (cantidades[base] ?? 0) > 0
  const deVariantes = []
  for (const v of variantes) {
    const clave = slotKey(exp.id, n, v.id)
    if ((cantidades[clave] ?? 0) > 0) deVariantes.push({ clave, variante: v })
  }

  /* Si no tenés ninguna, el hueco es UN casillero vacío: la carta que te falta. */
  if (!conBase && !deVariantes.length) return [{ clave: base, variante: null }]

  /* Y SI TENÉS LA VARIANTE PERO NO LA BASE, el casillero base NO se dibuja. Se llega ahí
     bajando la base a cero después de clasificar, y sin esta línea quedaba una carta en
     blanco diciendo «me falta» justo al lado de la misma carta que sí tenés — y el
     filtro «Me faltan» la contaba. Para volver a tener una sin clasificar se toca
     cualquier casillero del hueco y se elige «Sin clasificar». */
  return conBase ? [{ clave: base, variante: null }, ...deVariantes] : deVariantes
}

/* ¿Esta clave apunta a un hueco que existe? Se usa para las huérfanas, y la respuesta
   tiene que ser SÍ también cuando el sufijo de variante no está declarado.

   Si no, sacar una línea de `"variantes"` convertiría esas cartas en huérfanas y el pie
   ofrecería borrarlas — cuando en realidad siguen apuntando a un hueco que existe y lo
   único que pasó es que el catálogo dejó de saber cómo se llama ese fondo. Editar un
   JSON no puede ofrecer borrar cartas de verdad. */
export function pointsToASlot(clave, catalogos) {
  const corte = clave.lastIndexOf(':')
  if (corte < 0) return false
  const expParte = clave.slice(0, corte)
  const n = Number(clave.slice(corte + 1))
  if (!Number.isFinite(n)) return false
  for (const col of Object.values(catalogos ?? {})) {
    for (const exp of col?.expansiones ?? []) {
      const esLaBase = expParte === exp.id
      const esUnaVariante = expParte.startsWith(exp.id + '-')
      if ((esLaBase || esUnaVariante) && exp.lista.includes(n)) return true
    }
  }
  return false
}

/* Los números de una expansión. Un rango, que es lo único que usan los dos catálogos. */
export function numbersOf(exp) {
  const out = []
  for (let n = exp.desde; n <= exp.hasta; n++) out.push(n)
  return out
}

/* Se piden TODOS EN PARALELO, no encadenados: en 3G un viaje de más se nota, y ya está
   medido en este proyecto.
 *
 * Una que falla no voltea a las demás: devuelve `null` en su lugar. Eso deja que la app
 * ande con Cromeros aunque `leyenda.json` no esté todavía — que es exactamente el orden
 * en que se despliega, porque Pages sirve el bundle nuevo y los datos por separado. Lo
 * que sí importa es que quien use esto sepa distinguir «no cargó» de «cargó vacío»: de
 * eso depende que el pie no ofrezca borrar 1936 cartas. */
export function loadCatalogs(signal) {
  return Promise.all(
    COLLECTIONS.map((c) =>
      fetch(new URL(c.archivo, document.baseURI), { signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((raw) => [c.id, {
          ...raw,
          /* LAS VARIANTES SON POR EXPANSIÓN, y eso no es una generalización gratuita: las
             planillas de Leyenda tienen vocabularios distintos según el tramo. La
             Expansión 6 va con naranja / diamante / dorado / verde / plata / rojo / azul, y
             Personajes suma holo glitter, marrón, rosa vino, matrix, cyan, azul viento y
             fucsia. Una sola lista para toda la colección ofrecería catorce opciones de
             las cuales la mitad no existen para esa carta.

             Una expansión sin `variantes` propias hereda las de la colección, y si tampoco
             hay, no tiene ninguna — que es todo Cromeros. */
          expansiones: raw.expansiones.map((e) => ({
            ...e,
            lista: numbersOf(e),
            variantes: e.variantes ?? raw.variantes ?? [],
          })),
          /* Por omisión la colección usa la condición (buen estado / perfecta / para
             reemplazar). Leyenda dice `false` y ahí lo que se pregunta es la variante. */
          condicion: raw.condicion !== false,
          variantes: raw.variantes ?? [],
        }])
        .catch(() => [c.id, null])
    )
  ).then(Object.fromEntries)
}
