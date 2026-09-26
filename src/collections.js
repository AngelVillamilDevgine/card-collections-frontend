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

/* LAS VARIANTES VAN POR GRUPO DE CARTAS, no por expansión, y esto es el corazón del
 * diseño — la primera versión lo tuvo mal y el bug se veía en la pantalla.
 *
 * Decía: «esta expansión tiene estas doce variantes», y entonces las 176 cartas de
 * Personajes ofrecían las doce. Angel lo vio en dos minutos: «la 1069 no tiene variantes,
 * yo no te pasé nada, y vos estás suponiendo que tiene un montón», y después «en la 957
 * la app tiene muchas más variantes de las que corresponde». **Lo normal es que sólo
 * algunas cartas tengan**: de las 176 del mazo inicial, 48.
 *
 * Y no alcanza con una lista de cartas por expansión, porque EL VOCABULARIO CAMBIA
 * ADENTRO DE LA MISMA EXPANSIÓN. Las 36 cartas de «Metalizadas» se parten en dos bloques
 * de 18: uno sale en violeta y verde, el otro en azul viento y cyan, y ninguna carta sale
 * en los cuatro. Angel cortó la discusión de raz: «está diferenciado porque son diferentes
 * las variantes que vienen en la caja y en los sobres, estás buscando normalizar algo no
 * normalizado». Así que el grupo ES el dato, y se copia de la planilla tal cual.
 *
 * Una carta puede estar en más de un grupo — en la 4ta, los colores y el glitter son dos
 * planillas distintas — y ahí sus variantes son la unión. Una expansión con `variantes`
 * sueltas y sin grupos se lee como «todas sus cartas, estas variantes»; sin ninguna de
 * las dos no tiene variantes, que es todo Cromeros. */
function withVariants(e, raw) {
  const grupos = (e.grupos ?? []).map((g) => ({
    variantes: g.variantes ?? [],
    cartas: new Set(g.cartas ?? []),
  }))
  const sueltas = e.variantes ?? raw.variantes ?? []

  /* Todas las declaradas de la expansión, en orden y sin repetir. Es lo que se recorre
     para DIBUJAR los casilleros que ya tenés, y por eso es la unión y no lo de cada
     carta: una fila guardada se muestra siempre, aunque el catálogo haya dejado de creer
     que esa carta puede tenerla. Esconder algo que el usuario cargó sería peor que
     mostrar de más, y es el mismo criterio que `pointsToASlot`. */
  const vistas = new Map()
  for (const v of sueltas) vistas.set(v.id, v)
  for (const g of grupos) for (const v of g.variantes) if (!vistas.has(v.id)) vistas.set(v.id, v)

  return { ...e, lista: numbersOf(e), grupos, sueltas, variantes: [...vistas.values()] }
}

/* Las variantes que ESTA carta puede tener: lo que decide si se pregunta y qué se ofrece.
   Distinto de `exp.variantes`, que es todo lo declarado en la expansión y sirve para
   dibujar. Vacío quiere decir «esta carta no tiene variantes», y es el caso normal. */
export function variantsFor(exp, n) {
  if (!exp) return []
  if (!exp.grupos?.length) return exp.sueltas ?? exp.variantes ?? []
  const vistas = new Map()
  for (const g of exp.grupos) {
    if (!g.cartas.has(n)) continue
    for (const v of g.variantes) if (!vistas.has(v.id)) vistas.set(v.id, v)
  }
  /* Las sueltas, si las hay, valen para todas las cartas de la expansión. */
  for (const v of exp.sueltas ?? []) if (!vistas.has(v.id)) vistas.set(v.id, v)
  return [...vistas.values()]
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
     cualquier casillero del hueco y se baja a cero la variante. */
  return conBase ? [{ clave: base, variante: null }, ...deVariantes] : deVariantes
}

/* Lo que hay que DIBUJAR en una expansión: las variantes declaradas MÁS las que
 * aparezcan en tus datos sin estar declaradas.
 *
 * Es la red que deja corregir el catálogo sin que se pierda nada de vista. Las planillas
 * se leen de fotos y el vocabulario se va a seguir corrigiendo — ya pasó: «holo glitter»
 * en Personajes resultó ser «holográfica» y cambió de id. Sin esto, una fila guardada con
 * el id viejo dejaba de dibujarse: no estaba en la grilla, no la ofrecía el pie de
 * huérfanas — que a propósito NO las cuenta como huérfanas, ver `pointsToASlot`— y
 * seguía ocupando una fila en la base. Invisible, que es peor que borrada.
 *
 * El rótulo sale del propio id, en mayúscula. No es lindo, y es justamente la señal de
 * que a esa variante le falta su renglón en el catálogo. */
export function drawableVariants(catalogo, cantidades) {
  /* De más largo a más corto: así `ley-6-dor:824` se lee contra `ley-6` y no contra un
     hipotético `ley` que fuera prefijo suyo. */
  const porLargo = [...(catalogo ?? [])].sort((a, b) => b.id.length - a.id.length)
  const extra = new Map()
  for (const clave of Object.keys(cantidades ?? {})) {
    if (!((cantidades[clave] ?? 0) > 0)) continue
    const corte = clave.lastIndexOf(':')
    if (corte < 0) continue
    const parte = clave.slice(0, corte)
    const exp = porLargo.find((e) => parte.startsWith(e.id + '-'))
    if (!exp) continue
    const id = parte.slice(exp.id.length + 1)
    if (exp.variantes.some((v) => v.id === id)) continue
    if (!extra.has(exp.id)) extra.set(exp.id, new Map())
    extra.get(exp.id).set(id, { id, corto: id.toUpperCase(), nombre: id.toUpperCase() })
  }
  const salida = {}
  for (const exp of catalogo ?? []) {
    const suyas = extra.get(exp.id)
    salida[exp.id] = suyas ? [...exp.variantes, ...suyas.values()] : exp.variantes
  }
  return salida
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
          expansiones: raw.expansiones.map((e) => withVariants(e, raw)),
          /* Por omisión la colección usa la condición (buen estado / perfecta / para
             reemplazar). Leyenda dice `false` y ahí lo que se pregunta es la variante. */
          condicion: raw.condicion !== false,
          variantes: raw.variantes ?? [],
        }])
        .catch(() => [c.id, null])
    )
  ).then(Object.fromEntries)
}
