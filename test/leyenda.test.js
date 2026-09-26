// El catálogo de Leyenda: 1078 numeradas del 1 al 1078, más 10 cartas F y 9 limitadas.
//
// Mismo motivo que `catalogo.test.js`: este archivo se lee en caliente y se edita sin
// recompilar nada, así que no hay build que lo mire. Pero acá hay DOS cosas más que
// vigilar, y son las que sostienen todo el diseño de las variantes:
//
//   1. La clave de una carta es «expansión:número» y la columna es VARCHAR(40), con
//      `claveValida` aceptando 34 caracteres antes de los dos puntos. Una variante es un
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

const crudo = JSON.parse(
  fs.readFileSync(new URL('../public/data/leyenda.json', import.meta.url), 'utf8')
)
const catalogo = crudo.expansiones
/* Las variantes son POR EXPANSIÓN: el vocabulario cambia según el tramo (la Expansión 6
   tiene siete y Personajes doce). Una expansión sin las suyas hereda las de la colección. */
const variantesDe = (exp) => exp.variantes ?? crudo.variantes ?? []
const todasLasVariantes = catalogo.flatMap(variantesDe)

// La misma que usa el backend. Duplicada porque son dos repos; si una cambia, la otra también.
const CLAVE_VALIDA = /^[a-z0-9-]{1,34}:\d{1,5}$/

function numerosDe(exp) {
  if (Array.isArray(exp.numeros)) return exp.numeros
  const salida = []
  for (let n = exp.desde; n <= exp.hasta; n++) salida.push(n)
  return salida
}

const enLaCorrida = catalogo.filter((e) => !e.fuera)
const afuera = catalogo.filter((e) => e.fuera)

test('la corrida es exacta del 1 al 1078, sin duplicados ni huecos', () => {
  const todos = enLaCorrida.flatMap(numerosDe)
  assert.equal(todos.length, 1078, `son ${todos.length} y tienen que ser 1078`)
  const unicos = new Set(todos)
  assert.equal(unicos.size, 1078, 'hay números repetidos entre expansiones')
  assert.equal(Math.min(...todos), 1)
  assert.equal(Math.max(...todos), 1078)
})

test('los rangos se tocan sin pisarse: cada uno arranca donde termina el anterior', () => {
  const ordenadas = [...enLaCorrida].sort((a, b) => a.desde - b.desde)
  for (let i = 1; i < ordenadas.length; i++) {
    assert.equal(
      ordenadas[i].desde,
      ordenadas[i - 1].hasta + 1,
      `${ordenadas[i].id} arranca en ${ordenadas[i].desde} y ${ordenadas[i - 1].id} termina en ${ordenadas[i - 1].hasta}`
    )
  }
})

test('las que están fuera de la corrida son las 10 cartas F y las 9 limitadas', () => {
  assert.equal(afuera.length, 2)
  const f = afuera.find((e) => e.id === 'ley-f')
  const u = afuera.find((e) => e.id === 'ley-unicas')
  assert.equal(numerosDe(f).length, 10, 'las cartas F son F504 a F513')
  assert.equal(numerosDe(u).length, 9, 'las cartas únicas son Leyenda 1 a 9')
  // Se dibujan y se exportan con prefijo, o «504» sería ambiguo contra la 504 de Expansión 4.
  assert.equal(f.prefijo, 'F')
  assert.ok(u.prefijo)
})

test('los huecos del álbum son 1097', () => {
  const total = catalogo.flatMap(numerosDe).length
  assert.equal(total, 1097, 'son 1078 numeradas + 10 cartas F + 9 limitadas')
})

test('cada expansión tiene id, nombre, corto y un color de verdad', () => {
  for (const e of catalogo) {
    assert.match(e.id, /^[a-z0-9-]+$/, `id raro: ${e.id}`)
    assert.ok(e.nombre && e.corto, `${e.id} sin nombre o sin corto`)
    assert.match(e.color, /^#[0-9a-f]{6}$/i, `${e.id} con un color que no es #rrggbb`)
  }
  assert.equal(new Set(catalogo.map((e) => e.id)).size, catalogo.length, 'ids repetidos')
})

test('ningún id choca con los de Cromeros: las dos colecciones comparten la tabla', () => {
  const otras = JSON.parse(
    fs.readFileSync(new URL('../public/data/expansiones.json', import.meta.url), 'utf8')
  ).expansiones.map((e) => e.id)
  for (const e of catalogo) {
    assert.ok(!otras.includes(e.id), `${e.id} ya existe en Cromeros`)
  }
})

/* LOS DOS SEGUROS DEL DISEÑO DE VARIANTES. */

test('ninguna clave derivable se pasa del ancho que acepta el servidor', () => {
  for (const e of catalogo) {
    const sufijos = ['', ...variantesDe(e).map((v) => `-${v.id}`)]
    for (const s of sufijos) {
      const clave = `${e.id}${s}:${Math.max(...numerosDe(e))}`
      assert.ok(
        CLAVE_VALIDA.test(clave),
        `«${clave}» (${clave.length} caracteres) no pasa claveValida — el id de la expansión o el de la variante son demasiado largos`
      )
    }
  }
})

test('ningún id de expansión es igual a otro id más un sufijo de variante', () => {
  const ids = new Set(catalogo.map((e) => e.id))
  /* Se prueban TODAS las variantes contra TODAS las expansiones, no sólo las de cada una:
     el día que alguien le agregue a una expansión una variante que ya existía en otra, el
     choque tiene que aparecer acá y no en la base. */
  for (const e of catalogo) {
    for (const v of todasLasVariantes) {
      const derivada = `${e.id}-${v.id}`
      assert.ok(
        !ids.has(derivada),
        `«${derivada}» es a la vez una variante de ${e.id} y una expansión: dos cartas distintas caerían en la misma clave`
      )
    }
  }
})

test('los ids de variante son cortos, que es lo que los deja entrar en la clave', () => {
  for (const e of catalogo) {
    const suyas = variantesDe(e)
    for (const v of suyas) {
      assert.match(v.id, /^[a-z0-9]{1,3}$/, `el id «${v.id}» de ${e.id} tiene que ser de 1 a 3 letras o números`)
      assert.ok(v.nombre, `la variante ${v.id} de ${e.id} no tiene nombre`)
      assert.ok(v.corto, `la variante ${v.id} de ${e.id} no tiene rótulo corto`)
    }
    assert.equal(new Set(suyas.map((v) => v.id)).size, suyas.length, `ids de variante repetidos en ${e.id}`)
  }
})

/* El mismo nombre con dos ids, o el mismo id con dos nombres, es lo que pasa si alguien
   carga «Oro» en una expansión y «Dorado» en otra — que es literalmente lo que hacen las
   planillas de las que salieron. Son la misma variante y tienen que llamarse igual. */
test('una variante se llama igual en todas las expansiones', () => {
  const porId = {}
  const porNombre = {}
  for (const e of catalogo) {
    for (const v of variantesDe(e)) {
      if (porId[v.id] && porId[v.id] !== v.nombre)
        assert.fail(`el id «${v.id}» es «${porId[v.id]}» en una expansión y «${v.nombre}» en ${e.id}`)
      if (porNombre[v.nombre] && porNombre[v.nombre] !== v.id)
        assert.fail(`«${v.nombre}» tiene dos ids: «${porNombre[v.nombre]}» y «${v.id}» (${e.id})`)
      porId[v.id] = v.nombre
      porNombre[v.nombre] = v.id
    }
  }
})

/* Las dos que salieron de las planillas que pasó Angel el 2026-09-26. Si alguien las
   borra sin querer, esto lo dice. */
test('las variantes que estan cargadas son las de las planillas', () => {
  const dela = (id) => variantesDe(catalogo.find((e) => e.id === id)).map((v) => v.nombre)
  assert.deepEqual(dela('ley-6'),
    ['Naranja', 'Diamante', 'Dorado', 'Verde', 'Plata', 'Rojo', 'Azul'])
  assert.deepEqual(dela('ley-5'),
    ['Dorado', 'Plata', 'Azul', 'Fucsia', 'Verde', 'Naranja', 'Holográfica'])
  assert.equal(dela('ley-personajes').length, 12, 'Personajes junta las dos planillas')
  /* Holográfica y Holo glitter son distintas, no dos nombres de lo mismo. */
  assert.ok(dela('ley-5').includes('Holográfica'))
  assert.ok(dela('ley-personajes').includes('Holo glitter'))
  assert.ok(!dela('ley-personajes').includes('Holográfica'))
  for (const n of ['Plata', 'Dorado', 'Holo glitter', 'Naranja']) {
    assert.ok(dela('ley-personajes').includes(n), `falta ${n} en Personajes`)
  }
})

test('esta colección no usa la condición: lo que se pregunta es la variante', () => {
  assert.equal(crudo.condicion, false)
})
