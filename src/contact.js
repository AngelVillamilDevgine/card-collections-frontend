/* Cómo se le escribe a Angel: por WhatsApp, con el mensaje ya armado. El servidor no puede
   mandar mail, así que es el único canal, y Angel lo quiere así también para las
   sugerencias (2026-10-05: «que las sugerencias sean por wsp, no dentro de la app»).

   Todo mensaje dice que es de cromeros.com.ar —Angel atiende varios sitios y desde WhatsApp
   no hay forma de saberlo— y, si se sabe, de qué cuenta, para no tener que preguntarlo.

   EL NÚMERO ESTÁ TAMBIÉN EN EL PIE DE LA LANDING (`index.html`), que no carga el bundle y
   no puede importar esto: `test/pages.test.js` compara los dos. */
export const WHATSAPP = '5493516710050'

export const whatsappTo = (text) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`

export const forgotPasswordText = (who) =>
  'Hola Angel, me olvide la clave de cromeros.com.ar (la app de las cartas de Dragon Ball) ' +
  'y no puedo entrar.' + (who ? ` Mi usuario es: ${who}` : '')

/* Termina en un espacio: lo que sigue lo escribe la persona. */
export const suggestionText = (who) =>
  'Hola Angel, te escribo desde la app de cromeros.com.ar' + (who ? ` (mi usuario es ${who})` : '') + ': '
