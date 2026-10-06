/* EL PULSO VA CON EL VISITANTE. La página de entrada manda «login:hero» al llegar desde un
   botón de la landing; desde el 2026-10-06 lo manda con el visitante anónimo que guardó
   resume.js, para que el servidor cuente personas y no cargas. Este test llama a la función
   de verdad con un sendBeacon falso. */
import test from 'node:test'
import assert from 'node:assert/strict'

const stored = {}
globalThis.window = { matchMedia: () => ({ matches: false }) }
globalThis.localStorage = { getItem: (k) => stored[k] ?? null, setItem() {}, removeItem() {} }
const sent = []
Object.defineProperty(globalThis, 'navigator', {
  value: { sendBeacon: (url, body) => { sent.push({ url, body }); return true } },
  configurable: true,
})

const { pulse, VISITOR_STORAGE_KEY } = await import('../src/api.js')

test('con visitante, el pulso lleva «clave|visitante»', () => {
  stored[VISITOR_STORAGE_KEY] = 'abcd111122223333'
  sent.length = 0
  pulse('login:hero')
  assert.equal(sent[0].body, 'login:hero|abcd111122223333')
  assert.ok(sent[0].url.endsWith('/pulse'))
})

test('sin visitante, o con uno roto, va la clave sola como siempre', () => {
  delete stored[VISITOR_STORAGE_KEY]
  sent.length = 0
  pulse('login:direct')
  stored[VISITOR_STORAGE_KEY] = 'no-es-un-vid'
  pulse('login:hero')
  assert.deepEqual(sent.map((s) => s.body), ['login:direct', 'login:hero'])
})
