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
/* Las mismas funciones que la app, importadas y no copiadas: ver el comentario en
   collections.js. Este archivo TENÍA su propia copia de las dos de abajo, que es el
   agujero que ese comentario describe para `numbersOf` — y ya habían divergido: la copia
   dejaba que un grupo redefiniera el rótulo de una variante suelta y `withVariants` se
   queda con el de la suelta. Hoy no muerde porque ninguna expansión tiene las dos, pero
   el día que las tenga el test iba a estar probando otra cosa que la app. */
import { numbersOf, withVariants, variantsFor } from '../src/collections.js'

const crudo = JSON.parse(
  fs.readFileSync(new URL('../public/data/leyenda.json', import.meta.url), 'utf8')
)
/* El catálogo tal como sale del archivo, para lo que se mira de la FORMA del dato (que
   `cartas` sea una lista sin repetidos, por ejemplo). */
const catalogo = crudo.expansiones
/* Y el mismo pasado por la app, para lo que se mira del COMPORTAMIENTO. */
const comoLoVeLaApp = crudo.expansiones.map((e) => withVariants(e, crudo))
const normal = (id) => comoLoVeLaApp.find((e) => e.id === id)

/* Todas las variantes declaradas en una expansión: las de sus grupos más las sueltas.
   Es lo que se dibuja. Lo que se OFRECE en una carta es `deLaCarta`, que es otra cosa. */
const variantesDe = (exp) => normal(exp.id).variantes

/* Las que puede tener ESA carta, que es lo único que decide qué ofrece el diálogo. */
const deLaCarta = (exp, n) => variantsFor(normal(exp.id), n).map((v) => v.nombre)

const porId = (id) => catalogo.find((e) => e.id === id)
const todasLasVariantes = catalogo.flatMap(variantesDe)

// La misma que usa el backend. Duplicada porque son dos repos; si una cambia, la otra también.
const CLAVE_VALIDA = /^[a-z0-9-]{1,34}:\d{1,5}$/

const numerosDe = numbersOf

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

test('cada carta ofrece lo que dice el dato, no el vocabulario del tramo entero', () => {
  /* La 957 es la que reporto Angel: «en la 957 la app tiene muchas mas variantes de las
     que corresponde». Son siete, y no las trece que llego a ofrecer. */
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 957).sort(),
    ['Azul', 'Azul viento', 'Cyan', 'Dorado', 'Holográfica', 'Naranja', 'Plata'])
  /* Y la 953, que es de la MISMA expansion, ofrece otras seis. Ese es todo el punto. */
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 953).sort(),
    ['Dorado', 'Fucsia', 'Holográfica', 'Naranja', 'Plata', 'Verde'])
})

test('ningún grupo ofrece una sola respuesta posible', () => {
  /* La regla de la app es «se pregunta cuando hay mas de una respuesta posible». Un grupo
     de una sola variante abre un dialogo con una sola opcion, que es preguntar al pedo.
     Pasa sobre todo con «Comun»: el dato del tracker lista Normal como un acabado mas, y
     en Personajes hay 92 cartas cuyo unico acabado es ese — esas no tienen variantes y se
     marcan de un toque en el casillero base, que ES la comun. */
  for (const e of catalogo) {
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
  const ids = new Set(catalogo.flatMap((e) => variantesDe(e).map((v) => v.id)))
  assert.ok(!ids.has('hgl'), 'hgl volvio: Holografica y Holo glitter son la misma')
  assert.ok(ids.has('hol'))
  assert.ok(!deLaCarta(porId('ley-6'), 824).includes('Diamantes'),
    'el «Diamante» de la Expansion 6 era Holografica')
  assert.ok(deLaCarta(porId('ley-6'), 824).includes('Holográfica'))
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

/* CUANTAS CARTAS DE CADA TRAMO TIENEN ACABADO. Salen del dato carta por carta que
   publica el tracker de Ismael (leido el 2026-09-26) y son el resumen de todo el archivo:
   si alguien lo regenera mal, o vuelve a aplicar el encabezado de una planilla a todas
   las cartas del tramo, estos seis numeros se mueven. */
test('cuantas cartas tienen acabado en cada tramo', () => {
  const cuantas = (id) => (porId(id).grupos ?? []).reduce((a, g) => a + g.cartas.length, 0)
  assert.equal(cuantas('ley-inicial'), 40)
  assert.equal(cuantas('ley-2-3'), 52)
  assert.equal(cuantas('ley-4'), 47)
  assert.equal(cuantas('ley-5'), 44)
  assert.equal(cuantas('ley-6'), 44)
  assert.equal(cuantas('ley-personajes'), 44)
  /* De las 1078 numeradas, 271: lo normal es que una carta NO tenga variantes. */
  const total = ['ley-inicial', 'ley-2-3', 'ley-4', 'ley-5', 'ley-6', 'ley-personajes']
    .reduce((a, id) => a + cuantas(id), 0)
  assert.equal(total, 271)
})

test('las Expansiones 2 y 3 tienen dos acabados y ninguna carta con version comun', () => {
  /* La guia del tracker: «Las cartas metalizadas NO poseen su variante comun». Es lo que
     confirma que el dialogo no lleve una fila «Comun» puesta de oficio. */
  assert.deepEqual(variantesDe(porId('ley-2-3')).map((v) => v.nombre), ['Dorado', 'Plata'])
  for (const id of ['ley-2-3', 'ley-5', 'ley-6']) {
    const tiene = variantesDe(porId(id)).some((v) => v.id === 'com')
    assert.ok(!tiene, `${id} no deberia tener ninguna carta con version comun`)
  }
  /* Y el Mazo inicial si: sus 40 cartas con acabado existen tambien en comun y en glitter. */
  assert.ok(variantesDe(porId('ley-inicial')).some((v) => v.id === 'com'))
  assert.ok(variantesDe(porId('ley-inicial')).some((v) => v.id === 'gli'))
})

test('esta colección no usa la condición: lo que se pregunta es la variante', () => {
  assert.equal(crudo.condicion, false)
})
