/* Las cuentas de color del proyecto, compartidas entre la app y la planilla de
   variantes. Vivían en App.jsx; se mudaron acá cuando ExportDialog las necesitó —
   importar App desde ExportDialog sería un ciclo, porque App importa ExportDialog. */

const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#1f1c19'

/* Luminancia relativa (WCAG). */
function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/* Se elige el que mida más contraste, no el que caiga de un lado de un umbral:
   con umbral fijo, el naranja de Expansión 1 quedaba con texto blanco a 2.47. */
export function textColorOn(background) {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

/* Un color del catálogo mezclado con blanco: el tinte «vidrioso» del aviso de completar.
   Se mezcla EN JS y no con el color-mix() del CSS, que un Android viejo no entiende — y
   los colores vienen del catálogo en caliente, así que una variable por color tampoco
   alcanzaba. `strength` es cuánto color queda: 0.13 es un vidrio apenas teñido. */
export function tintOf(hex, strength) {
  const n = parseInt(hex.slice(1), 16)
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.round(255 - (255 - v) * strength).toString(16).padStart(2, '0'))
    .join('')
}

/* El color de la expansión vuelto TINTA: oscurecido lo justo hasta leerse sobre el tinte.
   Los colores del catálogo son fondos de banda, no textos — el turquesa de Cartas
   Ocultas sobre casi blanco da alrededor de 2:1 — así que usarlos crudos como texto es
   exactamente el error que la auditoría de contraste ya pagó una vez. Se baja de a 8%
   hasta pasar 4.5, que contra un fondo tan claro siempre llega: el tope del bucle es por
   prolijidad, no porque haga falta. */
export function inkOn(hex, background) {
  const n = parseInt(hex.slice(1), 16)
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  let out = toHex(rgb)
  for (let i = 0; i < 40 && contrastRatio(out, background) < 4.5; i++) {
    rgb = rgb.map((v) => v * 0.92)
    out = toHex(rgb)
  }
  return out
}
