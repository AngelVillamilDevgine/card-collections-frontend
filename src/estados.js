// La condición en la que está una carta. Sólo tiene sentido si tenés al menos una,
// así que "me falta" no es un estado: es tener cantidad 0.
export const ESTADOS = [
  { id: 'bien',       label: 'Buen estado'     },
  { id: 'perfecta',   label: 'Perfecta'        },
  { id: 'reemplazar', label: 'Para reemplazar' },
]

export const FALTA = 'falta'

export function etiqueta(id) {
  return ESTADOS.find((e) => e.id === id)?.label ?? 'Me falta'
}
