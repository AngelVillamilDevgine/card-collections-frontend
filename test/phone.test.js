/* El campo de WhatsApp: cómo se parte mientras se escribe y qué viaja al servidor.
 *
 * La lista de formas del MISMO número es la del test del backend (`profile.test.js`): el
 * front y el servidor normalizan cada uno por su lado con la misma librería, y lo que los
 * mantiene juntos es que los dos pasen por los mismos casos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonical, countryOptions, displayInternational, formatNational, fromStored, isTooLong,
  placeholderFor, readInput, toWire, whatsappLink,
} from '../src/phone.js'

const digitsOf = (s) => s.replace(/\D/g, '')

const SAME_NUMBER = [
  '351 671-0050', '3516710050', '0351 15 671-0050', '(0351) 15-6710050', '351 15 671 0050',
  '+54 9 351 671-0050', '+54 351 671 0050', '+54 351 15 671 0050', '5493516710050', '0054 9 351 6710050',
  '9 351 671 0050', '9 351 15 671 0050', '+54 9 351 15 671-0050',
]

test('la característica se parte como la dice cada uno: 11, 351, 2964', () => {
  assert.equal(formatNational('AR', '1155551234'), '11 5555-1234')
  assert.equal(formatNational('AR', '3516710050'), '351 671-0050')
  assert.equal(formatNational('AR', '2964123456'), '2964 12-3456')
  assert.equal(formatNational('AR', '2214567890'), '221 456-7890')
})

test('tecla por tecla, el número se va partiendo sin cambiar nunca los dígitos', () => {
  for (const number of ['1155551234', '3516710050', '2964123456', '0351156710050', '93516710050']) {
    for (let i = 1; i <= number.length; i++) {
      const shown = formatNational('AR', number.slice(0, i))
      assert.equal(digitsOf(shown), number.slice(0, i), `${number} a los ${i}: «${shown}»`)
    }
  }
  assert.equal(formatNational('AR', '351671'), '351 671')
})

test('lo que viaja es el E.164 con el 9, se escriba como se escriba', () => {
  for (const typed of SAME_NUMBER) {
    const { country, national } = readInput('AR', typed)
    assert.equal(toWire(country, national).value, '+5493516710050', typed)
  }
  assert.equal(toWire('AR', '1155551234').value, '+5491155551234')
  assert.equal(toWire('AR', '2964123456').value, '+5492964123456')
  assert.equal(toWire('UY', '94123456').value, '+59894123456')
  assert.equal(toWire('UY', '094123456').value, '+59894123456')
  assert.equal(toWire('AR', '').value, '')
})

test('un número a medias o que no existe no viaja, y dice por qué', () => {
  assert.match(toWire('AR', '351671005').error, /incompleto/)
  assert.match(toWire('AR', '6710050').error, /incompleto/)
  assert.match(toWire('AR', '35167100501234').error, /no parece/)
  assert.match(toWire('AR', '+5').error, /no parece/)
})

test('al salir del campo queda la forma de acá: sin el 0, sin el 15 y sin el 9', () => {
  assert.deepEqual(canonical('AR', '0351156710050'), { country: 'AR', national: '3516710050' })
  assert.deepEqual(canonical('AR', '93516710050'), { country: 'AR', national: '3516710050' })
  assert.deepEqual(canonical('AR', '351156710050'), { country: 'AR', national: '3516710050' })
  assert.deepEqual(canonical('AR', '35167'), { country: 'AR', national: '35167' }) // a medias, no se toca
})

test('las letras no entran, y un «+» adelante cambia el país solo', () => {
  assert.deepEqual(readInput('AR', '11 abc 55'), { country: 'AR', national: '1155' })
  assert.deepEqual(readInput('AR', '+54 9 351 671-0050'), { country: 'AR', national: '3516710050' })
  assert.deepEqual(readInput('AR', '+598 94 123 456'), { country: 'UY', national: '94123456' })
  assert.deepEqual(readInput('AR', '+5'), { country: 'AR', national: '+5' }) // todavía no se sabe
  assert.equal(readInput('AR', '+1 201 555 0123').country, 'US')
})

test('lo guardado vuelve al campo con su país y sin el 9', () => {
  assert.deepEqual(fromStored('5493516710050'), { country: 'AR', national: '3516710050' })
  assert.deepEqual(fromStored('59894123456'), { country: 'UY', national: '94123456' })
  assert.deepEqual(fromStored(''), { country: 'AR', national: '' })
  assert.equal(fromStored('12015550123').country, 'US')
})

test('no entra una tecla de más', () => {
  assert.equal(isTooLong('AR', '3516710050'), false)
  assert.equal(isTooLong('AR', '0351156710050'), false)
  assert.equal(isTooLong('AR', '03511567100501'), true)
})

test('Argentina primero, los nombres en castellano, y el ejemplo de cada país', () => {
  const list = countryOptions()
  assert.equal(list[0].code, 'AR')
  assert.equal(list[0].dial, '54')
  assert.equal(list.find((c) => c.code === 'BR').name, 'Brasil')
  assert.equal(new Set(list.map((c) => c.code)).size, list.length)
  assert.equal(placeholderFor('AR'), '11 2345-6789')
})

test('en el panel: el número completo para leer, y el enlace al chat', () => {
  assert.equal(displayInternational('5493516710050'), '+54 9 351 671-0050')
  assert.equal(displayInternational('5491155551234'), '+54 9 11 5555-1234')
  assert.equal(displayInternational('59894123456'), '+598 94 123 456')
  assert.equal(whatsappLink('5493516710050'), 'https://wa.me/5493516710050')
})

/* Los de la revisión del 2026-09-30: cada uno pasaba, se guardaba o colgaba la app. */
test('lo que tiene el largo justo pero no es un celular de nadie, no viaja', () => {
  assert.match(toWire('AR', '91555551234').error, /no parece/) // el 15 en lugar del 11
  assert.match(toWire('AR', '08001234567').error, /no parece/)
  assert.match(toWire('AR', '90000000000').error, /no parece/)
  assert.match(toWire('DE', '212345678901234').error, /no parece/) // 17 dígitos: no es un E.164
  assert.match(toWire('AR', '299824842').error, /incompleto/) // no se lee como Groenlandia
})

test('un código sin país (+800) no cuelga nada: queda sin resolver', () => {
  for (const typed of ['+8', '+80', '+800', '+800 1234 5678', '+870 773111632']) {
    const next = readInput('AR', typed)
    assert.equal(next.country, 'AR', typed)
    assert.ok(next.national.startsWith('+'), typed)
    assert.match(toWire(next.country, next.national).error, /no parece/)
  }
})

test('lo que viene pegado con algo adelante del «+» igual se reconoce', () => {
  assert.deepEqual(readInput('AR', 'Cel: +598 94 123 456'), { country: 'UY', national: '94123456' })
  assert.deepEqual(readInput('AR', '(+598) 94 123 456'), { country: 'UY', national: '94123456' })
  assert.deepEqual(readInput('AR', '‪+54 9 351 671-0050‬'), { country: 'AR', national: '3516710050' })
})

test('el 9 con el 15 viejo, y el 1 de los celulares mexicanos', () => {
  assert.equal(isTooLong('AR', '9351156710050'), false) // 9 351 15 671 0050: entra entero
  assert.equal(toWire('AR', '9351156710050').value, '+5493516710050')
  assert.deepEqual(readInput('AR', '+52 1 55 1234 5678'), { country: 'MX', national: '5512345678' })
  assert.equal(toWire('MX', '15512345678').value, '+525512345678')
  assert.equal(isTooLong('MX', '15512345678'), false)
})
