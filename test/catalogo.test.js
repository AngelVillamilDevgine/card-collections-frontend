// El catálogo: 1936 cartas, del 1 al 1936, sin duplicados ni huecos.
//
// `expansiones.json` se lee en caliente y se edita sin recompilar nada, que es cómodo y
// justamente por eso peligroso: no hay build que lo mire. La planilla original ya vino
// con dos errores de este tipo —un set entero de números repetidos, y otro que empezaba
// en un número que ya cerraba el set anterior— y se descubrieron a mano.
//
// Un número repetido no es un detalle estético: la clave de una carta es
// «expansión:número», así que dos entradas con el mismo número en sets distintos son dos
// cartas distintas para la base, pero la misma para quien mira el álbum. Y un hueco es
// una carta que existe en el álbum y no se puede marcar nunca.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const TOTAL = 1936
const catalogo = JSON.parse(
  fs.readFileSync(new URL('../public/data/expansiones.json', import.meta.url), 'utf8')
).expansiones

/* Mismo cálculo que hace la app en `numerosDe`: cada expansión es un rango, salvo las
   que traen una lista de números sueltos. */
function numerosDe(exp) {
  if (Array.isArray(exp.numeros)) return exp.numeros
  const salida = []
  for (let n = exp.desde; n <= exp.hasta; n++) salida.push(n)
  return salida
}

const todos = catalogo.flatMap(numerosDe)

test('son 1936 cartas y ni una más', () => {
  assert.equal(todos.length, TOTAL)
})

test('la corrida es exacta del 1 al 1936: sin duplicados y sin huecos', () => {
  const vistos = new Map()
  const repetidos = []
  for (const exp of catalogo) {
    for (const n of numerosDe(exp)) {
      if (vistos.has(n)) repetidos.push(`${n} está en «${vistos.get(n)}» y en «${exp.nombre}»`)
      else vistos.set(n, exp.nombre)
    }
  }
  assert.deepEqual(repetidos, [], 'no puede haber un número en dos expansiones')

  const faltan = []
  for (let n = 1; n <= TOTAL; n++) if (!vistos.has(n)) faltan.push(n)
  assert.deepEqual(faltan, [], 'no puede faltar ningún número del 1 al 1936')
})

test('son 16 expansiones y cada una tiene lo que necesita para dibujarse', () => {
  assert.equal(catalogo.length, 16)
  const ids = new Set()
  for (const exp of catalogo) {
    assert.ok(exp.id, `una expansión sin id: ${JSON.stringify(exp).slice(0, 80)}`)
    assert.ok(!ids.has(exp.id), `el id «${exp.id}» está repetido`)
    ids.add(exp.id)
    assert.ok(exp.nombre, `«${exp.id}» sin nombre`)
    // El color pinta la banda, y de él sale por contraste el color del texto.
    assert.match(exp.color ?? '', /^#[0-9a-fA-F]{6}$/, `«${exp.id}» sin un color válido`)
    // La clave de cada carta es «id:numero», así que el id tiene que entrar en la
    // columna del servidor, que es VARCHAR(40) contando los dos puntos y el número.
    assert.ok(exp.id.length <= 34, `el id «${exp.id}» no entra en la clave`)
    assert.match(exp.id, /^[a-z0-9-]+$/, `el id «${exp.id}» tiene caracteres que la clave no acepta`)
  }
})

/* El patrón de 136 es la herramienta para detectar un rango mal cargado: los sets
   regulares son todos de 136, y las excepciones son cuatro y están documentadas. Si
   aparece una quinta, casi seguro es un error de carga y no una expansión nueva. */
test('los sets son de 136 cartas, salvo las cuatro excepciones conocidas', () => {
  const excepciones = { 129: 2, 6: 1, 88: 2 } // Expansión 1 y Especial GT, Ocultas, las dos de Batalla Final
  const raros = []
  for (const exp of catalogo) {
    const n = numerosDe(exp).length
    if (n === 136) continue
    if (excepciones[n]) { excepciones[n]--; continue }
    raros.push(`«${exp.nombre}» tiene ${n}`)
  }
  assert.deepEqual(raros, [], 'un tamaño que no es 136 ni una de las excepciones conocidas')
})
