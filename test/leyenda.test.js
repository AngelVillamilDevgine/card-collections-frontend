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
    ['Azul', 'Azul viento', 'Cyan', 'Dorado', 'Holográfica', 'Naranja', 'Plateado'])
  /* Y la 953, que es de la MISMA expansion, ofrece otras seis. Ese es todo el punto. */
  assert.deepEqual(deLaCarta(porId('ley-personajes'), 953).sort(),
    ['Dorado', 'Fucsia', 'Holográfica', 'Naranja', 'Plateado', 'Verde'])
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
    ['ley-6', 821, 'Plateado'], ['ley-6', 845, 'Plateado'], ['ley-6', 851, 'Plateado'],
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
  const cuantas = (id) => (porId(id).grupos ?? []).reduce((a, g) => a + g.cartas.length, 0)
  assert.equal(cuantas('ley-inicial'), 48, '40 del tracker + las 8 que Angel corrigio con sus cartas')
  assert.equal(cuantas('ley-2-3'), 52)
  assert.equal(cuantas('ley-4'), 57, '47 + las diez que el APK 7.3 del tracker sumó el 2026-10-05')
  assert.equal(cuantas('ley-5'), 44)
  assert.equal(cuantas('ley-6'), 44)
  assert.equal(cuantas('ley-personajes'), 44)
  /* De las 1078 numeradas, 289: lo normal sigue siendo que una carta NO tenga variantes. */
  const total = ['ley-inicial', 'ley-2-3', 'ley-4', 'ley-5', 'ley-6', 'ley-personajes']
    .reduce((a, id) => a + cuantas(id), 0)
  assert.equal(total, 289)
  assert.equal(cuantas('ley-f'), 10, 'las diez F, desde el APK 7.3')
})

/* LO QUE SUMÓ EL TRACKER EL 2026-10-05 (su APK 7.3, cuando el sitio quedó pausado), carta
   por carta: que el total cierre no dice qué ofrece cada una. */
test('lo que sumó el APK 7.3 del tracker, carta por carta', () => {
  const ofrece = (exp, n) => variantsFor(normal(exp), n).map((v) => v.id).sort()
  for (const n of [385, 386, 388, 394, 395, 397, 398, 399, 400, 401])
    assert.deepEqual(ofrece('ley-4', n), ['com', 'gci', 'gli'], `${n}`)
  for (let n = 504; n <= 513; n++) assert.deepEqual(ofrece('ley-f', n), ['com', 'gci', 'gli'], `F${n}`)
  for (let n = 544; n <= 550; n++) assert.deepEqual(ofrece('ley-4', n), ['azu', 'dor', 'gci', 'gli', 'nar', 'pla'], `${n}`)
})

/* LO QUE EL TRACKER SACÓ Y ACÁ SE QUEDA. La 7.3 le sacó la Azul a 21 cartas de Personajes, y
   en producción hay una cuenta con Azul en 947, 975 y 981. Angel, 2026-10-05: «si alguien la
   marcó es porque existe». Sincronizar con el tracker sin mirar esto la borraría del diálogo. */
test('la Azul de Personajes se queda aunque el tracker la haya sacado', () => {
  for (const n of [947, 957, 958, 975, 976, 977, 981, 993, 994, 1013, 1014, 1019, 1025, 1029, 1030,
    1051, 1053, 1055, 1056, 1064, 1065])
    assert.ok(variantsFor(normal('ley-personajes'), n).some((v) => v.id === 'azu'), `la ${n} perdió la Azul`)
})

/* LAS OCHO QUE ANGEL CORRIGIO, una por una. No alcanza con que el total cierre: lo que
   importa es QUE variantes ofrece cada una, que es lo que el tracker tenia mal. */
test('las ocho que Angel corrigio con sus propias cartas', () => {
  const esperado = {
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
  for (const [n, quiero] of Object.entries(esperado))
    assert.deepEqual(deLaCarta(porId('ley-inicial'), Number(n)).sort(), [...quiero].sort(),
      `la ${n} no ofrece lo que Angel tiene en la mano`)
  /* La 22 NO se toca: Angel dijo que tiene variantes pero que solo tiene la comun, asi que
     no puede decir cuales son. Se queda con lo que traia el tracker. */
  assert.ok(deLaCarta(porId('ley-inicial'), 22).length > 1)
})

test('las Expansiones 2 y 3 tienen dos acabados y ninguna carta con version comun', () => {
  /* La guia del tracker: «Las cartas metalizadas NO poseen su variante comun». Es lo que
     confirma que el dialogo no lleve una fila «Comun» puesta de oficio. */
  assert.deepEqual(variantesDe(porId('ley-2-3')).map((v) => v.nombre), ['Dorado', 'Plateado'])
  for (const id of ['ley-2-3', 'ley-5', 'ley-6']) {
    const tiene = variantesDe(porId(id)).some((v) => v.id === 'com')
    assert.ok(!tiene, `${id} no deberia tener ninguna carta con version comun`)
  }
  /* Y el Mazo inicial si: sus 40 cartas con acabado existen tambien en comun y en glitter. */
  assert.ok(variantesDe(porId('ley-inicial')).some((v) => v.id === 'com'))
  assert.ok(variantesDe(porId('ley-inicial')).some((v) => v.id === 'gli'))
})

/* LAS NUEVE CARTAS ÚNICAS TIENEN NOMBRE Y TIRADA. Son el único lugar del álbum donde el
   número no alcanza: esas nueve no llevan número impreso —van con LOTE / EDICIÓN LIMITADA
   Nº / TOTAL, numeradas a mano— así que «Leyenda 3» es una etiqueta nuestra y lo que la
   identifica es el personaje. El dato salió del tracker de Ismael López, leído el
   2026-09-26. */
test('las nueve únicas tienen nombre, y la tirada que las separa', () => {
  const u = normal('ley-unicas')
  assert.ok(u.detalle, 'sin esto la grilla vuelve a ser nueve cuadraditos con un número')
  assert.deepEqual(
    Object.keys(u.detalle).map(Number).sort((a, b) => a - b),
    u.lista,
    'una entrada por hueco: con una sola faltando, esa ficha queda muda al lado de ocho que hablan'
  )
  for (const n of u.lista) {
    const d = u.detalle[n]
    assert.ok(d.nombre && d.nombre.trim(), `Leyenda ${n}: sin nombre`)
    assert.ok(Number.isInteger(d.copias) && d.copias > 0, `Leyenda ${n}: la tirada tiene que ser un entero`)
  }
  assert.equal(u.detalle[9].nombre, 'Shenron')
  assert.equal(u.detalle[9].copias, 500, 'Shenron es la única de 500; las otras ocho son de 1500')
  assert.equal(new Set(u.lista.map((n) => u.detalle[n].nombre)).size, 9, 'no hay dos con el mismo nombre')
})

test('si una expansión trae detalle, lo trae para TODAS sus cartas', () => {
  /* La grilla se ensancha para la expansión ENTERA, así que una carta sin detalle queda
     como una ficha grande con sólo un número adentro. Es la trampa de agregar el campo a
     medias. */
  for (const e of comoLoVeLaApp) {
    if (!e.detalle) continue
    const claves = Object.keys(e.detalle).map(Number)
    for (const n of claves)
      assert.ok(e.lista.includes(n), `${e.id}: el detalle habla de la ${n}, que no existe en esa expansión`)
    assert.equal(claves.length, e.lista.length, `${e.id}: el detalle no cubre todas sus cartas`)
  }
})

test('esta colección no usa la condición: lo que se pregunta es la variante', () => {
  assert.equal(crudo.condicion, false)
})
