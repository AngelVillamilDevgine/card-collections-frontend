// `collections.js` es el corazón del modelo de variantes y no tenía un solo test.
//
// Los otros dos archivos prueban los CATÁLOGOS, que se leen en caliente. Esto prueba el
// CÓDIGO que los interpreta, y son preguntas distintas: un catálogo perfecto con este
// módulo roto ofrece variantes que no corresponden, esconde casilleros que el usuario
// cargó, o —la peor— le dice al pie que borre cartas que apuntan a un hueco que existe.
//
// Cada test de acá está por un camino que si se rompe NO se ve compilando ni mirando la
// pantalla con los datos de hoy: hace falta tener la fila guardada, o un id con la forma
// justa, para que aparezca.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  COLLECTIONS, DEFAULT_COLLECTION, readCollection, albumNames, cardLabel, cardDetail, listLabel, albumPercent,
  withVariants, variantsFor, slotKey, slotsOf, drawableVariants, pointsToASlot, numbersOf,
  slotOf, slotName, orphanName,
} from '../src/collections.js'

/* Una expansión como sale de un json, para no depender de los catálogos de verdad: lo que
   se prueba acá es el código, y tiene que seguir andando el día que los datos cambien. */
const GOLD = { id: 'dor', nombre: 'Dorado', corto: 'Dor' }
const SILVER = { id: 'pla', nombre: 'Plateado', corto: 'Pla' }
const GLITTER = { id: 'gli', nombre: 'Glitter', corto: 'Gli' }

const makeExpansion = (e, raw = {}) => withVariants(e, raw)

// ---------------------------------------------------------------- numbersOf

test('numbersOf: la lista suelta gana sobre el rango, que es para lo que existe', () => {
  /* Un set de números que no son una corrida —las 13 cartas que repiten número, por
     ejemplo— sólo se puede escribir así. Si esto se rompe, esas cartas no se dibujan. */
  assert.deepEqual(numbersOf({ numeros: [103, 109, 124], desde: 1, hasta: 900 }), [103, 109, 124])
  assert.deepEqual(numbersOf({ desde: 5, hasta: 8 }), [5, 6, 7, 8], 'el rango incluye las dos puntas')
  assert.deepEqual(numbersOf({ numeros: [] }), [], 'una lista vacía es vacía, no el rango')
})

// ---------------------------------------------------------------- withVariants

test('withVariants: `cartas` pasa a Set, que es lo que `variantsFor` necesita', () => {
  /* El test de Leyenda tenía su propia copia justamente porque no podía llamar a
     `variantsFor` con listas. Si esto se rompe, `g.cartas.has` revienta. */
  const e = makeExpansion({ id: 'x', desde: 1, hasta: 3, grupos: [{ cartas: [2], variantes: [GOLD] }] })
  assert.ok(e.grupos[0].cartas instanceof Set)
  assert.ok(e.grupos[0].cartas.has(2))
})

test('withVariants: `variantes` queda siendo la UNIÓN, que es lo que se dibuja', () => {
  const e = makeExpansion({
    id: 'x', desde: 1, hasta: 40,
    grupos: [{ cartas: [1], variantes: [GOLD] }, { cartas: [2], variantes: [SILVER, GOLD] }],
  })
  assert.deepEqual(e.variantes.map((v) => v.id), ['dor', 'pla'], 'sin repetir y en orden de aparición')
  /* Y sigue siendo distinta de lo que ofrece cada carta: eso es el bug que Angel vio en
     la 957 y en la 1069. */
  assert.deepEqual(variantsFor(e, 1).map((v) => v.id), ['dor'])
  assert.deepEqual(variantsFor(e, 3).map((v) => v.id), [], 'una carta sin grupo no ofrece nada')
})

test('withVariants: una suelta de la expansión no la puede redefinir un grupo', () => {
  /* La copia que tenía el test de Leyenda hacía lo contrario: el grupo pisaba el rótulo
     de la suelta. Nadie lo iba a notar hasta que una expansión tuviera las dos cosas. */
  const otherGold = { id: 'dor', nombre: 'Dorado de la caja', corto: 'Caja' }
  const e = makeExpansion({
    id: 'x', desde: 1, hasta: 9, variantes: [GOLD],
    grupos: [{ cartas: [1], variantes: [otherGold] }],
  })
  assert.equal(e.variantes.find((v) => v.id === 'dor').nombre, 'Dorado')
})

test('withVariants: sin grupos ni sueltas hereda las de la colección, y si no, ninguna', () => {
  const inherited = makeExpansion({ id: 'x', desde: 1, hasta: 9 }, { variantes: [GLITTER] })
  assert.deepEqual(inherited.variantes.map((v) => v.id), ['gli'])
  /* Y todo Cromeros cae acá: ninguna variante en ningún lado. */
  const bare = makeExpansion({ id: 'exp-1', desde: 1, hasta: 129 })
  assert.deepEqual(bare.variantes, [])
  assert.deepEqual(variantsFor(bare, 5), [], 'y entonces el toque no pregunta nada')
})

test('withVariants: `cardNumbers` sale de numbersOf, no de desde/hasta a mano', () => {
  assert.deepEqual(makeExpansion({ id: 'x', numeros: [7, 9] }).cardNumbers, [7, 9])
  assert.deepEqual(makeExpansion({ id: 'x', desde: 2, hasta: 4 }).cardNumbers, [2, 3, 4])
})

// ---------------------------------------------------------------- variantsFor

test('variantsFor: una carta en dos grupos ofrece la unión de los dos', () => {
  /* En la 4ta los colores y el glitter son dos planillas distintas, y hay cartas en las
     dos. Ofrecer sólo las del primer grupo que la contenga sería perder la otra mitad. */
  const e = makeExpansion({
    id: 'x', desde: 1, hasta: 9,
    grupos: [{ cartas: [1, 2], variantes: [GOLD, SILVER] }, { cartas: [2], variantes: [GLITTER] }],
  })
  assert.deepEqual(variantsFor(e, 2).map((v) => v.id), ['dor', 'pla', 'gli'])
  assert.deepEqual(variantsFor(e, 1).map((v) => v.id), ['dor', 'pla'])
})

test('variantsFor: las sueltas valen para TODAS las cartas, también las que están en un grupo', () => {
  const e = makeExpansion({
    id: 'x', desde: 1, hasta: 9, variantes: [GLITTER],
    grupos: [{ cartas: [1], variantes: [GOLD] }],
  })
  assert.deepEqual(variantsFor(e, 1).map((v) => v.id), ['dor', 'gli'])
  assert.deepEqual(variantsFor(e, 8).map((v) => v.id), ['gli'])
})

test('variantsFor: sin expansión no revienta, devuelve nada', () => {
  /* Se la llama mientras un catálogo todavía no cargó. */
  assert.deepEqual(variantsFor(null, 1), [])
  assert.deepEqual(variantsFor(undefined, 1), [])
})

// ---------------------------------------------------------------- slotKey / slotsOf

test('slotKey: la variante es un SUFIJO en el id de la expansión y nada más', () => {
  assert.equal(slotKey('ley-5', 551), 'ley-5:551')
  assert.equal(slotKey('ley-5', 551, 'e'), 'ley-5-e:551')
  assert.equal(slotKey('ley-5', 551, null), 'ley-5:551', 'sin variante no se agrega el guion')
  assert.equal(slotKey('ley-5', 551, ''), 'ley-5:551')
})

test('slotsOf: un hueco sin nada es UN casillero vacío, la carta que te falta', () => {
  const e = makeExpansion({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [GOLD] }] })
  assert.deepEqual(slotsOf(e, 1, variantsFor(e, 1), {}), [{ cardKey: 'x:1', variant: null }])
  /* Una cantidad en cero es lo mismo que no tenerla: no dibuja casillero de variante. */
  assert.deepEqual(slotsOf(e, 1, variantsFor(e, 1), { 'x-dor:1': 0 }), [{ cardKey: 'x:1', variant: null }])
})

test('slotsOf: SI TENÉS LA VARIANTE Y NO LA BASE, el casillero base no se dibuja', () => {
  /* Sin esta regla quedaba una carta en blanco diciendo «me falta» justo al lado de la
     misma carta que sí tenés, y el filtro «Me faltan» la contaba. */
  const e = makeExpansion({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [GOLD, SILVER] }] })
  const vs = variantsFor(e, 1)
  assert.deepEqual(slotsOf(e, 1, vs, { 'x-dor:1': 1 }), [{ cardKey: 'x-dor:1', variant: GOLD }])
  /* Con la base sí, y la base va primera. */
  assert.deepEqual(
    slotsOf(e, 1, vs, { 'x:1': 1, 'x-pla:1': 3 }),
    [{ cardKey: 'x:1', variant: null }, { cardKey: 'x-pla:1', variant: SILVER }]
  )
})

// ---------------------------------------------------------------- drawableVariants

test('drawableVariants: un sufijo que el catálogo NO declara se dibuja igual', () => {
  /* Es la red que deja corregir el catálogo. Sin esto, una fila guardada con el id viejo
     se volvía invisible: no estaba en la grilla, el pie no la ofrecía como huérfana —a
     propósito— y seguía ocupando una fila. Invisible es peor que borrada. */
  const expansions = [makeExpansion({ id: 'ley-6', desde: 727, hasta: 902, grupos: [{ cartas: [824], variantes: [GOLD] }] })]
  const drawable = drawableVariants(expansions, { 'ley-6-hgl:824': 1 })
  assert.deepEqual(drawable['ley-6'].map((v) => v.id), ['dor', 'hgl'])
  assert.equal(drawable['ley-6'][1].nombre, 'HGL', 'el rótulo sale del id en mayúscula: la señal de que le falta el renglón')
})

test('drawableVariants: lo declarado no se duplica ni se pierde el orden', () => {
  const expansions = [makeExpansion({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [GOLD, SILVER] }] })]
  const drawable = drawableVariants(expansions, { 'x-dor:1': 2, 'x-pla:1': 1 })
  assert.deepEqual(drawable['x'].map((v) => v.id), ['dor', 'pla'])
})

test('drawableVariants: una cantidad en cero no inventa una variante', () => {
  /* Una fila en cero es una carta que NO tenés: no puede agregar un casillero. */
  const expansions = [makeExpansion({ id: 'x', desde: 1, hasta: 9 })]
  assert.deepEqual(drawableVariants(expansions, { 'x-zzz:1': 0 })['x'], [])
})

test('drawableVariants: la clave base nunca se lee como una variante', () => {
  /* `ley-2-3:200` es la carta 200 de «Expansiones 2 y 3», no la variante «3» de un
     `ley-2`. Se lee contra el id más largo primero justamente por esto. */
  const expansions = [makeExpansion({ id: 'ley-2-3', desde: 177, hasta: 384 }), makeExpansion({ id: 'ley-4', desde: 385, hasta: 550 })]
  const drawable = drawableVariants(expansions, { 'ley-2-3:200': 1, 'ley-4:400': 1 })
  assert.deepEqual(drawable['ley-2-3'], [])
  assert.deepEqual(drawable['ley-4'], [])
})

test('drawableVariants: con un id que es prefijo de otro, gana el más largo', () => {
  /* Es para lo que existe el `sort` por largo, y sin él la variante se le colgaba a la
     expansión equivocada: `ley-6-dor:824` leído contra un `ley` da la variante «6-dor»
     de `ley`, que ni existe. Hoy ningún par de ids es así, y esto es lo que hace que
     agregar uno no rompa nada en silencio. */
  const expansions = [
    makeExpansion({ id: 'ley', desde: 1, hasta: 1078 }),
    makeExpansion({ id: 'ley-6', desde: 727, hasta: 902 }),
  ]
  const drawable = drawableVariants(expansions, { 'ley-6-dor:824': 1 })
  assert.deepEqual(drawable['ley-6'].map((v) => v.id), ['dor'])
  assert.deepEqual(drawable['ley'], [], 'y no se le cuelga a `ley` una variante «6-dor»')
})

test('drawableVariants: una clave de otra colección no se mete en ésta', () => {
  const expansions = [makeExpansion({ id: 'ley-5', desde: 551, hasta: 726 })]
  const drawable = drawableVariants(expansions, { 'exp-1:5': 1, 'sin-dos-puntos': 1 })
  assert.deepEqual(drawable['ley-5'], [])
})

test('drawableVariants: sin catálogo y sin cantidades no revienta', () => {
  assert.deepEqual(drawableVariants(null, null), {})
  assert.deepEqual(drawableVariants(undefined, undefined), {})
})

// ---------------------------------------------------------------- pointsToASlot

const CATALOGS = {
  cromeros: { expansiones: [makeExpansion({ id: 'exp-1', corto: 'E1', desde: 1, hasta: 129 })] },
  leyenda: {
    expansiones: [makeExpansion({
      id: 'ley-6', corto: 'E6', desde: 727, hasta: 902,
      grupos: [{ cartas: [824], variantes: [GOLD] }],
    })],
  },
}

test('pointsToASlot: la base y la variante declarada apuntan a un hueco', () => {
  assert.equal(pointsToASlot('exp-1:1', CATALOGS), true)
  assert.equal(pointsToASlot('ley-6:824', CATALOGS), true)
  assert.equal(pointsToASlot('ley-6-dor:824', CATALOGS), true)
})

test('pointsToASlot: UN SUFIJO DESCONOCIDO TAMBIÉN, y esto es lo que evita un borrado', () => {
  /* Si sacás una línea de `"variantes"`, esas filas siguen apuntando a un hueco que
     existe. Editar un json no puede ofrecer borrar cartas de verdad. */
  assert.equal(pointsToASlot('ley-6-hgl:824', CATALOGS), true)
  assert.equal(pointsToASlot('ley-6-lo-que-sea:902', CATALOGS), true)
})

test('pointsToASlot: un número fuera de la corrida NO apunta a nada', () => {
  /* Éste es el caso que el pie tiene que ofrecer sacar: un `"hasta"` mal tipeado. */
  assert.equal(pointsToASlot('exp-1:200', CATALOGS), false)
  assert.equal(pointsToASlot('ley-6:1', CATALOGS), false)
  assert.equal(pointsToASlot('ley-6-dor:1', CATALOGS), false)
})

test('pointsToASlot: una expansión que no existe, y una clave sin forma de clave', () => {
  assert.equal(pointsToASlot('exp-99:1', CATALOGS), false)
  assert.equal(pointsToASlot('exp-1', CATALOGS), false, 'sin los dos puntos')
  assert.equal(pointsToASlot('exp-1:', CATALOGS), false, 'sin número')
  assert.equal(pointsToASlot('exp-1:hola', CATALOGS), false)
})

test('pointsToASlot: una colección que NO cargó no hace que todo sea huérfano', () => {
  /* `loadCatalogs` devuelve `null` para la que falló. Si esto reventara o dijera `false`
     de todo, el pie ofrecería borrar la colección entera por un archivo que no llegó. */
  const withOneFailed = { cromeros: CATALOGS.cromeros, leyenda: null }
  assert.equal(pointsToASlot('exp-1:1', withOneFailed), true)
  assert.equal(pointsToASlot('ley-6:824', withOneFailed), false)
  assert.equal(pointsToASlot('exp-1:1', null), false)
})

// ---------------------------------------------------------------- cardDetail

test('cardDetail: devuelve lo que el catálogo sabe de esa carta, o nada', () => {
  const e = makeExpansion({
    id: 'ley-unicas', corto: 'CU', desde: 1, hasta: 9, prefijo: 'Leyenda ',
    detalle: { 1: { nombre: 'Goku (Báculo)', copias: 1500 }, 9: { nombre: 'Shenron', copias: 500 } },
  })
  assert.deepEqual(cardDetail(e, 1), { nombre: 'Goku (Báculo)', copias: 1500 })
  assert.equal(cardDetail(e, 9).copias, 500, 'Shenron es la única de 500')
  assert.equal(cardDetail(e, 5), null, 'sin entrada, nada')
  /* Las claves del json son cadenas y el número viene como número: el acceso las iguala,
     y si eso dejara de ser cierto la grilla se dibujaría vacía sin que nada avise. */
  assert.equal(cardDetail(e, Number('1')).nombre, 'Goku (Báculo)')
})

test('cardDetail: una expansión sin detalle no revienta, que son todas menos una', () => {
  assert.equal(cardDetail(makeExpansion({ id: 'exp-1', desde: 1, hasta: 129 }), 5), null)
  assert.equal(cardDetail(null, 5), null)
  assert.equal(cardDetail(undefined, 5), null)
})

test('cardDetail: la MISMA referencia en cada llamada, que es lo que deja vivo el memo', () => {
  /* `Card` va con React.memo y el CLAUDE.md dice que las props tienen que ser estables.
     `cardDetail` devuelve el objeto del catálogo tal cual — si armara uno nuevo, las 1936
     cartas se volverían a renderizar en cada toque. */
  const e = makeExpansion({ id: 'x', desde: 1, hasta: 2, detalle: { 1: { nombre: 'Uno', copias: 10 } } })
  assert.ok(cardDetail(e, 1) === cardDetail(e, 1))
})

// ---------------------------------------------------------------- albumPercent

test('albumPercent: el 100 se reserva para cuando de verdad están todas', () => {
  /* Con `Math.round`, 1096 de 1097 da 100% y te deja mirando un álbum «completo» al que
     le falta una carta — el peor error posible acá, porque es el que hace que dejes de
     buscarla. Es el mismo criterio que el resto del proyecto: el modo de falla no puede
     ser la respuesta más tranquilizadora. */
  assert.equal(albumPercent(1097, 1097), 100)
  assert.equal(albumPercent(1096, 1097), 99, 'le falta una: NO puede decir 100')
  assert.equal(albumPercent(1935, 1936), 99)
  assert.equal(albumPercent(1936, 1936), 100)
})

test('albumPercent: trunca, no redondea', () => {
  assert.equal(albumPercent(1, 1936), 0, 'una de 1936 es 0%, no 1%')
  assert.equal(albumPercent(549, 1097), 50)
  assert.equal(albumPercent(548, 1097), 49, 'el redondeo diría 50')
})

test('albumPercent: sin álbum y sin cartas no revienta ni dibuja NaN', () => {
  assert.equal(albumPercent(0, 0), 0)
  assert.equal(albumPercent(0, 1097), 0)
  assert.equal(albumPercent(5, 0), 0, 'sin denominador no hay porcentaje')
  /* Y si alguna vez el numerador se pasara —que es el bug que tenía el panel— se recorta
     en vez de dibujar 176%. */
  assert.equal(albumPercent(2000, 1097), 100)
})

// ---------------------------------------------------------------- slotOf / slotName

test('slotOf: dice de qué hueco es una clave, mirando TODAS las colecciones', () => {
  /* Mirar todas y no sólo la que estás viendo importa para el pie: si tocaste una de
     Leyenda y te cambiaste a Cromeros, tiene que poder nombrarla. */
  assert.deepEqual(
    { id: slotOf('exp-1:1', CATALOGS).exp.id, n: slotOf('exp-1:1', CATALOGS).n, v: slotOf('exp-1:1', CATALOGS).variantId },
    { id: 'exp-1', n: 1, v: null }
  )
  const withVariant = slotOf('ley-6-dor:824', CATALOGS)
  assert.equal(withVariant.exp.id, 'ley-6')
  assert.equal(withVariant.variantId, 'dor', 'la parte de la expansión NO se parte por guion')
  assert.equal(slotOf('exp-1:200', CATALOGS), null, 'fuera de la corrida no es un hueco')
  assert.equal(slotOf('exp-1:', CATALOGS), null)
  assert.equal(slotOf('exp-1', CATALOGS), null)
  assert.equal(slotOf(null, CATALOGS), null)
})

test('slotName: EL PIE IMPRIMÍA LA CLAVE INTERNA cuando era una variante', () => {
  /* `ley-6-dor:824` se partía por los dos puntos, `ley-6-dor` no figuraba en la tabla de
     rótulos —ahí sólo hay ids de expansión— y salía tal cual: «No se pudo guardar
     ley-6-dor 824», en el único cartel que aparece cuando algo salió mal. */
  assert.equal(slotName('exp-1:1', CATALOGS), '1')
  assert.equal(slotName('ley-6:824', CATALOGS), '824')
  assert.equal(slotName('ley-6-dor:824', CATALOGS), '824 Dorado',
    'el nombre ENTERO: esto va en una frase, y ahi «824 DO» no dice nada')
  /* Y un sufijo que el catálogo no declara sale en mayúscula, igual que al dibujarlo. */
  assert.equal(slotName('ley-6-hgl:824', CATALOGS), '824 HGL')
  assert.equal(slotName('exp-1:999', CATALOGS), null, 'lo que no es un hueco no tiene nombre de carta')
})

test('EL PREFIJO Y EL CORTO NO SE APILAN: «F F504» era lo que decía', () => {
  /* Los dos hacen el mismo trabajo —decir de qué expansión es— y el 2026-09-27 se
     apilaron: el pie de lo que no se pudo guardar decía «Son la F F504» y el diálogo que
     BORRA listaba «CU Leyenda 3». No se vio contra producción porque no hay ni una carta
     cargada de las dos expansiones con prefijo, así que el test es el único que lo agarra. */
  const withPrefix = makeExpansion({ id: 'ley-f', corto: 'F', desde: 504, hasta: 513, prefijo: 'F' })
  const withoutPrefix = makeExpansion({ id: 'ley-6', corto: 'E6', desde: 727, hasta: 902 })
  /* De otra colección: hay que decir de dónde es. */
  assert.equal(listLabel(withPrefix, 504, false), 'F504', 'el prefijo ya la identifica')
  assert.equal(listLabel(withoutPrefix, 824, false), 'E6 824', 'sin prefijo, va el corto')
  /* De la que estás mirando: el número pelado, que es lo que se lee mejor. */
  assert.equal(listLabel(withPrefix, 504, true), 'F504')
  assert.equal(listLabel(withoutPrefix, 824, true), '824')
  /* Y sin ninguno de los dos, el número y nada más. */
  assert.equal(listLabel(makeExpansion({ id: 'x', desde: 1, hasta: 9 }), 5, false), '5')
})

test('el doble prefijo, contra los CATÁLOGOS DE VERDAD y no contra un fixture', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../public/data/leyenda.json', import.meta.url), 'utf8'))
  const cats = { leyenda: { expansiones: raw.expansiones.map((e) => withVariants(e, raw)) } }
  for (const exp of cats.leyenda.expansiones) {
    if (!exp.prefijo) continue
    const n = exp.desde
    const label = slotName(`${exp.id}:${n}`, cats, false)
    assert.ok(!label.startsWith(`${exp.corto} `),
      `${exp.id}: «${label}» apila el corto sobre el prefijo`)
    assert.ok(!orphanName(`${exp.id}:999999`, cats).startsWith(`${exp.corto} `),
      `${exp.id}: el diálogo que borra apila el corto sobre el prefijo`)
  }
})

test('orphanName: una huérfana se nombra por su expansión, no por su clave', () => {
  /* Éste es el diálogo que BORRA: la lista es con lo que se decide. Una huérfana no apunta
     a ningún hueco, pero su expansión casi siempre existe —el caso típico es un `"hasta"`
     mal tipeado— así que hay algo mejor que decir que la clave cruda. */
  assert.equal(orphanName('exp-1:9999', CATALOGS), 'E1 9999')
  assert.equal(orphanName('ley-6-dor:9999', CATALOGS), 'E6 9999')
  /* Y si ni la expansión existe, la clave es lo único que hay. */
  assert.equal(orphanName('exp-99:1', CATALOGS), 'exp-99:1')
  assert.equal(orphanName('cualquier-cosa', CATALOGS), 'cualquier-cosa')
})

// ---------------------------------------------------------------- la elección del álbum

test('readCollection: sin localStorage se cae a la de siempre en vez de reventar', () => {
  /* Modo privado, o acá mismo: en Node no hay `localStorage` y el acceso tira. */
  assert.equal(readCollection(), DEFAULT_COLLECTION)
  assert.ok(COLLECTIONS.some((c) => c.id === DEFAULT_COLLECTION), 'la de omisión tiene que existir')
})

// ---------------------------------------------------------------- cardLabel

test('cardLabel: el número va con el prefijo de su expansión', () => {
  assert.equal(cardLabel({ id: 'ley-f', prefijo: 'F' }, 504), 'F504')
  assert.equal(cardLabel({ id: 'ley-unicas', prefijo: 'Leyenda ' }, 3), 'Leyenda 3')
  /* Cromeros no tiene prefijo en ninguna expansión y su texto sale byte por byte igual
     que antes: son 28 personas que ya leen ese formato. */
  assert.equal(cardLabel({ id: 'exp-1' }, 5), '5')
  assert.equal(cardLabel(null, 5), '5', 'sin expansión no revienta')
})

test('cardLabel: LOS 19 HUECOS QUE REPITEN NÚMERO quedan distinguidos', () => {
  /* `ley-f` va de 504 a 513 sobre el tramo de `ley-4`, y `ley-unicas` de 1 a 9 sobre el de
     `ley-inicial`. Sin prefijo, la etiqueta hablada y el título del diálogo decían lo
     mismo para dos cartas distintas. Se lee del catálogo de verdad: el día que alguien le
     saque el `prefijo` a una de las dos, esto se pone rojo. */
  const raw = JSON.parse(fs.readFileSync(new URL('../public/data/leyenda.json', import.meta.url), 'utf8'))
  const exps = raw.expansiones.map((e) => withVariants(e, raw))
  const byId = (id) => exps.find((e) => e.id === id)

  const collisions = []
  for (const a of exps) for (const b of exps) {
    if (a.id >= b.id) continue
    for (const n of a.cardNumbers) if (b.cardNumbers.includes(n)) collisions.push([a, b, n])
  }
  assert.equal(collisions.length, 19, 'son 19 huecos con dos cartas cada uno')
  for (const [a, b, n] of collisions)
    assert.notEqual(cardLabel(a, n), cardLabel(b, n),
      `${a.id} y ${b.id} llaman igual a la ${n}: hablado no hay banda que los separe`)

  assert.equal(cardLabel(byId('ley-f'), 504), 'F504')
  assert.equal(cardLabel(byId('ley-4'), 504), '504')
  assert.equal(cardLabel(byId('ley-unicas'), 1), 'Leyenda 1')
  assert.equal(cardLabel(byId('ley-inicial'), 1), '1')
})

test('albumNames: los nombra en prosa y sale de la lista, no escrito a mano', () => {
  /* La bajada de la pantalla de entrada decía «Cartas Cromeros · 2007–2008» y quedó sin
     cambiar el día que entró Leyenda. Sacándolo de acá, agregar una tercera no lo deja
     viejo. */
  assert.equal(albumNames(), 'Cromeros y Leyenda')
  for (const c of COLLECTIONS) assert.ok(albumNames().includes(c.name), `${c.name} no aparece`)
})

test('cada colección tiene id, nombre y archivo, y ningún id repetido', () => {
  for (const c of COLLECTIONS) {
    assert.ok(c.id && c.name && c.file, `${c.id}: le falta algo`)
    assert.match(c.file, /^data\/.+\.json$/, `${c.id}: el archivo va en public/data/`)
  }
  assert.equal(new Set(COLLECTIONS.map((c) => c.id)).size, COLLECTIONS.length)
})
