/* La provincia de «Mi perfil»: una de las 24 jurisdicciones, elegida de una lista que se
   puede escribir para buscar. Era «Ciudad», texto libre, y el 2026-09-30 Angel lo pidió
   así: «que diga provincia, que sean todas las de Argentina [...] que se pueda escribir,
   que se despliegue para que la persona autocomplete, y no pueda enviar una que no sean
   las que son válidas».

   ESTA LISTA ESTÁ COPIADA EN `backend/src/profile.js` (PROVINCES), que es el que dice la
   última palabra. Los tests de los dos lados tienen el mismo literal: si se toca una, se
   toca la otra. */
export const PROVINCES = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Ciudad Autónoma de Buenos Aires', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
]

/* Cómo la dice la gente cuando no la dice entera: las abreviaturas de siempre. Sólo nombres
   de provincia: una ciudad («Rosario») NO lleva a su provincia, porque eso es adivinar. El
   nombre oficial entero de Tierra del Fuego no está: con «Islas» adentro, escribir «la»
   ofrecía Tierra del Fuego sin que nada a la vista lo explicara. */
const ALIASES = {
  'Buenos Aires': ['Bs As', 'BsAs', 'Provincia de Buenos Aires', 'Pcia de Buenos Aires', 'Prov de Buenos Aires',
    'Provincia de Bs As', 'Pcia de Bs As', 'Prov de Bs As', 'PBA'],
  'Ciudad Autónoma de Buenos Aires': ['CABA', 'Capital Federal', 'Cap Fed', 'Ciudad de Buenos Aires', 'Ciudad de Bs As'],
  'Córdoba': ['Cba'],
  'Corrientes': ['Ctes'],
  'Mendoza': ['Mza'],
  'Neuquén': ['Nqn'],
  'Santa Cruz': ['Sta Cruz'],
  'Santa Fe': ['Sta Fe'],
  'Santiago del Estero': ['Sgo del Estero', 'Stgo del Estero', 'S del Estero'],
  'Tierra del Fuego': ['TDF', 'T del Fuego'],
}

/* Sin tildes (\p{M} son las marcas que deja NFD al separar la letra de su tilde), sin
   mayúsculas y sin puntos: «cordoba» es Córdoba, «Bs. As.» es «bs as» y «C.A.B.A.» es
   «caba». El punto se borra en vez de volverse un espacio: en las iniciales con puntos
   separaría las letras y no coincidirían nunca. Así se busca y así se compara; lo que se
   guarda es el nombre de la lista. */
export const fold = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

const NAMES = PROVINCES.map((name) => ({ name, forms: [name, ...(ALIASES[name] ?? [])].map(fold) }))

/* Lo que ofrece la lista para lo que se lleva escrito: primero las que empiezan así, después
   las que tienen esa palabra entera («fe» → Santa Fe antes que Capital FEderal), después
   las que tienen una palabra que empieza así («buenos» → también la Ciudad Autónoma), y al
   final las que lo tienen en el medio. Sin nada escrito, las 24. */
export function findProvinces(query) {
  const q = fold(query)
  if (!q) return PROVINCES
  const rank = ({ forms }) => {
    if (forms.some((f) => f.startsWith(q))) return 0
    if (forms.some((f) => f.split(' ').includes(q))) return 1
    if (forms.some((f) => f.split(' ').some((w) => w.startsWith(q)) || f.includes(' ' + q))) return 2
    if (forms.some((f) => f.includes(q))) return 3
    return 4
  }
  return NAMES.map((p) => ({ name: p.name, r: rank(p) }))
    .filter((p) => p.r < 4)
    .sort((a, b) => a.r - b.r) // estable: dentro de cada grupo, el orden de la lista
    .map((p) => p.name)
}

/* El nombre de la lista si lo escrito ES una provincia (o una forma de decirla), y si no,
   null. «cordoba» → Córdoba, «CABA» → Ciudad Autónoma de Buenos Aires, «Rosario» → null. */
export function exactProvince(text) {
  const q = fold(text)
  return NAMES.find((p) => p.forms.includes(q))?.name ?? null
}

/* LA ÚNICA REGLA de qué queda guardado, para todos los caminos —salir del campo, Enter,
   Guardar—: vacío (o sólo espacios y puntos) es «no la cargó»; si no, el nombre de la lista
   que corresponde a lo escrito, o la única que coincide («cord» → Córdoba); y si no hay una
   sola, null, que quiere decir «esto no es una provincia». Antes, salir del campo y Enter
   resolvían distinto, y un espacio solo bloqueaba el perfil entero. */
export function resolveProvince(text) {
  if (!fold(text)) return ''
  const exact = exactProvince(text)
  if (exact) return exact
  const found = findProvinces(text)
  return found.length === 1 ? found[0] : null
}
