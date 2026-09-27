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
import {
  COLLECTIONS, DEFAULT_COLLECTION, readCollection,
  withVariants, variantsFor, slotKey, slotsOf, drawableVariants, pointsToASlot, numbersOf,
} from '../src/collections.js'

/* Una expansión como sale de un json, para no depender de los catálogos de verdad: lo que
   se prueba acá es el código, y tiene que seguir andando el día que los datos cambien. */
const DORADO = { id: 'dor', nombre: 'Dorado', corto: 'Dor' }
const PLATA = { id: 'pla', nombre: 'Plata', corto: 'Pla' }
const GLITTER = { id: 'gli', nombre: 'Glitter', corto: 'Gli' }

const armar = (e, raw = {}) => withVariants(e, raw)

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
  const e = armar({ id: 'x', desde: 1, hasta: 3, grupos: [{ cartas: [2], variantes: [DORADO] }] })
  assert.ok(e.grupos[0].cartas instanceof Set)
  assert.ok(e.grupos[0].cartas.has(2))
})

test('withVariants: `variantes` queda siendo la UNIÓN, que es lo que se dibuja', () => {
  const e = armar({
    id: 'x', desde: 1, hasta: 40,
    grupos: [{ cartas: [1], variantes: [DORADO] }, { cartas: [2], variantes: [PLATA, DORADO] }],
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
  const otroDorado = { id: 'dor', nombre: 'Dorado de la caja', corto: 'Caja' }
  const e = armar({
    id: 'x', desde: 1, hasta: 9, variantes: [DORADO],
    grupos: [{ cartas: [1], variantes: [otroDorado] }],
  })
  assert.equal(e.variantes.find((v) => v.id === 'dor').nombre, 'Dorado')
})

test('withVariants: sin grupos ni sueltas hereda las de la colección, y si no, ninguna', () => {
  const heredada = armar({ id: 'x', desde: 1, hasta: 9 }, { variantes: [GLITTER] })
  assert.deepEqual(heredada.variantes.map((v) => v.id), ['gli'])
  /* Y todo Cromeros cae acá: ninguna variante en ningún lado. */
  const pelada = armar({ id: 'exp-1', desde: 1, hasta: 129 })
  assert.deepEqual(pelada.variantes, [])
  assert.deepEqual(variantsFor(pelada, 5), [], 'y entonces el toque no pregunta nada')
})

test('withVariants: `lista` sale de numbersOf, no de desde/hasta a mano', () => {
  assert.deepEqual(armar({ id: 'x', numeros: [7, 9] }).lista, [7, 9])
  assert.deepEqual(armar({ id: 'x', desde: 2, hasta: 4 }).lista, [2, 3, 4])
})

// ---------------------------------------------------------------- variantsFor

test('variantsFor: una carta en dos grupos ofrece la unión de los dos', () => {
  /* En la 4ta los colores y el glitter son dos planillas distintas, y hay cartas en las
     dos. Ofrecer sólo las del primer grupo que la contenga sería perder la otra mitad. */
  const e = armar({
    id: 'x', desde: 1, hasta: 9,
    grupos: [{ cartas: [1, 2], variantes: [DORADO, PLATA] }, { cartas: [2], variantes: [GLITTER] }],
  })
  assert.deepEqual(variantsFor(e, 2).map((v) => v.id), ['dor', 'pla', 'gli'])
  assert.deepEqual(variantsFor(e, 1).map((v) => v.id), ['dor', 'pla'])
})

test('variantsFor: las sueltas valen para TODAS las cartas, también las que están en un grupo', () => {
  const e = armar({
    id: 'x', desde: 1, hasta: 9, variantes: [GLITTER],
    grupos: [{ cartas: [1], variantes: [DORADO] }],
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
  const e = armar({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [DORADO] }] })
  assert.deepEqual(slotsOf(e, 1, variantsFor(e, 1), {}), [{ clave: 'x:1', variante: null }])
  /* Una cantidad en cero es lo mismo que no tenerla: no dibuja casillero de variante. */
  assert.deepEqual(slotsOf(e, 1, variantsFor(e, 1), { 'x-dor:1': 0 }), [{ clave: 'x:1', variante: null }])
})

test('slotsOf: SI TENÉS LA VARIANTE Y NO LA BASE, el casillero base no se dibuja', () => {
  /* Sin esta regla quedaba una carta en blanco diciendo «me falta» justo al lado de la
     misma carta que sí tenés, y el filtro «Me faltan» la contaba. */
  const e = armar({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [DORADO, PLATA] }] })
  const vs = variantsFor(e, 1)
  assert.deepEqual(slotsOf(e, 1, vs, { 'x-dor:1': 1 }), [{ clave: 'x-dor:1', variante: DORADO }])
  /* Con la base sí, y la base va primera. */
  assert.deepEqual(
    slotsOf(e, 1, vs, { 'x:1': 1, 'x-pla:1': 3 }),
    [{ clave: 'x:1', variante: null }, { clave: 'x-pla:1', variante: PLATA }]
  )
})

// ---------------------------------------------------------------- drawableVariants

test('drawableVariants: un sufijo que el catálogo NO declara se dibuja igual', () => {
  /* Es la red que deja corregir el catálogo. Sin esto, una fila guardada con el id viejo
     se volvía invisible: no estaba en la grilla, el pie no la ofrecía como huérfana —a
     propósito— y seguía ocupando una fila. Invisible es peor que borrada. */
  const catalogo = [armar({ id: 'ley-6', desde: 727, hasta: 902, grupos: [{ cartas: [824], variantes: [DORADO] }] })]
  const salida = drawableVariants(catalogo, { 'ley-6-hgl:824': 1 })
  assert.deepEqual(salida['ley-6'].map((v) => v.id), ['dor', 'hgl'])
  assert.equal(salida['ley-6'][1].nombre, 'HGL', 'el rótulo sale del id en mayúscula: la señal de que le falta el renglón')
})

test('drawableVariants: lo declarado no se duplica ni se pierde el orden', () => {
  const catalogo = [armar({ id: 'x', desde: 1, hasta: 9, grupos: [{ cartas: [1], variantes: [DORADO, PLATA] }] })]
  const salida = drawableVariants(catalogo, { 'x-dor:1': 2, 'x-pla:1': 1 })
  assert.deepEqual(salida['x'].map((v) => v.id), ['dor', 'pla'])
})

test('drawableVariants: una cantidad en cero no inventa una variante', () => {
  /* Una fila en cero es una carta que NO tenés: no puede agregar un casillero. */
  const catalogo = [armar({ id: 'x', desde: 1, hasta: 9 })]
  assert.deepEqual(drawableVariants(catalogo, { 'x-zzz:1': 0 })['x'], [])
})

test('drawableVariants: la clave base nunca se lee como una variante', () => {
  /* `ley-2-3:200` es la carta 200 de «Expansiones 2 y 3», no la variante «3» de un
     `ley-2`. Se lee contra el id más largo primero justamente por esto. */
  const catalogo = [armar({ id: 'ley-2-3', desde: 177, hasta: 384 }), armar({ id: 'ley-4', desde: 385, hasta: 550 })]
  const salida = drawableVariants(catalogo, { 'ley-2-3:200': 1, 'ley-4:400': 1 })
  assert.deepEqual(salida['ley-2-3'], [])
  assert.deepEqual(salida['ley-4'], [])
})

test('drawableVariants: con un id que es prefijo de otro, gana el más largo', () => {
  /* Es para lo que existe el `sort` por largo, y sin él la variante se le colgaba a la
     expansión equivocada: `ley-6-dor:824` leído contra un `ley` da la variante «6-dor»
     de `ley`, que ni existe. Hoy ningún par de ids es así, y esto es lo que hace que
     agregar uno no rompa nada en silencio. */
  const catalogo = [
    armar({ id: 'ley', desde: 1, hasta: 1078 }),
    armar({ id: 'ley-6', desde: 727, hasta: 902 }),
  ]
  const salida = drawableVariants(catalogo, { 'ley-6-dor:824': 1 })
  assert.deepEqual(salida['ley-6'].map((v) => v.id), ['dor'])
  assert.deepEqual(salida['ley'], [], 'y no se le cuelga a `ley` una variante «6-dor»')
})

test('drawableVariants: una clave de otra colección no se mete en ésta', () => {
  const catalogo = [armar({ id: 'ley-5', desde: 551, hasta: 726 })]
  const salida = drawableVariants(catalogo, { 'exp-1:5': 1, 'sin-dos-puntos': 1 })
  assert.deepEqual(salida['ley-5'], [])
})

test('drawableVariants: sin catálogo y sin cantidades no revienta', () => {
  assert.deepEqual(drawableVariants(null, null), {})
  assert.deepEqual(drawableVariants(undefined, undefined), {})
})

// ---------------------------------------------------------------- pointsToASlot

const CATALOGOS = {
  cromeros: { expansiones: [armar({ id: 'exp-1', desde: 1, hasta: 129 })] },
  leyenda: {
    expansiones: [armar({
      id: 'ley-6', desde: 727, hasta: 902,
      grupos: [{ cartas: [824], variantes: [DORADO] }],
    })],
  },
}

test('pointsToASlot: la base y la variante declarada apuntan a un hueco', () => {
  assert.equal(pointsToASlot('exp-1:1', CATALOGOS), true)
  assert.equal(pointsToASlot('ley-6:824', CATALOGOS), true)
  assert.equal(pointsToASlot('ley-6-dor:824', CATALOGOS), true)
})

test('pointsToASlot: UN SUFIJO DESCONOCIDO TAMBIÉN, y esto es lo que evita un borrado', () => {
  /* Si sacás una línea de `"variantes"`, esas filas siguen apuntando a un hueco que
     existe. Editar un json no puede ofrecer borrar cartas de verdad. */
  assert.equal(pointsToASlot('ley-6-hgl:824', CATALOGOS), true)
  assert.equal(pointsToASlot('ley-6-lo-que-sea:902', CATALOGOS), true)
})

test('pointsToASlot: un número fuera de la corrida NO apunta a nada', () => {
  /* Éste es el caso que el pie tiene que ofrecer sacar: un `"hasta"` mal tipeado. */
  assert.equal(pointsToASlot('exp-1:200', CATALOGOS), false)
  assert.equal(pointsToASlot('ley-6:1', CATALOGOS), false)
  assert.equal(pointsToASlot('ley-6-dor:1', CATALOGOS), false)
})

test('pointsToASlot: una expansión que no existe, y una clave sin forma de clave', () => {
  assert.equal(pointsToASlot('exp-99:1', CATALOGOS), false)
  assert.equal(pointsToASlot('exp-1', CATALOGOS), false, 'sin los dos puntos')
  assert.equal(pointsToASlot('exp-1:', CATALOGOS), false, 'sin número')
  assert.equal(pointsToASlot('exp-1:hola', CATALOGOS), false)
})

test('pointsToASlot: una colección que NO cargó no hace que todo sea huérfano', () => {
  /* `loadCatalogs` devuelve `null` para la que falló. Si esto reventara o dijera `false`
     de todo, el pie ofrecería borrar la colección entera por un archivo que no llegó. */
  const conUnaCaida = { cromeros: CATALOGOS.cromeros, leyenda: null }
  assert.equal(pointsToASlot('exp-1:1', conUnaCaida), true)
  assert.equal(pointsToASlot('ley-6:824', conUnaCaida), false)
  assert.equal(pointsToASlot('exp-1:1', null), false)
})

// ---------------------------------------------------------------- la elección del álbum

test('readCollection: sin localStorage se cae a la de siempre en vez de reventar', () => {
  /* Modo privado, o acá mismo: en Node no hay `localStorage` y el acceso tira. */
  assert.equal(readCollection(), DEFAULT_COLLECTION)
  assert.ok(COLLECTIONS.some((c) => c.id === DEFAULT_COLLECTION), 'la de omisión tiene que existir')
})

test('cada colección tiene id, nombre y archivo, y ningún id repetido', () => {
  for (const c of COLLECTIONS) {
    assert.ok(c.id && c.nombre && c.archivo, `${c.id}: le falta algo`)
    assert.match(c.archivo, /^data\/.+\.json$/, `${c.id}: el archivo va en public/data/`)
  }
  assert.equal(new Set(COLLECTIONS.map((c) => c.id)).size, COLLECTIONS.length)
})
