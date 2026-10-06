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
/* LA MISMA función que usa la app, importada y no copiada. Tenía una copia acá que
   aceptaba `exp.numeros` cuando la app no lo leía: los tests daban verde sobre un
   catálogo que la app no podía dibujar. */
import { numbersOf } from '../src/collections.js'

const TOTAL = 1936
const expansions = JSON.parse(
  fs.readFileSync(new URL('../public/data/expansiones.json', import.meta.url), 'utf8')
).expansiones

const allNumbers = expansions.flatMap(numbersOf)

test('son 1936 cartas y ni una más', () => {
  assert.equal(allNumbers.length, TOTAL)
})

test('la corrida es exacta del 1 al 1936: sin duplicados y sin huecos', () => {
  const seenIn = new Map()
  const duplicates = []
  for (const exp of expansions) {
    for (const n of numbersOf(exp)) {
      if (seenIn.has(n)) duplicates.push(`${n} está en «${seenIn.get(n)}» y en «${exp.nombre}»`)
      else seenIn.set(n, exp.nombre)
    }
  }
  assert.deepEqual(duplicates, [], 'no puede haber un número en dos expansiones')

  const missing = []
  for (let n = 1; n <= TOTAL; n++) if (!seenIn.has(n)) missing.push(n)
  assert.deepEqual(missing, [], 'no puede faltar ningún número del 1 al 1936')
})

test('son 16 expansiones y cada una tiene lo que necesita para dibujarse', () => {
  assert.equal(expansions.length, 16)
  const ids = new Set()
  for (const exp of expansions) {
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
  const knownExceptions = { 129: 2, 6: 1, 88: 2 } // Expansión 1 y Especial GT, Ocultas, las dos de Batalla Final
  const unexpected = []
  for (const exp of expansions) {
    const n = numbersOf(exp).length
    if (n === 136) continue
    if (knownExceptions[n]) { knownExceptions[n]--; continue }
    unexpected.push(`«${exp.nombre}» tiene ${n}`)
  }
  assert.deepEqual(unexpected, [], 'un tamaño que no es 136 ni una de las excepciones conocidas')
})
