/* LA CUENTA SE ARMA A MANO EN `quienSoy()`, y cada campo nuevo de /api/yo hay que dejarlo
   pasar ahí. Dos veces falló en silencio: `salud` nunca llegó —el punto rojo del botón
   «Panel», el aviso de la copia de la base, no se encendió ni un día desde que existe— y
   `mustChange` tampoco llegaba. Este test es de comportamiento: llama a la función de
   verdad con un `fetch` falso, no lee el código. */
import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { matchMedia: () => ({ matches: false }) }
globalThis.localStorage = { getItem: () => 'test-token', setItem() {}, removeItem() {} }
let reply
globalThis.fetch = async () =>
  new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })

const { quienSoy } = await import('../src/almacenamiento.js')

test('la cuenta trae la salud del admin: sin eso el punto rojo no se enciende nunca', async () => {
  reply = { usuario: 'angel', admin: true, salud: { respaldo: { hace: 4000, valor: {} } } }
  const account = await quienSoy()
  assert.deepEqual(account.salud, reply.salud)
})

test('la cuenta trae la marca de clave provisoria', async () => {
  reply = { usuario: 'gabriel', admin: false, mustChange: true }
  assert.equal((await quienSoy()).mustChange, true)
})

test('una cuenta común no inventa salud ni marca', async () => {
  reply = { usuario: 'lucas', admin: false }
  const account = await quienSoy()
  assert.equal(account.mustChange, false)
  assert.equal('salud' in account, false)
})
