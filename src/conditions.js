// La condición en la que está una carta. Sólo tiene sentido si tenés al menos una,
// así que "me falta" no es un estado: es tener cantidad 0.
/* `id` es el dato que se guarda en la base y NO cambia; `css` es la clase, que va en inglés
   como toda la hoja de estilos. */
export const CONDITIONS = [
  { id: 'bien',       label: 'Buen estado',     css: 'good' },
  { id: 'perfecta',   label: 'Perfecta',        css: 'perfect' },
  { id: 'reemplazar', label: 'Para reemplazar', css: 'replace' },
]

export const MISSING = 'missing'

/* La tenés, pero sin condición cargada. No es un cuarto estado que alguien pueda elegir:
   es lo que pasa cuando la colección no usa condición —Leyenda— y también cuando se
   restaura una copia vieja a la que le faltan estados.

   Hacía falta porque `.card` SIN clase de estado es exactamente el aspecto de «me
   falta»: una carta que tenés se dibujaba igual que una que no, y el rótulo decía
   «Me falta · tenés 1». En Cromeros era raro; en Leyenda serían las 1097. */
export const OWNED = 'owned'

/* `quantity` no es opcional: sin ella no se puede distinguir «no la tengo» de «la tengo
   y no sé en qué estado», que son las dos cosas que daban `null`. */
export function conditionLabel(id, quantity = 0) {
  const found = CONDITIONS.find((e) => e.id === id)
  if (found) return found.label
  return quantity > 0 ? 'La tenés' : 'Me falta'
}

/* La clase de la carta, que es la misma decisión. */
export function conditionClass(condition, quantity) {
  if (!quantity) return MISSING
  return CONDITIONS.find((e) => e.id === condition)?.css ?? OWNED
}
