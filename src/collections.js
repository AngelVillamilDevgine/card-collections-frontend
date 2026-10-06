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
  { id: 'cromeros', name: 'Cromeros', file: 'data/expansiones.json' },
  { id: 'leyenda', name: 'Leyenda', file: 'data/leyenda.json' },
]

export const DEFAULT_COLLECTION = 'cromeros'

/* Los álbumes, en prosa, para la bajada de la pantalla de entrada. Sale de la lista de
   arriba y no está escrito a mano porque ahí decía «Cartas Cromeros · 2007–2008» y quedó
   sin cambiar el día que entró Leyenda —que la hace Flash Gondor y es de 2025-2026—: o
   sea que lo primero que leía alguien que llegaba era el nombre de la mitad de la app. El
   encabezado de adentro no tiene el problema porque su subtítulo se fue y lo reemplazó el
   selector, que dice lo mismo y además sirve para algo. */
export function albumNames() {
  const names = COLLECTIONS.map((c) => c.name)
  if (names.length < 2) return names.join('')
  return names.slice(0, -1).join(', ') + ' y ' + names.at(-1)
}

/* Qué álbum estás mirando es una preferencia de ESTE aparato, igual que qué expansiones
   dejaste plegadas: la compu y el celular se acuerdan cada uno del suyo. Por eso va en
   `localStorage` y no en la cuenta.

   Y NO va en el hash. El hash es de `#panel`, y ahí el argumento es que Atrás tiene que
   cerrar lo que tapa la pantalla. Cambiar de álbum no tapa nada, y Atrás deshaciendo cada
   cambio dejaría una pila de entradas invisibles. */
const STORAGE_KEY = 'dbz-cromeros-coleccion'

export function readCollection() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (COLLECTIONS.some((c) => c.id === stored)) return stored
  } catch { /* modo privado */ }
  return DEFAULT_COLLECTION
}

export function rememberCollection(id) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* modo privado */ }
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
export function withVariants(e, raw) {
  const groups = (e.grupos ?? []).map((g) => ({
    variantes: g.variantes ?? [],
    cartas: new Set(g.cartas ?? []),
  }))
  const looseVariants = e.variantes ?? raw.variantes ?? []

  /* Todas las declaradas de la expansión, en orden y sin repetir. Es lo que se recorre
     para DIBUJAR los casilleros que ya tenés, y por eso es la unión y no lo de cada
     carta: una fila guardada se muestra siempre, aunque el catálogo haya dejado de creer
     que esa carta puede tenerla. Esconder algo que el usuario cargó sería peor que
     mostrar de más, y es el mismo criterio que `pointsToASlot`. */
  const byId = new Map()
  for (const v of looseVariants) byId.set(v.id, v)
  for (const g of groups) for (const v of g.variantes) if (!byId.has(v.id)) byId.set(v.id, v)

  return { ...e, cardNumbers: numbersOf(e), grupos: groups, looseVariants, variantes: [...byId.values()] }
}

/* Las variantes que ESTA carta puede tener: lo que decide si se pregunta y qué se ofrece.
   Distinto de `exp.variantes`, que es todo lo declarado en la expansión y sirve para
   dibujar. Vacío quiere decir «esta carta no tiene variantes», y es el caso normal. */
export function variantsFor(exp, n) {
  if (!exp) return []
  if (!exp.grupos?.length) return exp.looseVariants ?? exp.variantes ?? []
  const byId = new Map()
  for (const g of exp.grupos) {
    if (!g.cartas.has(n)) continue
    for (const v of g.variantes) if (!byId.has(v.id)) byId.set(v.id, v)
  }
  /* Las sueltas, si las hay, valen para todas las cartas de la expansión. */
  for (const v of exp.looseVariants ?? []) if (!byId.has(v.id)) byId.set(v.id, v)
  return [...byId.values()]
}

/* LA CLAVE DE UN CASILLERO, y acá está todo el diseño de las variantes.

   Una variante NO es una columna nueva ni un campo nuevo: es un SUFIJO en el id de la
   expansión. La 551 mate es `ley-5:551` y la 551 estrellada es `ley-5-e:551`. Son dos
   filas en la base, con la forma de clave que el servidor ya valida, así que no hay ni
   un ALTER, ni una migración, ni una sola fila que tocar.

   Y por eso el id de la variante va corto: entra en los 34 caracteres que `isValidCardKey`
   acepta antes de los dos puntos. Hay un test que lo obliga (`leyenda.test.js`). */
export const slotKey = (expId, n, variantId) => `${expId}${variantId ? `-${variantId}` : ''}:${n}`

/* CÓMO SE LLAMA UNA CARTA, y no es sólo su número.
 *
 * En Leyenda hay dos expansiones que repiten números de otra: `ley-f` va de 504 a 513 y
 * `ley-4` de 385 a 550, así que 504 existe dos veces; `ley-unicas` va de 1 a 9 y
 * `ley-inicial` de 1 a 176, otras nueve. Son 19 huecos con dos cartas distintas cada uno,
 * y lo que las separa es el prefijo impreso: `F504` contra `504`.
 *
 * Existía sólo en el texto que se comparte. En la grilla y en el diálogo el número salía
 * pelado, así que el lector de pantalla decía «Carta 504» dos veces y el diálogo se
 * titulaba «Carta 1» para la Leyenda 1 y para la 1 del mazo inicial. Mirando la pantalla
 * la banda de la expansión te lo dice; hablado y en el título del diálogo, no había nada. */
export const cardLabel = (exp, n) => `${exp?.prefijo ?? ''}${n}`

/* LO QUE SE SABE DE UNA CARTA EN PARTICULAR, cuando el catálogo lo sabe: `{ nombre,
 * copias }`. Hoy lo usan las nueve «Cartas únicas» de Leyenda y nada más.
 *
 * El número solo no alcanza ahí, y es el único lugar del álbum donde pasa: esas nueve no
 * llevan número impreso —van con LOTE / EDICIÓN LIMITADA Nº / TOTAL, numeradas a mano—,
 * así que «Leyenda 3» es una etiqueta nuestra y no algo que puedas leer en la carta. Lo
 * que la identifica es el personaje. Y la tirada es el dato que hace que no sean todas
 * iguales: ocho son de 1500 y Shenron de 500.
 *
 * Va en el catálogo y no en el código porque se lee en caliente: corregir un nombre es
 * editar un json. Es la misma razón por la que las variantes viven ahí.
 *
 * Que sea un campo del DATO y no un caso especial del código importa: el día que otra
 * expansión quiera nombres, se los pone en el json y aparecen. */
export const cardDetail = (exp, n) => exp?.detalle?.[n] ?? null

/* CUÁNTO LLEVÁS DE UN ÁLBUM, en porcentaje, y vale igual para los dos.
 *
 * `owned` y `total` son HUECOS en las dos colecciones: un hueco cuenta si alguno de sus
 * casilleros tiene algo, y cuenta UNA vez tengas la carta en un fondo o en cinco. Es la
 * regla que pidió Angel para Leyenda —«la carta cuenta si la tenés al menos una vez, y si
 * tenés varias variantes sólo contamos una»— y en Cromeros, donde cada hueco tiene un
 * casillero y nada más, da el número de siempre. Por eso no hay ninguna rama especial.
 *
 * NO ES `Math.round`, y ésa es la parte que importa: con 1096 de 1097 el redondeo dice
 * 100% y te deja mirando un álbum «completo» al que le falta una carta — que es el peor
 * error posible acá, porque es el que hace que dejes de buscarla. El 100 se reserva para
 * cuando de verdad están todas y lo demás va truncado, que es el lado que no miente. */
export const albumPercent = (owned, total) =>
  !total ? 0 : owned >= total ? 100 : Math.min(99, Math.floor((owned / total) * 100))


/* EL RÓTULO PARA UNA LISTA, donde hay que decir además DE DÓNDE es la carta.
 *
 * Con dos álbumes, «551» es ambiguo, así que a la que no es de la colección que estás
 * mirando se le antepone el `corto` de su expansión. Pero el `prefijo` hace exactamente el
 * mismo trabajo, y apilarlos daba **«F F504»** y **«CU Leyenda 3»** — el 2026-09-27, en el
 * pie de lo que no se pudo guardar y en el diálogo que BORRA. No se vio contra producción
 * porque hoy no hay ni una carta cargada de las dos expansiones con prefijo.
 *
 * La regla: si la expansión tiene `prefijo`, ése ya la identifica y alcanza; si no, va el
 * `corto`. Nunca los dos. */
export function listLabel(exp, n, isCurrentCollection) {
  const label = cardLabel(exp, n)
  if (isCurrentCollection || exp?.prefijo || !exp?.corto) return label
  return `${exp.corto} ${label}`
}

/* Los casilleros que hay que dibujar para un hueco del álbum: SIEMPRE el base, y cada
   variante de la que tengas al menos una.

   Que la variante sólo aparezca cuando la tenés es lo que deja la grilla igual que
   siempre mientras no uses ninguna: 1097 botones y punto. */
export function slotsOf(exp, n, variants, quantities) {
  const base = slotKey(exp.id, n)
  const hasBase = (quantities[base] ?? 0) > 0
  const variantSlots = []
  for (const v of variants) {
    const cardKey = slotKey(exp.id, n, v.id)
    if ((quantities[cardKey] ?? 0) > 0) variantSlots.push({ cardKey, variant: v })
  }

  /* Si no tenés ninguna, el hueco es UN casillero vacío: la carta que te falta. */
  if (!hasBase && !variantSlots.length) return [{ cardKey: base, variant: null }]

  /* Y SI TENÉS LA VARIANTE PERO NO LA BASE, el casillero base NO se dibuja. Se llega ahí
     bajando la base a cero después de clasificar, y sin esta línea quedaba una carta en
     blanco diciendo «me falta» justo al lado de la misma carta que sí tenés — y el
     filtro «Me faltan» la contaba.

     Acá decía que para «volver a tener una sin clasificar» se bajaba la variante a cero.
     Eso dejó de ser cierto y se corrigió el 2026-09-27: bajando la variante a cero el
     hueco vuelve a estar VACÍO, no con una carta sin clasificar. En una expansión con
     variantes ya no se puede tener una sin clasificar, porque todos los toques preguntan
     cuál es y el diálogo no ofrece ninguna fila «común» — Angel mandó sacarla. Las que
     hay en el casillero base son de antes de eso, o de cartas que no están en ninguna
     planilla, que son las que no preguntan nada. */
  return hasBase ? [{ cardKey: base, variant: null }, ...variantSlots] : variantSlots
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
export function drawableVariants(expansions, quantities) {
  /* De más largo a más corto: así `ley-6-dor:824` se lee contra `ley-6` y no contra un
     hipotético `ley` que fuera prefijo suyo. */
  const longestFirst = [...(expansions ?? [])].sort((a, b) => b.id.length - a.id.length)
  const extra = new Map()
  for (const cardKey of Object.keys(quantities ?? {})) {
    if (!((quantities[cardKey] ?? 0) > 0)) continue
    const colonIndex = cardKey.lastIndexOf(':')
    if (colonIndex < 0) continue
    const expPart = cardKey.slice(0, colonIndex)
    const exp = longestFirst.find((e) => expPart.startsWith(e.id + '-'))
    if (!exp) continue
    const id = expPart.slice(exp.id.length + 1)
    if (exp.variantes.some((v) => v.id === id)) continue
    if (!extra.has(exp.id)) extra.set(exp.id, new Map())
    extra.get(exp.id).set(id, { id, corto: id.toUpperCase(), nombre: id.toUpperCase() })
  }
  const result = {}
  for (const exp of expansions ?? []) {
    const undeclared = extra.get(exp.id)
    result[exp.id] = undeclared ? [...exp.variantes, ...undeclared.values()] : exp.variantes
  }
  return result
}

/* ¿ESTE TOQUE COMPLETÓ ALGO? Lo pidió Angel: «cuando completo una colección, que salten
   fuegos artificiales o algo».

   Se pregunta SÓLO por el toque que acaba de pasar, comparando el antes y el después: así
   no festeja al cargar la página, ni al volver a la pestaña, ni al restaurar una copia —
   nada de eso es un logro de ese momento—. Y un toque que suma una repetida, o una
   variante de un hueco que ya tenías, no completa nada: ese hueco ya contaba.

   «Tener» un hueco es lo mismo que cuenta la banda de la expansión: alguno de sus
   casilleros con algo, incluidas las variantes que el catálogo no declara
   (`drawableVariants`). Si fuera otra cuenta, el festejo podría saltar con la banda en
   «135 de 136».

   Devuelve null, o la expansión que se completó y si con ella se completó el álbum. */
export function completionBy(cardKey, before, after, album) {
  const expansions = album?.expansiones ?? []
  const slot = slotOf(cardKey, { album })
  if (!slot) return null
  const owns = (exp, n, quantities, drawable) =>
    slotsOf(exp, n, drawable[exp.id], quantities).some((s) => (quantities[s.cardKey] ?? 0) > 0)
  if (owns(slot.exp, slot.n, before, drawableVariants(expansions, before))) return null
  const drawableAfter = drawableVariants(expansions, after)
  const isComplete = (exp) => exp.cardNumbers.every((n) => owns(exp, n, after, drawableAfter))
  if (!isComplete(slot.exp)) return null
  return { expansion: slot.exp, album: expansions.every(isComplete) }
}

/* ¿Esta clave apunta a un hueco que existe? Se usa para las huérfanas, y la respuesta
   tiene que ser SÍ también cuando el sufijo de variante no está declarado.

   Si no, sacar una línea de `"variantes"` convertiría esas cartas en huérfanas y el pie
   ofrecería borrarlas — cuando en realidad siguen apuntando a un hueco que existe y lo
   único que pasó es que el catálogo dejó de saber cómo se llama ese fondo. Editar un
   JSON no puede ofrecer borrar cartas de verdad. */
export function pointsToASlot(cardKey, catalogs) {
  return !!slotOf(cardKey, catalogs)
}

/* A QUÉ HUECO APUNTA UNA CLAVE, mirando TODAS las colecciones: `{ exp, n, variantId }`, o
   `null` si no apunta a ninguno.

   Mirar todas y no sólo la que estás viendo importa para lo que no se pudo guardar: si
   tocaste una de Leyenda y te cambiaste a Cromeros, el pie tiene que poder nombrarla.

   Y la parte de la expansión **no se puede partir por guion**: los ids llevan guiones
   (`ley-2-3`) y el sufijo de variante también es un guion. Se busca contra el catálogo, que
   es quien sabe, y de más largo a más corto para que gane el id más específico. */
function parseSlotKey(cardKey, catalogs) {
  if (typeof cardKey !== 'string') return null
  const colonIndex = cardKey.lastIndexOf(':')
  if (colonIndex < 0 || colonIndex === cardKey.length - 1) return null
  const expPart = cardKey.slice(0, colonIndex)
  const n = Number(cardKey.slice(colonIndex + 1))
  if (!Number.isFinite(n)) return null

  const allExpansions = []
  for (const col of Object.values(catalogs ?? {})) for (const exp of col?.expansiones ?? []) allExpansions.push(exp)
  allExpansions.sort((a, b) => b.id.length - a.id.length)

  for (const exp of allExpansions) {
    const isBase = expPart === exp.id
    if (!(isBase || expPart.startsWith(exp.id + '-'))) continue
    return { exp, n, variantId: isBase ? null : expPart.slice(exp.id.length + 1) }
  }
  return { exp: null, n, variantId: null }
}

export function slotOf(cardKey, catalogs) {
  const parts = parseSlotKey(cardKey, catalogs)
  if (!parts?.exp || !parts.exp.cardNumbers.includes(parts.n)) return null
  return parts
}

/* Cómo se le dice a un casillero a una persona: el rótulo de la carta y, si es de una
   variante, cómo se llama esa variante.

   Existe porque el pie imprimía **la clave interna**: `ley-6-dor:824` se partía por los dos
   puntos, `ley-6-dor` no figuraba en la tabla de rótulos —ahí sólo están los ids de
   expansión— y salía tal cual. «No se pudo guardar ley-6-dor 824» no le dice nada a nadie.
   Un sufijo que el catálogo no declara sale en mayúscula, igual que en `drawableVariants`. */
export function slotName(cardKey, catalogs, isCurrentCollection = true) {
  const slot = slotOf(cardKey, catalogs)
  if (!slot) return null
  const label = listLabel(slot.exp, slot.n, isCurrentCollection)
  if (!slot.variantId) return label
  const v = slot.exp.variantes.find((x) => x.id === slot.variantId)
  /* El nombre ENTERO y no el `corto`, y es el mismo criterio que el prefijo: esto se usa
     en una frase —«Son la 824 Dorado»— y ahí hay lugar. El `corto` es para la esquina de
     la carta, donde entran dos letras y la banda de arriba da el contexto; suelto en un
     cartel, «824 DO» no le dice nada a nadie. Medido contra las trece variantes que hay
     cargadas en producción: DO, PL, NA, HO y CY. */
  return `${label} ${v?.nombre ?? v?.corto ?? slot.variantId.toUpperCase()}`
}

/* Cómo nombrar una clave HUÉRFANA, que por definición no apunta a ningún hueco.
   Su expansión puede existir igual —es el caso típico: un `"hasta"` mal tipeado deja
   `exp-1:9999`— así que se la busca por prefijo y se usa su rótulo corto. Sólo si ni la
   expansión existe se cae a la clave cruda, que ahí sí es lo único que hay para decir.
   Importa porque este es el diálogo que BORRA: la lista es con lo que se decide. */
export function orphanName(cardKey, catalogs) {
  const parts = parseSlotKey(cardKey, catalogs)
  if (!parts?.exp) return cardKey
  /* Acá SIEMPRE se dice de dónde es —el diálogo mezcla las dos colecciones— así que va por
     `listLabel` con `isCurrentCollection` en falso. Es lo que evita el «F F99999». */
  return listLabel(parts.exp, parts.n, false)
}

/* Los números de una expansión: un rango, o una lista de números sueltos.
 *
 * LA LISTA HACE FALTA AUNQUE HOY NINGUNA EXPANSIÓN LA USE, y la razón es un agujero que
 * estuvo abierto: los dos archivos de test traían su propia copia de esta función y ESÍA
 * copia sí leía `numeros`, mientras que la app sólo leía `desde`/`hasta`. O sea que un
 * catálogo con un set de números sueltos —que es exactamente la forma que pide, por
 * ejemplo, meter las 13 cartas que repiten número— **pasaba los tests en verde y la app
 * no dibujaba ninguna de esas cartas**. Y peor: las filas que ya estuvieran guardadas con
 * esas claves dejaban de apuntar a un hueco, así que el pie las anunciaba como huérfanas
 * y ofrecía borrarlas. Editar el catálogo es el flujo que este proyecto llama normal.
 *
 * Hoy los tests importan ESTA función, así que no se pueden volver a separar. */
export function numbersOf(exp) {
  if (Array.isArray(exp.numeros)) return exp.numeros
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
      fetch(new URL(c.file, document.baseURI), { signal })
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
