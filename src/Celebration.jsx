import { useEffect, useRef } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'

/* EL FESTEJO DE COMPLETAR UNA EXPANSIÓN O EL ÁLBUM. Lo pidió Angel: «que salten fuegos
   artificiales o algo, quizás un modal que diga felicitaciones, sin sonido, nada que tilde
   un teléfono, pero que sea un buen gesto».

   Qué lo dispara lo decide `completionBy` (collections.js), y sólo con un toque: nunca al
   cargar ni al restaurar una copia.

   Es el diálogo de siempre —telón, Escape, Atrás y el foco adentro, como los demás— más un
   canvas encima con los fuegos. Encima y no debajo del telón, que los oscurecería; y sin
   recibir toques, así nunca tapa el botón. */
export default function Celebration({ title, detail, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  useCloseOnEscape(onClose)
  useEffect(() => trapFocus(box.current, prevFocus.current), [])
  return (
    <>
      <div className="overlay" onClick={onClose}>
        <div className="dialog celebration" role="dialog" aria-modal="true"
             aria-labelledby="celebration-title" aria-describedby="celebration-detail"
             ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <h3 id="celebration-title">{title}</h3>
          <p id="celebration-detail">{detail}</p>
          <button className="primary" onClick={onClose} autoFocus>¡Gracias!</button>
        </div>
      </div>
      <Fireworks />
    </>
  )
}

/* Los colores de la app: el naranja de la barra, dorado, el rojo de «reemplazar», el azul
   de Leyenda y un crema para que alguna chispa brille. */
const SPARK_COLORS = ['#ffd34d', '#f4a11d', '#e8452c', '#4f8df5', '#fff3d6']

/* Cinco explosiones en dos segundos, sin librería: un canvas y unas doscientas chispas.

   LO QUE LO HACE LIVIANO, que es la condición que puso Angel: cada chispa es un segmento
   corto (posición de antes → de ahora), sin sombras ni desenfoques, que son lo que cuesta
   en un teléfono; la densidad de píxeles se tapa en 2; hay menos chispas en pantallas
   angostas; y al apagarse la última chispa se deja de pedir cuadros, así que no queda
   nada corriendo de fondo.

   El movimiento va por TIEMPO y no por cuadro: en una pantalla de 120 Hz las chispas
   viajarían al doble de velocidad y duraría la mitad. Con «reducir movimiento» activado
   no se dibuja nada —para algunas personas no es un gusto sino mareo— y queda el diálogo,
   que dice lo mismo. */
function Fireworks() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const width = innerWidth
    const height = innerHeight
    const ratio = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'

    const sparksPerBurst = width < 600 ? 32 : 46
    const burstTimes = [0, 320, 650, 1000, 1350]
    const sparks = []
    const burst = () => {
      const x = width * (0.18 + Math.random() * 0.64)
      const y = height * (0.15 + Math.random() * 0.35)
      const colors = [SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)], SPARK_COLORS[4]]
      const reach = Math.min(width, height) / 160
      for (let i = 0; i < sparksPerBurst; i++) {
        const angle = (i / sparksPerBurst) * Math.PI * 2 + Math.random() * 0.3
        const speed = reach * (0.8 + Math.random() * 1.6)
        sparks.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          age: 0, life: 900 + Math.random() * 500, color: colors[i % 4 === 0 ? 1 : 0],
        })
      }
    }

    const start = performance.now()
    let last = start
    let frame = 0
    const tick = (now) => {
      const elapsed = now - start
      const step = Math.min((now - last) / 16.7, 3)  // en cuadros de 60 Hz; tapado por si la pestaña se durmió
      last = now
      while (burstTimes.length && elapsed >= burstTimes[0]) { burstTimes.shift(); burst() }
      ctx.clearRect(0, 0, width, height)
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.age += step * 16.7
        if (s.age >= s.life) { sparks.splice(i, 1); continue }
        const px = s.x
        const py = s.y
        s.vx *= 0.985 ** step
        s.vy = s.vy * 0.985 ** step + 0.045 * step
        s.x += s.vx * step
        s.y += s.vy * step
        ctx.globalAlpha = 1 - s.age / s.life
        ctx.strokeStyle = s.color
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()
      }
      if (burstTimes.length || sparks.length) frame = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, width, height)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <canvas ref={canvasRef} className="fireworks" aria-hidden="true" />
}
