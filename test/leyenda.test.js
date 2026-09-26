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
/* Todas las variantes declaradas en una expansión: las de sus grupos más las sueltas.
   Es lo que se dibuja. Lo que se OFRECE en una carta es `deLaCarta`, que es otra cosa. */
function variantesDe(exp) {
  const vistas = new Map()
  for (const v of exp.variantes ?? crudo.variantes ?? []) vistas.set(v.id, v)
  for (const g of exp.grupos ?? []) for (const v of g.variantes ?? []) vistas.set(v.id, v)
  return [...vistas.values()]
}

/* Las que puede tener ESA carta, que es lo único que decide qué ofrece el diálogo. */
function deLaCarta(exp, n) {
  if (!exp.grupos?.length) return variantesDe(exp).map((v) => v.nombre)
  const vistas = new Map()
  for (const g of exp.grupos) {
    if (!(g.cartas ?? []).includes(n)) continue
    for (const v of g.variantes ?? []) vistas.set(v.id, v)
  }
  for (const v of exp.variantes ?? []) vistas.set(v.id, v)
  return [...vistas.values()].map((v) => v.nombre)
}

const porId = (id) => catalogo.find((e) => e.id === id)
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

/* LOS GRUPOS SON EL DATO, y estos tests son lo que impide que alguien los «simplifique»
   a una lista por expansión. Eso ya se hizo una vez y el bug llegó a producción: Angel lo
   vio en dos minutos — «en la 957 la app tiene muchas más variantes de las que
   corresponde». La 957 tiene seis, no doce. */

test('una carta que no está en ninguna planilla NO tiene variantes', () => {
  /* El caso que reporto Angel: «la 1069 no tiene variantes, yo no te pase nada, y vos
     estas suponiendo que tiene un monton». Es el caso NORMAL, no la excepcion. */
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 1069), [])
  assert.deepEqual(deLaCarta(porId('ley-inicial'), 5), [])
  assert.deepEqual(deLaCarta(porId('ley-6'), 857), [], 'la 857 la tiene Angel como comun')
})

test('la 957 ofrece las SEIS de su bloque, no las de toda la expansion', () => {
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 957),
    ['Plata', 'Dorado', 'Holográfica', 'Naranja', 'Azul viento', 'Cyan'])
  /* Y la 953, que es el otro bloque de la MISMA planilla y de la misma expansion. */
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 953),
    ['Plata', 'Dorado', 'Holográfica', 'Naranja', 'Violeta', 'Verde'])
})

test('los dos bloques de Personajes son 18 y 18, y no se pisan', () => {
  const g = porId('ley-personajes').grupos
  assert.equal(g.length, 2)
  assert.equal(g[0].cartas.length, 18)
  assert.equal(g[1].cartas.length, 18)
  const juntas = [...g[0].cartas, ...g[1].cartas]
  assert.equal(new Set(juntas).size, 36, 'una carta en los dos bloques saldria en las ocho')
})

test('las cartas de un grupo caen dentro del rango de su expansion', () => {
  /* Un numero fuera del rango no dibuja nada y no ofrece nada: la variante queda
     inalcanzable y no hay forma de notarlo mirando la pantalla. */
  for (const e of catalogo) {
    for (const g of e.grupos ?? []) {
      for (const n of g.cartas ?? []) {
        assert.ok(
          numerosDe(e).includes(n),
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
  const marcadas = [
    ['ley-6', 824, 'Dorado'], ['ley-6', 858, 'Dorado'], ['ley-6', 882, 'Dorado'],
    ['ley-6', 892, 'Dorado'], ['ley-6', 827, 'Naranja'], ['ley-6', 850, 'Naranja'],
    ['ley-6', 821, 'Plata'], ['ley-6', 845, 'Plata'], ['ley-6', 851, 'Plata'],
    ['ley-personajes', 957, 'Cyan'],
  ]
  for (const [id, n, nombre] of marcadas) {
    assert.ok(
      deLaCarta(porId(id), n).includes(nombre),
      `${id}:${n} esta cargada en ${nombre} y el catalogo ya no la ofrece`
    )
  }
  const comunes = [
    ['ley-6', 857], ['ley-6', 859], ['ley-6', 861], ['ley-6', 863], ['ley-6', 871],
    ['ley-6', 873], ['ley-6', 877], ['ley-6', 878], ['ley-6', 886], ['ley-6', 897],
    ['ley-6', 899], ['ley-personajes', 939], ['ley-personajes', 964],
    ['ley-personajes', 1061], ['ley-personajes', 1069],
  ]
  for (const [id, n] of comunes) {
    assert.deepEqual(deLaCarta(porId(id), n), [], `${id}:${n} Angel la dejo comun y el catalogo le ofrece variantes`)
  }
})

/* Si alguien las borra sin querer, esto lo dice. */
test('las variantes que estan cargadas son las de las planillas', () => {
  const dela = (id) => variantesDe(porId(id)).map((v) => v.nombre)
  assert.deepEqual(dela('ley-6'),
    ['Naranja', 'Diamante', 'Dorado', 'Verde', 'Plata', 'Rojo', 'Azul'])
  assert.deepEqual(dela('ley-5'),
    ['Dorado', 'Plata', 'Azul', 'Fucsia', 'Verde', 'Naranja', 'Holográfica'])
  assert.deepEqual(dela('ley-2-3'), ['Plata', 'Dorado'])
  assert.equal(dela('ley-inicial').length, 9)
  assert.equal(dela('ley-4').length, 6)
  assert.equal(dela('ley-personajes').length, 8, 'las dos planillas juntas, sin repetir')
})

test('esta colección no usa la condición: lo que se pregunta es la variante', () => {
  assert.equal(crudo.condicion, false)
})
