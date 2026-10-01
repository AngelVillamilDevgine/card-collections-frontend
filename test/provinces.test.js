/* La provincia de «Mi perfil»: la lista, la búsqueda y qué cuenta como una provincia. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROVINCES, findProvinces, exactProvince, fold, resolveProvince } from '../src/provinces.js'

/* LA MISMA LISTA, literal, está en el profile.test.js del backend. */
const THE_24 = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Ciudad Autónoma de Buenos Aires', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
]

test('son las 24 jurisdicciones, en orden y ninguna más', () => {
  assert.deepEqual(PROVINCES, THE_24)
})

test('se busca sin tildes ni mayúsculas', () => {
  assert.deepEqual(findProvinces('cord'), ['Córdoba'])
  assert.deepEqual(findProvinces('CÓRDO'), ['Córdoba'])
  assert.deepEqual(findProvinces('neuquen'), ['Neuquén'])
  assert.deepEqual(findProvinces('tucu'), ['Tucumán'])
})

test('primero las que empiezan así, después las que tienen una palabra así', () => {
  assert.deepEqual(findProvinces('san'), ['San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero'])
  assert.deepEqual(findProvinces('rio'), ['Río Negro', 'Entre Ríos', 'La Rioja'])
  assert.deepEqual(findProvinces('buenos'), ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires'])
  assert.deepEqual(findProvinces('fuego'), ['Tierra del Fuego'])
})

test('las formas de decirla que usa la gente', () => {
  assert.deepEqual(findProvinces('caba'), ['Ciudad Autónoma de Buenos Aires'])
  assert.deepEqual(findProvinces('capital'), ['Ciudad Autónoma de Buenos Aires'])
  assert.deepEqual(findProvinces('bs. as.'), ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires'])
  assert.deepEqual(findProvinces('tdf'), ['Tierra del Fuego'])
})

test('sin nada escrito, las 24; con algo que no es, ninguna', () => {
  assert.deepEqual(findProvinces(''), THE_24)
  assert.deepEqual(findProvinces('   '), THE_24)
  assert.deepEqual(findProvinces('rosario'), [])
  assert.deepEqual(findProvinces('xyz'), [])
})

test('qué cuenta como una provincia: la de la lista o una forma de decirla, y nada más', () => {
  for (const p of THE_24) assert.equal(exactProvince(p), p)
  assert.equal(exactProvince('cordoba'), 'Córdoba')
  assert.equal(exactProvince('  RÍO   NEGRO '), 'Río Negro')
  assert.equal(exactProvince('CABA'), 'Ciudad Autónoma de Buenos Aires')
  assert.equal(exactProvince('Capital Federal'), 'Ciudad Autónoma de Buenos Aires')
  assert.equal(exactProvince('Bs. As.'), 'Buenos Aires')
  assert.equal(exactProvince('Rosario'), null) // una ciudad no es una provincia
  assert.equal(exactProvince('Córd'), null) // a medias tampoco
  assert.equal(exactProvince(''), null)
})

test('lo que el front manda, el servidor lo reconoce: los nombres no cambian al plegarlos', () => {
  assert.equal(new Set(THE_24.map(fold)).size, 24)
})

/* Los de la revisión del 2026-09-30. */
test('las abreviaturas de siempre, con puntos o sin ellos', () => {
  const cases = {
    'C.A.B.A.': 'Ciudad Autónoma de Buenos Aires', 'Cap. Fed.': 'Ciudad Autónoma de Buenos Aires',
    'Cba': 'Córdoba', 'Cba.': 'Córdoba', 'BsAs': 'Buenos Aires', 'Bs.As.': 'Buenos Aires',
    'Pcia. de Buenos Aires': 'Buenos Aires', 'Prov. de Bs. As.': 'Buenos Aires',
    'Sta. Fe': 'Santa Fe', 'Sta Cruz': 'Santa Cruz', 'S. del Estero': 'Santiago del Estero',
    'Stgo del Estero': 'Santiago del Estero', 'T. del Fuego': 'Tierra del Fuego', 'T.D.F.': 'Tierra del Fuego',
    'Mza': 'Mendoza', 'Nqn': 'Neuquén', 'Ctes': 'Corrientes',
  }
  for (const [typed, name] of Object.entries(cases)) assert.equal(exactProvince(typed), name, typed)
})

test('la palabra entera va antes que el principio de una palabra', () => {
  assert.deepEqual(findProvinces('fe'), ['Santa Fe', 'Ciudad Autónoma de Buenos Aires'])
  assert.deepEqual(findProvinces('la'), ['La Pampa', 'La Rioja']) // ya no aparece Tierra del Fuego por «Islas»
})

test('una sola regla para todos los caminos: vacío, la de la lista, la única, o ninguna', () => {
  assert.equal(resolveProvince(''), '')
  assert.equal(resolveProvince('   '), '') // un espacio no bloquea el perfil
  assert.equal(resolveProvince(' . '), '')
  assert.equal(resolveProvince('caba'), 'Ciudad Autónoma de Buenos Aires')
  assert.equal(resolveProvince('cord'), 'Córdoba') // la única que coincide
  assert.equal(resolveProvince('Santiago'), 'Santiago del Estero')
  assert.equal(resolveProvince('san'), null) // cinco: hay que elegir
  assert.equal(resolveProvince('Rosario'), null)
})
