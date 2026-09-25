// La función que decide si un archivo te borra la colección.
//
// «Restaurar una copia» es el único camino de toda la app que borra en masa, y era el
// que menos validaba: `normalizar` no fallaba NUNCA. Un `null`, una lista, un `{}` o el
// json de cualquier otra cosa se convertían en una colección vacía perfectamente válida,
// el servidor la aceptaba, borraba todo y contestaba 200. Sin preguntar y sin avisar.
//
// Se arregló, se verificó con clicks una vez, y quedó sin una sola prueba que lo
// sostuviera. Esto es esa prueba.
//
// Corre con `node --test`, sin runner ni framework: es lógica pura, no necesita un DOM.
// Lo que sí necesita un navegador —el debounce, el pagehide, el foco— se sigue
// verificando con clicks reales por CDP, que es como se prueba todo lo demás acá.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar } from '../src/almacenamiento.js'

/* LOS QUE BORRABAN TODO. Cada uno de estos llegaba a `reemplazar` como una colección de
   cero cartas. Hoy los seis tienen que devolver `null`, que es lo que hace que el
   diálogo diga «esto no parece una copia» en vez de vaciarte la cuenta. */
test('lo que no es una copia se rechaza, y no se convierte en una colección vacía', () => {
  const basura = [
    ['null', null],
    ['undefined', undefined],
    ['una lista', []],
    ['una lista con cosas', [{ 'exp-1:1': 'bien' }]],
    ['un objeto vacío', {}],
    ['un número', 42],
    ['un texto', 'exp-1:1'],
    ['el json de otra cosa', { nombre: 'Angel', edad: 30 }],
    ['algo que sólo TIENE la palabra', { cantidades: 'muchas' }],
    ['cantidades como lista', { cantidades: [1, 2, 3] }],
    ['estados como lista', { estados: ['bien'] }],
    ['un mapa con una clave que no es carta', { 'exp-1:1': 'bien', hola: 'chau' }],
  ]
  for (const [nombre, valor] of basura)
    assert.equal(normalizar(valor), null, `${nombre} tendría que rechazarse`)
})

test('la forma de hoy entra tal cual', () => {
  const d = normalizar({
    estados: { 'exp-1:1': 'bien', 'exp-1:2': 'perfecta' },
    cantidades: { 'exp-1:1': 3, 'exp-1:2': 1 },
  })
  assert.deepEqual(d.cantidades, { 'exp-1:1': 3, 'exp-1:2': 1 })
  assert.deepEqual(d.estados, { 'exp-1:1': 'bien', 'exp-1:2': 'perfecta' })
})

test('una copia con cantidades pero sin estados es válida: son cartas sin condición', () => {
  const d = normalizar({ cantidades: { 'exp-1:1': 2 } })
  assert.deepEqual(d.cantidades, { 'exp-1:1': 2 })
  assert.deepEqual(d.estados, {})
})

/* Un respaldo puede ser de hace meses, así que las formas viejas del archivo tienen que
   seguir entrando. Si esto se rompe, alguien pierde una copia que sí era buena. */
test('la forma anterior, con repetidas, se traduce a cantidades', () => {
  const d = normalizar({
    estados: { 'exp-1:1': 'bien', 'exp-1:2': 'reemplazar' },
    repetidas: { 'exp-1:1': 2 },
  })
  // Tener la carta es 1; las repetidas se suman encima.
  assert.deepEqual(d.cantidades, { 'exp-1:1': 3, 'exp-1:2': 1 })
  assert.deepEqual(d.estados, { 'exp-1:1': 'bien', 'exp-1:2': 'reemplazar' })
})

test('la forma más vieja, un mapa de estados suelto, también', () => {
  const d = normalizar({ 'exp-1:1': 'bien', 'especial-gt:1500': 'perfecta' })
  assert.deepEqual(d.cantidades, { 'exp-1:1': 1, 'especial-gt:1500': 1 })
  assert.deepEqual(d.estados, { 'exp-1:1': 'bien', 'especial-gt:1500': 'perfecta' })
})

/* El mapa suelto se reconoce porque TODAS sus claves tienen forma de carta. Es la regla
   que separa «un respaldo viejo» de «un json cualquiera», así que el borde importa. */
test('el mapa suelto se reconoce por sus claves, y una sola clave rara lo descarta', () => {
  assert.ok(normalizar({ 'exp-1:1': 'bien' }), 'una clave con forma de carta alcanza')
  assert.equal(normalizar({ 'exp-1:1': 'bien', 'configuracion': 1 }), null,
    'con una clave que no es carta, es otro archivo y no se toca nada')
  assert.equal(normalizar({ 'EXP-1:1': 'bien' }), null, 'las mayúsculas no son forma de carta')
  assert.equal(normalizar({ 'exp-1:999999': 'bien' }), null, 'un número de seis cifras tampoco')
})

/* No alcanza con que devuelva algo: tiene que devolver algo que el servidor acepte. El
   servidor rechaza los reemplazos de cero cartas, así que una copia que normalice a cero
   sería un viaje al pedo y un cartel confuso. */
test('lo que devuelve, cuando devuelve algo, nunca es una colección vacía', () => {
  for (const bueno of [
    { estados: {}, cantidades: { 'exp-1:1': 1 } },
    { estados: { 'exp-1:1': 'bien' }, repetidas: {} },
    { 'exp-1:1': 'bien' },
  ]) {
    const d = normalizar(bueno)
    assert.ok(d, 'tendría que aceptarlo')
    assert.ok(Object.keys(d.cantidades).length > 0, 'y no puede quedar en cero cartas')
  }
})

test('no toca el objeto que le pasan', () => {
  const original = { estados: { 'exp-1:1': 'bien' }, repetidas: { 'exp-1:1': 1 } }
  const copia = JSON.parse(JSON.stringify(original))
  normalizar(original)
  assert.deepEqual(original, copia, 'el archivo leído no se modifica')
})
