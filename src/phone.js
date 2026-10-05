/* El WhatsApp de «Mi perfil»: cómo se ve mientras se escribe, y cómo viaja.

   SE GUARDA EN E.164 SIN EL «+», SÓLO DÍGITOS (5493516710050), y eso lo decide el servidor
   (`normalizeWhatsapp`, en `profile.js` del backend) con la MISMA librería y la misma
   versión, fijada sin «^» en los dos package.json. Si se separan, un número que el campo
   da por bueno lo rechaza el servidor. Los mensajes de error son los mismos en los dos.

   Acá vive lo que ve la persona: la bandera, el código del país y el número partido como lo
   dice cualquiera de acá — «11 5555-1234» un porteño, «351 671-0050» un cordobés, «2964
   12-3456» uno de Río Grande. Ese partido lo da la librería, que conoce las características
   de 2, 3 y 4 cifras: no hay ninguna tabla nuestra que mantener.

   EL 9 DE LOS CELULARES ARGENTINOS no se muestra —nadie dice su número con él— pero se
   manda, porque WhatsApp lo necesita. Y el 0 y el 15 de toda la vida se aceptan: al salir
   del campo el número queda en la forma de arriba.

   Se valida por LARGO (metadata `min`), no contra los rangos asignados de cada país: los
   rangos rechazan números reales cuando la metadata atrasa. */
import {
  AsYouType, getCountries, getCountryCallingCode, getExampleNumber,
  parsePhoneNumberFromString, validatePhoneNumberLength,
} from 'libphonenumber-js/min'
import metadata from 'libphonenumber-js/min/metadata'
import examples from 'libphonenumber-js/mobile/examples'

export const DEFAULT_COUNTRY = 'AR'
/* Sin un número de ejemplo: el que estaba (351 671-0050) era el de Angel, y lo veía de
   «ejemplo» cualquiera que dejara el suyo a medias. */
const INCOMPLETE = 'Ese WhatsApp parece incompleto: ponelo con la característica (11, 351…) y el número.'
const NOT_A_PHONE = 'Ese WhatsApp no parece un número de teléfono: revisá la característica y el número.'

export const dialCode = (country) => getCountryCallingCode(country)

/* El país de un código cuando el número todavía no alcanza para saberlo: el primero de la
   metadata, que es el principal — el +1 es Estados Unidos, no Antigua, que es la primera
   por orden alfabético. Un código sin país (+800, +870…) no tiene: queda sin resolver. */
const mainCountry = (code) => metadata.country_calling_codes[code]?.[0]

/* Lo que se le saca al número para mostrarlo al lado de su bandera: el 9 de los celulares
   argentinos y el 1 de los mexicanos, que WhatsApp todavía usa. */
const forTheField = (code, national) =>
  code === '54' && national.startsWith('9') ? national.slice(1)
    : code === '52' && national.length === 11 && national.startsWith('1') ? national.slice(1)
      : national

/* ----- COPIADAS DE `backend/src/profile.js`, con los mismos nombres y la misma regla. -----
   No se puede importar de un repo al otro. Si se toca una, se toca la otra; los casos de
   `test/phone.test.js` son los del `profile.test.js` del backend. */
const lengthError = (number, country) =>
  validatePhoneNumberLength(number, country) === 'TOO_SHORT' ? INCOMPLETE : NOT_A_PHONE

function argentineBase(national) {
  const typed = national.startsWith('9') ? national.slice(1) : national
  const phone = parsePhoneNumberFromString(typed, 'AR')
  if (!phone?.isValid()) return { error: lengthError(typed, 'AR') }
  const base = phone.nationalNumber.replace(/^9/, '')
  if (base.length !== 10 || !/^(11|[23])/.test(base)) return { error: NOT_A_PHONE }
  return { digits: '549' + base }
}

function international(digits) {
  if (digits.startsWith('54')) return argentineBase(digits.slice(2))
  if (digits.startsWith('521') && digits.length === 13) digits = '52' + digits.slice(3)
  const phone = parsePhoneNumberFromString('+' + digits)
  if (!phone?.isValid() || !phone.country) return { error: lengthError('+' + digits) }
  const e164 = phone.countryCallingCode + phone.nationalNumber
  return e164.length > 15 ? { error: NOT_A_PHONE } : { digits: e164 }
}
/* ----- fin de lo copiado ----- */

let options = null
/* Argentina primero —es casi toda la gente— y el resto por su nombre en castellano. Si el
   navegador no sabe los nombres (Intl.DisplayNames es de 2020), queda el código. */
export function countryOptions() {
  if (options) return options
  let names = null
  try { names = new Intl.DisplayNames(['es'], { type: 'region' }) } catch { /* sin nombres */ }
  const name = (code) => { try { return names?.of(code) || code } catch { return code } }
  const all = getCountries()
    .map((code) => ({ code, name: name(code), dial: getCountryCallingCode(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const first = all.findIndex((c) => c.code === DEFAULT_COUNTRY)
  options = [all[first], ...all.slice(0, first), ...all.slice(first + 1)]
  return options
}

/* Lo guardado → el país y el número que muestra el campo. */
export function fromStored(digits) {
  if (!digits) return { country: DEFAULT_COUNTRY, national: '' }
  const phone = parsePhoneNumberFromString('+' + digits)
  const country = phone && (phone.country ?? mainCountry(phone.countryCallingCode))
  if (!country) return { country: DEFAULT_COUNTRY, national: digits }
  return { country, national: forTheField(phone.countryCallingCode, phone.nationalNumber) }
}

/* Lo que se ve mientras se escribe. En Argentina, la forma de acá, con guion; en el resto,
   la internacional sin el «+código», que ya está al lado de la bandera. Nunca cambia QUÉ
   dígitos hay, sólo dónde van los espacios: el cursor se ubica contando dígitos. */
export function formatNational(country, national) {
  if (!national || national.startsWith('+')) return national
  if (country === 'AR') {
    // El 9 que algunos ponen adelante (lo vieron en WhatsApp): se respeta hasta salir del campo.
    if (national.startsWith('9')) return ('9 ' + new AsYouType('AR').input(national.slice(1))).trimEnd()
    return new AsYouType('AR').input(national)
  }
  const code = getCountryCallingCode(country)
  const intl = new AsYouType(country).input('+' + code + national)
  return intl.startsWith('+' + code) ? intl.slice(code.length + 1).trimStart() : national
}

/* Una tecla que haría el número más largo de lo que existe en ese país no entra. Se mide
   sin el 9 argentino ni el 1 mexicano, que no cuentan para el largo. */
export function isTooLong(country, national) {
  if (national.startsWith('+')) return false
  const bare = forTheField(getCountryCallingCode(country), national)
  return validatePhoneNumberLength(bare, country) === 'TOO_LONG'
}

/* Lo que entra al campo, tecla o pegado: sólo dígitos. Un «+» como PRIMER carácter que
   cuenta es un número internacional —«Cel: +598…», «(+598)» o las marcas invisibles con
   que viene un número copiado de WhatsApp no lo esconden—, y el país se cambia solo apenas
   se sabe cuál es. Un código sin país (+800) queda sin resolver: no tiene WhatsApp. */
export function readInput(country, text) {
  const lead = text.replace(/[^\d+]/g, '')
  const digits = lead.replace(/\D/g, '')
  if (!lead.startsWith('+')) return { country, national: digits }
  const typing = new AsYouType()
  typing.input('+' + digits)
  const code = typing.getCallingCode()
  const found = code && (typing.getCountry() ?? (getCountryCallingCode(country) === code ? country : mainCountry(code)))
  if (!found) return { country, national: '+' + digits }
  return { country: found, national: forTheField(code, digits.slice(code.length)) }
}

/* Lo que viaja: «+» y el E.164, o el error para mostrar. Con la bandera argentina se lee
   igual que el servidor lee un número sin «+»; con otra, lo que tipeó en la forma de ese
   país (con su 0 de larga distancia, si lo puso). */
export function toWire(country, national) {
  if (!national) return { value: '' }
  if (national.startsWith('+')) return { error: NOT_A_PHONE }
  let result
  if (country === 'AR') {
    result = national.startsWith('00') ? international(national.slice(2))
      : national.startsWith('54') ? international(national)
        : argentineBase(national)
  } else {
    const bare = forTheField(getCountryCallingCode(country), national)
    const phone = parsePhoneNumberFromString(bare, country)
    result = phone?.isValid()
      ? international(phone.countryCallingCode + phone.nationalNumber)
      : { error: lengthError(bare, country) }
  }
  return result.digits ? { value: '+' + result.digits } : { error: result.error }
}

/* La forma de quedar al salir del campo: la misma que se guarda, vuelta a mostrar. */
export function canonical(country, national) {
  const { value } = toWire(country, national)
  return value ? fromStored(value.slice(1)) : { country, national }
}

/* El ejemplo del país, en la forma del campo: «11 2345-6789» en Argentina. */
export function placeholderFor(country) {
  const example = getExampleNumber(country, examples)
  if (!example) return ''
  const shown = fromStored(example.number.slice(1))
  return formatNational(country, shown.national)
}

/* Para el panel: «+54 9 351 671-0050», y el enlace que abre el chat. */
export function displayInternational(digits) {
  if (!digits) return ''
  const phone = parsePhoneNumberFromString('+' + digits)
  if (!phone) return '+' + digits
  if (phone.countryCallingCode === '54') return '+54 9 ' + formatNational('AR', forTheField('54', phone.nationalNumber))
  return new AsYouType().input('+' + digits)
}

export const whatsappLink = (digits) => `https://wa.me/${digits}`
