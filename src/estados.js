// La condición en la que está una carta. Sólo tiene sentido si tenés al menos una,
// así que "me falta" no es un estado: es tener cantidad 0.
export const ESTADOS = [
  { id: 'bien',       label: 'Buen estado'     },
  { id: 'perfecta',   label: 'Perfecta'        },
  { id: 'reemplazar', label: 'Para reemplazar' },
]

export const FALTA = 'falta'

/* La tenés, pero sin condición cargada. No es un cuarto estado que alguien pueda elegir:
   es lo que pasa cuando la colección no usa condición —Leyenda— y también cuando se
   restaura una copia vieja a la que le faltan estados.

   Hacía falta porque `.carta` SIN clase de estado es exactamente el aspecto de «me
   falta»: una carta que tenés se dibujaba igual que una que no, y el rótulo decía
   «Me falta · tenés 1». En Cromeros era raro; en Leyenda serían las 1097. */
export const TENGO = 'tengo'

/* `cantidad` no es opcional: sin ella no se puede distinguir «no la tengo» de «la tengo
   y no sé en qué estado», que son las dos cosas que daban `null`. */
export function etiqueta(id, cantidad = 0) {
  const hallado = ESTADOS.find((e) => e.id === id)
  if (hallado) return hallado.label
  return cantidad > 0 ? 'La tenés' : 'Me falta'
}

/* La clase de la carta, que es la misma decisión. */
export function claseDe(estado, cantidad) {
  if (!cantidad) return FALTA
  return ESTADOS.some((e) => e.id === estado) ? estado : TENGO
}
