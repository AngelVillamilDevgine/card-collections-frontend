/* CUÁNDO UNA COPIA DE SEGURIDAD ESTÁ VIEJA. Un solo lugar, y por eso este archivo existe.
 *
 * El umbral vivía escrito a mano adentro de `Estadisticas.jsx`, que es el componente
 * perezoso del panel. Cuando el aviso salió también al encabezado de la app hubo que
 * elegir: copiarlo —y que los dos lados dijeran cosas distintas el día que alguien tocara
 * uno— o sacarlo a un módulo que importen los dos. Es exactamente la clase de duplicación
 * que este proyecto ya pagó con `numbersOf` y con la detección de la app instalada.
 *
 * Pesa treinta líneas y no arrastra nada, así que importarlo desde `App.jsx` no le saca al
 * panel su carga perezosa.
 *
 * LOS PLAZOS SON DISTINTOS A PROPÓSITO: el respaldo corre todos los días y la prueba de
 * restauración una vez por semana, así que «dos días sin copia» ya es una falla y «dos días
 * sin prueba» es lo normal. */

export const STALE_DAYS = {
  respaldo: 2,
  restauracion: 10,
  despliegue: null, // no envejece: el último deploy puede ser de hace un mes y estar bien
}

/* `hace` viene en MINUTOS desde el servidor, a propósito: así el navegador no tiene que
   hacer cuentas con husos horarios, que en este proyecto ya costaron un bug. */
export const daysAgo = (minutos) => (minutos ?? 0) / 60 / 24

/* Sin entrada es lo PEOR, no lo mejor: que nunca se haya anotado una copia significa que el
   timer no corrió nunca, no que esté todo bien. */
export function isStale(entrada, clave) {
  const tope = STALE_DAYS[clave]
  if (tope == null) return false
  return !entrada || daysAgo(entrada.hace) > tope
}

/* Cómo se dice cada una en voz alta. La clave es del servidor; esto es para la persona, así
   que va en castellano como todo lo que se lee. */
export const STALE_LABEL = {
  respaldo: 'la copia de la base',
  restauracion: 'la prueba de restauración',
}

/* Lo que el encabezado necesita saber: ¿hay algo que mirar? Devuelve las claves en falta,
   para que el aviso pueda decir cuál. */
export function whatIsStale(salud) {
  if (!salud) return []
  return Object.keys(STALE_DAYS).filter((k) => STALE_DAYS[k] != null && isStale(salud[k], k))
}

/* La frase del aviso, ya armada: «la copia de la base» o «la copia de la base y la prueba de
   restauración». Sin esto, el botón decía «revisá respaldo y restauracion», que es la clave
   de la tabla y no una frase. */
export const staleText = (claves) =>
  claves.map((k) => STALE_LABEL[k] ?? k).join(' y ')
