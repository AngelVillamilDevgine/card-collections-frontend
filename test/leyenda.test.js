// El catálogo de Leyenda: 1078 numeradas del 1 al 1078, Guerreros Legendarios 1 (1088 a 1223),
// 11 cartas F y 18 limitadas.
//
// Mismo motivo que `catalog.test.js`: este archivo se lee en caliente y se edita sin
// recompilar nada, así que no hay build que lo mire. Pero acá hay DOS cosas más que
// vigilar, y son las que sostienen todo el diseño de las variantes:
//
//   1. La clave de una carta es «expansión:número» y la columna es VARCHAR(40), con
//      `isValidCardKey` aceptando 34 caracteres antes de los dos puntos. Una variante es un
//      sufijo en el id de la expansión (`ley-5-e:551`), así que un id de expansión largo
//      más un id de variante largo pueden pasarse del ancho — y se descubriría el día que
//      alguien edita el JSON, sin deploy y sin nadie mirando.
//   2. Un id de expansión NO puede ser igual a «otro id + sufijo de variante», o dos
//      cartas distintas colapsarían en la misma clave.
//
// Las dos se prueban sobre TODAS las variantes declaradas, así que agregar una línea al
// JSON con un id demasiado largo pone esto en rojo antes de que llegue a producción.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
/* Las mismas funciones que la app, importadas y no copiadas: ver el comentario en
   collections.js. Este archivo TENÍA su propia copia de las dos de abajo, que es el
   agujero que ese comentario describe para `numbersOf` — y ya habían divergido: la copia
   dejaba que un grupo redefiniera el rótulo de una variante suelta y `withVariants` se
   queda con el de la suelta. Hoy no muerde porque ninguna expansión tiene las dos, pero
   el día que las tenga el test iba a estar probando otra cosa que la app. */
import { numbersOf, withVariants, variantsFor } from '../src/collections.js'

const rawCatalog = JSON.parse(
  fs.readFileSync(new URL('../public/data/leyenda.json', import.meta.url), 'utf8')
)
/* El catálogo tal como sale del archivo, para lo que se mira de la FORMA del dato (que
   `cartas` sea una lista sin repetidos, por ejemplo). */
const rawExpansions = rawCatalog.expansiones
/* Y el mismo pasado por la app, para lo que se mira del COMPORTAMIENTO. */
const appExpansions = rawCatalog.expansiones.map((e) => withVariants(e, rawCatalog))
const appExpansion = (id) => appExpansions.find((e) => e.id === id)

/* Todas las variantes declaradas en una expansión: las de sus grupos más las sueltas.
   Es lo que se dibuja. Lo que se OFRECE en una carta es `offeredVariantNames`, que es otra cosa. */
const declaredVariants = (exp) => appExpansion(exp.id).variantes

/* Las que puede tener ESA carta, que es lo único que decide qué ofrece el diálogo. */
const offeredVariantNames = (exp, n) => variantsFor(appExpansion(exp.id), n).map((v) => v.nombre)

const rawExpansion = (id) => rawExpansions.find((e) => e.id === id)
const allDeclaredVariants = rawExpansions.flatMap(declaredVariants)

// La misma que usa el backend. Duplicada porque son dos repos; si una cambia, la otra también.
const CARD_KEY_PATTERN = /^[a-z0-9-]{1,34}:\d{1,5}$/

const inRun = rawExpansions.filter((e) => !e.fuera)
const outOfRun = rawExpansions.filter((e) => e.fuera)

/* LA CORRIDA TIENE UN HUECO A PROPÓSITO: del 1079 al 1087. Es lo que queda de la «Expansión 7»
   del tracker (952 a 1087 en los cortes viejos), de la que sólo salieron hasta la 1078 en
   Personajes; ninguna fuente dice qué trae el resto. Si algún día se publica, se carga ahí. */
const GAP = { from: 1079, to: 1087 }

test('la corrida es exacta del 1 al 1078 y del 1088 al 1223, sin duplicados ni huecos', () => {
  const allNumbers = inRun.flatMap(numbersOf)
  assert.equal(allNumbers.length, 1078 + 136, `son ${allNumbers.length} y tienen que ser 1214`)
  const uniqueNumbers = new Set(allNumbers)
  assert.equal(uniqueNumbers.size, allNumbers.length, 'hay números repetidos entre expansiones')
  assert.equal(Math.min(...allNumbers), 1)
  assert.equal(Math.max(...allNumbers), 1223)
  for (let n = GAP.from; n <= GAP.to; n++) assert.ok(!uniqueNumbers.has(n), `la ${n} no está publicada`)
})

test('los rangos se tocan sin pisarse: cada uno arranca donde termina el anterior', () => {
  const sortedByStart = [...inRun].sort((a, b) => a.desde - b.desde)
  for (let i = 1; i < sortedByStart.length; i++) {
    /* El único salto permitido es el hueco documentado de arriba. */
    const expected = sortedByStart[i - 1].hasta === GAP.from - 1 ? GAP.to + 1 : sortedByStart[i - 1].hasta + 1
    assert.equal(
      sortedByStart[i].desde,
      expected,
      `${sortedByStart[i].id} arranca en ${sortedByStart[i].desde} y ${sortedByStart[i - 1].id} termina en ${sortedByStart[i - 1].hasta}`
    )
  }
})

test('las que están fuera de la corrida son las cartas F y las limitadas', () => {
  assert.equal(outOfRun.length, 3)
  const f = outOfRun.find((e) => e.id === 'ley-f')
  const fGl1 = outOfRun.find((e) => e.id === 'ley-gl1f')
  const u = outOfRun.find((e) => e.id === 'ley-unicas')
  assert.equal(numbersOf(f).length, 10, 'las cartas F son F504 a F513')
  assert.deepEqual(numbersOf(fGl1), [1222], 'y la F1222, de Guerreros Legendarios 1')
  assert.equal(numbersOf(u).length, 18, 'las cartas únicas son Leyenda 1 a 18')
  // Se dibujan y se exportan con prefijo, o «504» sería ambiguo contra la 504 de Expansión 4.
  assert.equal(f.prefijo, 'F')
  assert.equal(fGl1.prefijo, 'F', 'sin prefijo, la F1222 sería la 1222 de Guerreros Legendarios 1')
  assert.ok(u.prefijo)
})

test('los huecos del álbum son 1243', () => {
  const total = rawExpansions.flatMap(numbersOf).length
  assert.equal(total, 1243, 'son 1078 + 136 numeradas + 11 cartas F + 18 limitadas')
})

test('cada expansión tiene id, nombre, corto y un color de verdad', () => {
  for (const e of rawExpansions) {
    assert.match(e.id, /^[a-z0-9-]+$/, `id raro: ${e.id}`)
    assert.ok(e.nombre && e.corto, `${e.id} sin nombre o sin corto`)
    assert.match(e.color, /^#[0-9a-f]{6}$/i, `${e.id} con un color que no es #rrggbb`)
  }
  assert.equal(new Set(rawExpansions.map((e) => e.id)).size, rawExpansions.length, 'ids repetidos')
})

test('ningún id choca con los de Cromeros: las dos colecciones comparten la tabla', () => {
  const cromerosIds = JSON.parse(
    fs.readFileSync(new URL('../public/data/expansiones.json', import.meta.url), 'utf8')
  ).expansiones.map((e) => e.id)
  for (const e of rawExpansions) {
    assert.ok(!cromerosIds.includes(e.id), `${e.id} ya existe en Cromeros`)
  }
})

/* LOS DOS SEGUROS DEL DISEÑO DE VARIANTES. */

test('ninguna clave derivable se pasa del ancho que acepta el servidor', () => {
  for (const e of rawExpansions) {
    const suffixes = ['', ...declaredVariants(e).map((v) => `-${v.id}`)]
    for (const s of suffixes) {
      const cardKey = `${e.id}${s}:${Math.max(...numbersOf(e))}`
      assert.ok(
        CARD_KEY_PATTERN.test(cardKey),
        `«${cardKey}» (${cardKey.length} caracteres) no pasa isValidCardKey — el id de la expansión o el de la variante son demasiado largos`
      )
    }
  }
})

test('ningún id de expansión es igual a otro id más un sufijo de variante', () => {
  const ids = new Set(rawExpansions.map((e) => e.id))
  /* Se prueban TODAS las variantes contra TODAS las expansiones, no sólo las de cada una:
     el día que alguien le agregue a una expansión una variante que ya existía en otra, el
     choque tiene que aparecer acá y no en la base. */
  for (const e of rawExpansions) {
    for (const v of allDeclaredVariants) {
      const derivedId = `${e.id}-${v.id}`
      assert.ok(
        !ids.has(derivedId),
        `«${derivedId}» es a la vez una variante de ${e.id} y una expansión: dos cartas distintas caerían en la misma clave`
      )
    }
  }
})

test('los ids de variante son cortos, que es lo que los deja entrar en la clave', () => {
  for (const e of rawExpansions) {
    const ownVariants = declaredVariants(e)
    for (const v of ownVariants) {
      assert.match(v.id, /^[a-z0-9]{1,3}$/, `el id «${v.id}» de ${e.id} tiene que ser de 1 a 3 letras o números`)
      assert.ok(v.nombre, `la variante ${v.id} de ${e.id} no tiene nombre`)
      assert.ok(v.corto, `la variante ${v.id} de ${e.id} no tiene rótulo corto`)
    }
    assert.equal(new Set(ownVariants.map((v) => v.id)).size, ownVariants.length, `ids de variante repetidos en ${e.id}`)
  }
})

/* El mismo nombre con dos ids, o el mismo id con dos nombres, es lo que pasa si alguien
   carga «Oro» en una expansión y «Dorado» en otra — que es literalmente lo que hacen las
   planillas de las que salieron. Son la misma variante y tienen que llamarse igual. */
test('una variante se llama igual en todas las expansiones', () => {
  const nameById = {}
  const idByName = {}
  for (const e of rawExpansions) {
    for (const v of declaredVariants(e)) {
      if (nameById[v.id] && nameById[v.id] !== v.nombre)
        assert.fail(`el id «${v.id}» es «${nameById[v.id]}» en una expansión y «${v.nombre}» en ${e.id}`)
      if (idByName[v.nombre] && idByName[v.nombre] !== v.id)
        assert.fail(`«${v.nombre}» tiene dos ids: «${idByName[v.nombre]}» y «${v.id}» (${e.id})`)
      nameById[v.id] = v.nombre
      idByName[v.nombre] = v.id
    }
  }
})

/* LOS GRUPOS SON EL DATO, y estos tests son lo que impide que alguien los «simplifique»
   a una lista por expansión. Eso ya se hizo una vez y el bug llegó a producción: Angel lo
   vio en dos minutos — «en la 957 la app tiene muchas más variantes de las que
   corresponde». La 957 tiene seis, no doce. */

test('una carta que no está en ninguna planilla NO tiene variantes', () => {
  /* El caso que reporto Angel: «la 1069 no tiene variantes, yo no te pase nada, y vos
     estas suponiendo que tiene un monton». Es el caso NORMAL, no la excepcion. */
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-personajes'), 1069), [])
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-inicial'), 5), [])
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-6'), 857), [], 'la 857 la tiene Angel como comun')
})

test('cada carta ofrece lo que dice el dato, no el vocabulario del tramo entero', () => {
  /* La 957 es la que reporto Angel: «en la 957 la app tiene muchas mas variantes de las
     que corresponde». Son nueve con el APK 8.0 (siete antes), y no las trece que llego a ofrecer. */
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-personajes'), 957).sort(),
    ['Azul', 'Azul viento', 'Cyan', 'Dorado', 'Holográfica', 'Naranja', 'Plateado', 'Rosa', 'Tornasolado'])
  /* Y la 953, que es de la MISMA expansion, ofrece otras ocho. Ese es todo el punto. */
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-personajes'), 953).sort(),
    ['Azul', 'Dorado', 'Fucsia', 'Holográfica', 'Naranja', 'Plateado', 'Rojo', 'Verde'])
})

test('ningún grupo ofrece una sola respuesta posible', () => {
  /* La regla de la app es «se pregunta cuando hay mas de una respuesta posible». Un grupo
     de una sola variante abre un dialogo con una sola opcion, que es preguntar al pedo.
     Pasa sobre todo con «Comun»: el dato del tracker lista Normal como un acabado mas, y
     en Personajes hay 92 cartas cuyo unico acabado es ese — esas no tienen variantes y se
     marcan de un toque en el casillero base, que ES la comun. */
  for (const e of rawExpansions) {
    for (const g of e.grupos ?? []) {
      assert.ok(g.variantes.length > 1,
        `${e.id}: un grupo con una sola variante (${g.variantes.map((v) => v.nombre)}) abre un dialogo de una opcion`)
      assert.ok(!(g.variantes.length === 1 && g.variantes[0].id === 'com'),
        `${e.id}: un grupo que es solo «Comun» no es un grupo`)
    }
  }
})

test('«Holográfica» es UNA sola cosa: no volvieron hgl ni el Diamante de la 6ta', () => {
  /* Estuvieron separadas y se unificaron con el dato del tracker, que no tiene ninguna
     «holografica» suelta: tiene Holo Glitter, y usa la palabra para decir que la carta ES
     holografica. Si alguien las vuelve a partir, esto lo dice. */
  const ids = new Set(rawExpansions.flatMap((e) => declaredVariants(e).map((v) => v.id)))
  assert.ok(!ids.has('hgl'), 'hgl volvio: Holografica y Holo glitter son la misma')
  assert.ok(ids.has('hol'))
  assert.ok(!offeredVariantNames(rawExpansion('ley-6'), 824).includes('Diamantes'),
    'el «Diamante» de la Expansion 6 era Holografica')
  assert.ok(offeredVariantNames(rawExpansion('ley-6'), 824).includes('Holográfica'))
})

test('las cartas de un grupo caen dentro del rango de su expansion', () => {
  /* Un numero fuera del rango no dibuja nada y no ofrece nada: la variante queda
     inalcanzable y no hay forma de notarlo mirando la pantalla. */
  for (const e of rawExpansions) {
    for (const g of e.grupos ?? []) {
      for (const n of g.cartas ?? []) {
        assert.ok(
          numbersOf(e).includes(n),
          `${e.id}: la carta ${n} del grupo «${g.planilla}» no esta en ${e.desde}-${e.hasta}`
        )
      }
      assert.equal(new Set(g.cartas).size, g.cartas.length, `${e.id}: numeros repetidos en un grupo`)
      assert.ok(g.variantes?.length, `${e.id}: un grupo sin variantes no sirve para nada`)
    }
  }
})

/* LAS QUE ANGEL YA CARGO EN PRODUCCION, verificadas contra la base el 2026-09-26. Son la
   unica comprobacion independiente de que las listas se transcribieron bien: las diez
   variantes que el marco caen dentro de las listas, y las quince que dejo como comunes
   caen fuera. Si alguien edita el catalogo y saca una de estas, su carta desaparece de la
   grilla — la red de `drawableVariants` la salva, pero el diálogo deja de ofrecerla. */
test('las variantes que Angel ya cargo siguen estando ofrecidas', () => {
  const markedVariants = [
    ['ley-6', 824, 'Dorado'], ['ley-6', 858, 'Dorado'], ['ley-6', 882, 'Dorado'],
    ['ley-6', 892, 'Dorado'], ['ley-6', 827, 'Naranja'], ['ley-6', 850, 'Naranja'],
    ['ley-6', 821, 'Plateado'], ['ley-6', 845, 'Plateado'], ['ley-6', 851, 'Plateado'],
    ['ley-personajes', 957, 'Cyan'],
  ]
  for (const [id, n, variantName] of markedVariants) {
    assert.ok(
      offeredVariantNames(rawExpansion(id), n).includes(variantName),
      `${id}:${n} esta cargada en ${variantName} y el catalogo ya no la ofrece`
    )
  }
  const markedAsCommon = [
    ['ley-6', 857], ['ley-6', 859], ['ley-6', 861], ['ley-6', 863], ['ley-6', 871],
    ['ley-6', 873], ['ley-6', 877], ['ley-6', 878], ['ley-6', 886], ['ley-6', 897],
    ['ley-6', 899], ['ley-personajes', 939], ['ley-personajes', 964],
    ['ley-personajes', 1061], ['ley-personajes', 1069],
  ]
  for (const [id, n] of markedAsCommon) {
    assert.deepEqual(offeredVariantNames(rawExpansion(id), n), [], `${id}:${n} Angel la dejo comun y el catalogo le ofrece variantes`)
  }
})

/* CUANTAS CARTAS DE CADA TRAMO TIENEN VARIANTES. Salen del dato carta por carta que
   publica el tracker de Ismael (leido el 2026-09-26) y son el resumen de todo el archivo:
   si alguien lo regenera mal, o vuelve a aplicar el encabezado de una planilla a todas
   las cartas del tramo, estos seis numeros se mueven.

   EL MAZO INICIAL SON 48 Y NO 40, Y LA DIFERENCIA NO ES UN ERROR NUESTRO: EL TRACKER ESTA
   INCOMPLETO. El 2026-09-28 Angel miro sus propias cartas y paso las variantes de ocho que
   el tracker lista SIN NINGUNA (su campo de acabados viene vacio en las ocho): la 11, 12,
   14, 18, 20, 23, 25 y 27. Son cartas «de caja», y dos de los fondos que aparecen ahi
   -violeta y verde claro- son justamente de los que sus propias notas dicen que salen solo
   en el mazo de la caja y nunca en sobre.

   Es la regla que este proyecto ya tenia escrita y que conviene no olvidar: el tracker
   sirve para VERIFICAR lo nuestro, no es la verdad. Cuando Angel mira una carta que tiene
   en la mano, esa es la fuente. */
test('cuantas cartas tienen variantes en cada tramo', () => {
  const cardsWithVariants = (id) => (rawExpansion(id).grupos ?? []).reduce((a, g) => a + g.cartas.length, 0)
  assert.equal(cardsWithVariants('ley-inicial'), 71, '40 del tracker + las 8 que Angel corrigio + las 23 de Glitter que Angel sumo el 2026-11-09')
  assert.equal(cardsWithVariants('ley-2-3'), 52)
  assert.equal(cardsWithVariants('ley-4'), 74, '47 + las diez del APK 7.3 + las 17 de Glitter círculos que Angel sumó el 2026-11-09')
  assert.equal(cardsWithVariants('ley-5'), 44)
  assert.equal(cardsWithVariants('ley-6'), 44)
  assert.equal(cardsWithVariants('ley-personajes'), 44)
  /* De las 1078 numeradas, 329 (289 con el tracker + 40 que Angel sumó el 2026-11-09): lo normal sigue siendo que una carta NO tenga variantes. */
  const total = ['ley-inicial', 'ley-2-3', 'ley-4', 'ley-5', 'ley-6', 'ley-personajes']
    .reduce((a, id) => a + cardsWithVariants(id), 0)
  assert.equal(total, 329)
  assert.equal(cardsWithVariants('ley-f'), 10, 'las diez F, desde el APK 7.3')
  /* El APK 8.0 no sumó cartas con variantes a lo viejo: les sumó variantes a las que ya tenían. */
  assert.equal(cardsWithVariants('ley-gl1'), 43, 'de las 136, seis son sólo «de caja» y no tienen variantes')
  assert.equal(cardsWithVariants('ley-unicas'), 18)
})

/* LO QUE SUMÓ EL TRACKER EL 2026-10-05 (su APK 7.3, cuando el sitio quedó pausado), carta
   por carta: que el total cierre no dice qué ofrece cada una. */
test('lo que sumó el APK 7.3 del tracker, carta por carta', () => {
  const offeredIds = (expId, n) => variantsFor(appExpansion(expId), n).map((v) => v.id).sort()
  for (const n of [385, 386, 388, 394, 395, 397, 398, 399, 400, 401])
    assert.deepEqual(offeredIds('ley-4', n), ['com', 'gci', 'gli'], `${n}`)
  for (let n = 504; n <= 513; n++) assert.deepEqual(offeredIds('ley-f', n), ['com', 'gci', 'gli'], `F${n}`)
  /* La «hol» de 544–550 es del 7.8.6 (abajo); el resto es la foto del 7.3. */
  for (let n = 544; n <= 550; n++) assert.deepEqual(offeredIds('ley-4', n), ['azu', 'dor', 'gci', 'gli', 'hol', 'nar', 'pla'], `${n}`)
})

/* LO QUE SUMÓ EL APK 7.8.6 (2026-10-27), todo en Expansión 4 y calzando justo con los
   grupos que ya estaban: Dorado al grupo de 18 y a la 537, Holográfica al de 11 y al de
   544–550. Fuera de eso el 7.8.6 no trae nada nuevo para nosotros: lo demás que «cambió»
   son cosas que el tracker tiene de menos y acá se quedan (las ocho de Angel, la Azul de
   Personajes, las únicas en plata y dorado). */
test('lo que sumó el APK 7.8.6 del tracker, carta por carta', () => {
  const offeredIds = (expId, n) => variantsFor(appExpansion(expId), n).map((v) => v.id).sort()
  for (const n of [425, 427, 429, 437, 440, 441, 442, 486, 498, 500, 502, 504, 515, 529, 530, 531, 533, 536])
    assert.deepEqual(offeredIds('ley-4', n), ['dor', 'gci', 'gli', 'hol', 'nar', 'roj', 'ros'], `${n}`)
  for (const n of [418, 449, 452, 454, 460, 470, 471, 472, 484, 485, 505])
    assert.deepEqual(offeredIds('ley-4', n), ['azu', 'dor', 'gci', 'gli', 'hol', 'nar', 'pla'], `${n}`)
  assert.deepEqual(offeredIds('ley-4', 537), ['azu', 'com', 'dor', 'nar', 'pla'], '537')
})

/* LO QUE SUMÓ EL APK 8.0 (2026-11-06), carta por carta. SOLO SE AGREGÓ: lo que el 8.0 ya no
   lista se queda (ver el test de abajo). */
test('lo que sumó el APK 8.0 del tracker, carta por carta', () => {
  const offeredIds = (expId, n) => variantsFor(appExpansion(expId), n).map((v) => v.id)
  const has = (expId, n, ...ids) => {
    const got = offeredIds(expId, n)
    for (const id of ids) assert.ok(got.includes(id), `${expId}:${n} no ofrece ${id} (ofrece ${got})`)
  }
  /* Mazo inicial: Holo glitter y Tornasolado en 36 cartas. */
  for (const n of [22, 42, 45, 55, 56, 59, 63, 91, 93, 99, 130, 131, 132, 134, 135, 143, 154, 155,
    33, 36, 66, 78, 88, 102, 103, 119, 133, 136, 148, 149, 150, 152, 153, 160, 171, 175]) has('ley-inicial', n, 'hol', 'tor')
  /* Personajes: Rose y Tornasolado en 18, Azul y Rojo en 15, y Rojo solo en tres. */
  for (const n of [947, 957, 958, 975, 976, 977, 981, 993, 994, 1013, 1014, 1019, 1025, 1029, 1030, 1051, 1064, 1065])
    has('ley-personajes', n, 'ros', 'tor')
  for (const n of [953, 968, 969, 971, 972, 973, 978, 984, 986, 1006, 1008, 1012, 1016, 1021, 1037])
    has('ley-personajes', n, 'azu', 'roj')
  for (const n of [1053, 1055, 1056]) has('ley-personajes', n, 'roj')
  /* Las ocho especiales de caja: colores nuevos. */
  has('ley-inicial', 11, 'ver', 'pla', 'dor', 'ros', 'azu', 'tur', 'fuc', 'cel', 'vio', 'gri', 'cya')
})

test('Guerreros Legendarios 1: 136 cartas, 43 con variantes y las seis «de caja» sin ninguna', () => {
  const gl1 = appExpansion('ley-gl1')
  assert.equal(gl1.cardNumbers.length, 136)
  assert.equal(gl1.cardNumbers[0], 1088)
  assert.equal(gl1.cardNumbers.at(-1), 1223)
  for (const n of [1093, 1104, 1112, 1119, 1153, 1187])
    assert.deepEqual(variantsFor(gl1, n), [], `la ${n} es sólo de caja`)
  /* Los acabados que el tracker trae por primera vez, con su nombre. */
  const names = new Set(gl1.variantes.map((v) => v.nombre))
  for (const name of ['Rojo efecto', 'Rosa efecto', 'Matrix azul', 'Super gridito', 'Círculos dorados', 'PixelGlitter dorado', 'Diamantes', 'Azul hielo',
    'Fucsia efecto', 'Arcoiris', 'Tornasolado'])
    assert.ok(names.has(name), `falta ${name}`)
  /* La F1222 es otra carta que la 1222: no comparten casillero. */
  assert.equal(appExpansion('ley-gl1f').prefijo, 'F')
  assert.ok(variantsFor(appExpansion('ley-gl1f'), 1222).some((v) => v.nombre === 'Holo glitter dorado'))
})

/* LO QUE SUMÓ EL APK 8.1 (2026-11-07), todo en Guerreros Legendarios 1: Fucsia efecto (nuevo), Arcoiris y
   Tornasolado en las 44 holográficas, y «Psycho» renombrado a «Círculos dorados». Un acabado «Ocular» NO
   existe en el 8.0 ni en el 8.1: se buscó porque Angel lo mencionó, y no está. */
test('lo que sumó el APK 8.1 del tracker, en Guerreros Legendarios 1', () => {
  const gl1 = appExpansion('ley-gl1')
  const idsOf = (n) => variantsFor(gl1, n).map((v) => v.id)
  for (const n of [1088, 1090, 1091, 1092, 1094, 1098]) for (const id of ['fue', 'arc', 'tor'])
    assert.ok(idsOf(n).includes(id), `la ${n} no ofrece ${id}`)
  assert.equal(gl1.variantes.find((v) => v.id === 'psy').nombre, 'Círculos dorados', 'el 8.1 lo renombró; el id no cambia')
  assert.ok(!gl1.variantes.some((v) => v.nombre === 'Psycho'), 'no quedó ninguna con el nombre viejo')
  /* La 1184 pierde en el tracker el Holo glitter dorado a favor del PixelGlitter dorado; acá quedan los dos. */
  assert.ok(idsOf(1184).includes('hgd') && idsOf(1184).includes('pxd'))
  assert.ok(!rawExpansions.flatMap(declaredVariants).some((v) => /ocular/i.test(v.nombre)), 'ningún acabado Ocular')
})

/* LAS FOTOS DE LOS ACABADOS. El registro `fotos` liga un id de acabado con su ícono (112 px, del APK del
   tracker). Lo que se rompe en silencio: una ruta que no existe (la miniatura sale rota) o un id que ya
   nadie declara (una foto que no se ve en ningún lado). */
test('el registro de fotos apunta a archivos que existen y a acabados declarados', () => {
  const declared = new Set(rawExpansions.flatMap(declaredVariants).map((v) => v.id))
  assert.ok(Object.keys(rawCatalog.fotos).length >= 16)
  for (const [id, path] of Object.entries(rawCatalog.fotos)) {
    assert.ok(declared.has(id), `hay foto para ${id} y ninguna expansión declara ese acabado`)
    assert.match(path, /^acabados\/[a-z0-9]{1,3}\.webp$/, `ruta rara: ${path}`)
    assert.ok(fs.existsSync(new URL(`../public/${path}`, import.meta.url)), `falta el archivo ${path}`)
  }
})

test('withVariants le pega la foto a cada variante, sin pisar la que ya trae', () => {
  const gl1 = appExpansion('ley-gl1')
  assert.equal(gl1.variantes.find((v) => v.id === 'tor').foto, 'acabados/tor.webp')
  /* Un color liso no tiene foto, y la tiene de color. */
  const roj = gl1.variantes.find((v) => v.id === 'roj')
  assert.equal(roj.foto, undefined)
  assert.ok(roj.color)
  const fake = { id: 'x', grupos: [{ variantes: [{ id: 'tor', nombre: 'Tornasolado', foto: 'otra.webp' }], cartas: [1] }], desde: 1, hasta: 1 }
  assert.equal(withVariants(fake, rawCatalog).variantes[0].foto, 'otra.webp')
})

/* LO QUE EL 8.0 YA NO LISTA Y SE QUEDA: la Naranja de ocho cartas de Personajes y el Común de
   las especiales de caja. Mismo criterio que la Azul: lo que Angel marcó pesa más que el tracker. */
test('la Naranja de las ocho de Personajes y el Común de las especiales se quedan', () => {
  for (const n of [906, 916, 917, 928, 929, 930, 931, 944])
    assert.ok(variantsFor(appExpansion('ley-personajes'), n).some((v) => v.id === 'nar'), `la ${n} perdió la Naranja`)
  for (const n of [11, 12, 14, 20, 23])
    assert.ok(variantsFor(appExpansion('ley-inicial'), n).some((v) => v.id === 'com'), `la ${n} perdió el Común`)
})

/* LAS 40 QUE ANGEL SUMÓ MIRANDO SUS CARTAS (2026-11-09): el Glitter del Mazo inicial y el Glitter círculos de la
   Expansión 4, que el tracker no lista. Ninguna tenía variantes; salen como Común + el acabado. */
test('el Glitter y el Glitter círculos que Angel sumó con sus cartas', () => {
  const names = (id, n) => offeredVariantNames(rawExpansion(id), n).sort()
  for (const n of [57, 58, 62, 64, 68, 70, 72, 73, 75, 77, 112, 129, 137, 139, 141, 163, 164, 165, 166, 167, 168, 172, 176])
    assert.deepEqual(names('ley-inicial', n), ['Común', 'Glitter'], `la ${n}`)
  for (const n of [403, 405, 407, 417, 419, 422, 424, 434, 453, 467, 469, 475, 480, 483, 491, 494, 496])
    assert.deepEqual(names('ley-4', n), ['Común', 'Glitter círculos'], `la ${n}`)
  /* Y las vecinas que NO estaban en la lista siguen sin variantes. */
  assert.deepEqual(names('ley-inicial', 60), [])
  assert.deepEqual(names('ley-4', 404), [])
})

/* LO QUE EL TRACKER SACÓ Y ACÁ SE QUEDA. La 7.3 le sacó la Azul a 21 cartas de Personajes, y
   en producción hay una cuenta con Azul en 947, 975 y 981. Angel, 2026-10-05: «si alguien la
   marcó es porque existe». Sincronizar con el tracker sin mirar esto la borraría del diálogo. */
test('la Azul de Personajes se queda aunque el tracker la haya sacado', () => {
  for (const n of [947, 957, 958, 975, 976, 977, 981, 993, 994, 1013, 1014, 1019, 1025, 1029, 1030,
    1051, 1053, 1055, 1056, 1064, 1065])
    assert.ok(variantsFor(appExpansion('ley-personajes'), n).some((v) => v.id === 'azu'), `la ${n} perdió la Azul`)
})

/* LAS OCHO QUE ANGEL CORRIGIO, una por una. No alcanza con que el total cierre: lo que
   importa es QUE variantes ofrece cada una, que es lo que el tracker tenia mal. */
test('las ocho que Angel corrigio con sus propias cartas', () => {
  const expected = {
    /* El Rojo, en las ocho, lo sumó Angel el 2026-10-05: fotos con el número y un video que
       lo dice carta por carta (ver la nota del catálogo). */
    11: ['Común', 'Naranja', 'Rojo'],
    12: ['Común', 'Naranja', 'Violeta', 'Verde manzana', 'Rojo'],
    14: ['Común', 'Naranja', 'Violeta', 'Verde manzana', 'Rojo'],
    18: ['Naranja', 'Violeta', 'Verde manzana', 'Rojo'],
    20: ['Común', 'Violeta', 'Rojo'],
    23: ['Común', 'Naranja', 'Violeta', 'Rojo'],
    25: ['Naranja', 'Violeta', 'Rojo'],
    27: ['Dorado', 'Naranja', 'Violeta', 'Verde manzana', 'Rojo'],
  }
  /* Un PISO y no la lista entera: el APK 8.0 les sumó colores (verde, plata, dorado, rosa, azul,
     turquesa…), pero lo que Angel tiene en la mano no se puede perder. */
  for (const [n, wanted] of Object.entries(expected)) {
    const offered = offeredVariantNames(rawExpansion('ley-inicial'), Number(n))
    for (const name of wanted)
      assert.ok(offered.includes(name), `la ${n} dejó de ofrecer «${name}», que Angel tiene en la mano`)
  }
  /* La 22 NO se toca: Angel dijo que tiene variantes pero que solo tiene la comun, asi que
     no puede decir cuales son. Se queda con lo que traia el tracker. */
  assert.ok(offeredVariantNames(rawExpansion('ley-inicial'), 22).length > 1)
})

test('las Expansiones 2 y 3 tienen dos acabados y ninguna carta con version comun', () => {
  /* La guia del tracker: «Las cartas metalizadas NO poseen su variante comun». Es lo que
     confirma que el dialogo no lleve una fila «Comun» puesta de oficio. */
  assert.deepEqual(declaredVariants(rawExpansion('ley-2-3')).map((v) => v.nombre), ['Dorado', 'Plateado'])
  for (const id of ['ley-2-3', 'ley-5', 'ley-6']) {
    const hasCommon = declaredVariants(rawExpansion(id)).some((v) => v.id === 'com')
    assert.ok(!hasCommon, `${id} no deberia tener ninguna carta con version comun`)
  }
  /* Y el Mazo inicial si: sus 40 cartas con acabado existen tambien en comun y en glitter. */
  assert.ok(declaredVariants(rawExpansion('ley-inicial')).some((v) => v.id === 'com'))
  assert.ok(declaredVariants(rawExpansion('ley-inicial')).some((v) => v.id === 'gli'))
})

/* LAS NUEVE CARTAS ÚNICAS TIENEN NOMBRE Y TIRADA. Son el único lugar del álbum donde el
   número no alcanza: esas nueve no llevan número impreso —van con LOTE / EDICIÓN LIMITADA
   Nº / TOTAL, numeradas a mano— así que «Leyenda 3» es una etiqueta nuestra y lo que la
   identifica es el personaje. El dato salió del tracker de Ismael López, leído el
   2026-09-26. */
test('las dieciocho únicas tienen nombre, y la tirada donde se conoce', () => {
  const u = appExpansion('ley-unicas')
  assert.ok(u.detalle, 'sin esto la grilla vuelve a ser nueve cuadraditos con un número')
  assert.deepEqual(
    Object.keys(u.detalle).map(Number).sort((a, b) => a - b),
    u.cardNumbers,
    'una entrada por hueco: con una sola faltando, esa ficha queda muda al lado de ocho que hablan'
  )
  for (const n of u.cardNumbers) {
    const d = u.detalle[n]
    assert.ok(d.nombre && d.nombre.trim(), `Leyenda ${n}: sin nombre`)
    /* La tirada se conoce de las nueve primeras; de L10 a L18 el tracker no la trae y no se inventa. */
    if (n <= 9) assert.ok(Number.isInteger(d.copias) && d.copias > 0, `Leyenda ${n}: la tirada tiene que ser un entero`)
    else assert.equal(d.copias, undefined, `Leyenda ${n}: la tirada no se conoce`)
  }
  assert.equal(u.detalle[9].nombre, 'Shenron')
  assert.equal(u.detalle[9].copias, 500, 'Shenron es la única de 500; las otras ocho son de 1500')
  assert.equal(new Set(u.cardNumbers.map((n) => u.detalle[n].nombre)).size, 18, 'no hay dos con el mismo nombre')
  assert.equal(u.detalle[18].nombre, 'Porunga')
  /* Plata y dorado en las dieciocho, como las primeras. */
  assert.deepEqual(offeredVariantNames(rawExpansion('ley-unicas'), 12).sort(), ['Dorado', 'Plateado'])
})

test('si una expansión trae detalle, lo trae para TODAS sus cartas', () => {
  /* La grilla se ensancha para la expansión ENTERA, así que una carta sin detalle queda
     como una ficha grande con sólo un número adentro. Es la trampa de agregar el campo a
     medias. */
  for (const e of appExpansions) {
    if (!e.detalle) continue
    const detailNumbers = Object.keys(e.detalle).map(Number)
    for (const n of detailNumbers)
      assert.ok(e.cardNumbers.includes(n), `${e.id}: el detalle habla de la ${n}, que no existe en esa expansión`)
    assert.equal(detailNumbers.length, e.cardNumbers.length, `${e.id}: el detalle no cubre todas sus cartas`)
  }
})

test('esta colección no usa la condición: lo que se pregunta es la variante', () => {
  assert.equal(rawCatalog.condicion, false)
})
