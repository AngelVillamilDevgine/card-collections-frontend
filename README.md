# Mi colección · Dragon Ball Z, Juego de Cartas Coleccionables

Seguimiento de la colección de **Cromeros S.A.** (Argentina, 2007–2008): 1936 cartas en
16 expansiones. React + Vite. La colección se guarda en tu cuenta, en la
[API](https://github.com/AngelVillamilDevgine/card-collections-backend).

## Cómo se carga

**La cantidad es el modelo.** Cada carta guarda cuántas tenés: `0` = me falta, `1` = la
tengo, `2+` = me sobran. La condición —buen estado, perfecta, para reemplazar— es un
campo aparte y sólo tiene sentido si tenés al menos una.

Todo se hace sobre la carta, sin controles intermedios:

- **Un toque** con cantidad 0 → pregunta la condición y la deja en 1.
- **Un toque** con cantidad ≥ 1 → suma una repetida. No vuelve a preguntar: a la
  repetida no le corresponde un estado propio.
- **Mantener apretado** → resta una. Al llegar a 0 se borra también la condición.

Para cambiar el estado: mantené apretado hasta 0 y tocá de nuevo. Es la única forma, y
es a propósito.

Arriba hay cuatro filtros con su contador — Todas, Me faltan, Repetidas, Para
reemplazar. Al filtrar, las expansiones sin coincidencias no se dibujan.

## Correrlo

```sh
npm install
npm start     # 5173; el proxy manda /api al backend en 8787
```

Necesita el backend corriendo. Si está en otro lado: `DBZ_API=http://host:8787 npm start`.

## Desplegar (Cloudflare Pages)

| | |
|---|---|
| Build | `npm run build` |
| Salida | `dist` |
| Variable | `VITE_API_URL` = `https://api.tudominio.com` |

`VITE_API_URL` se mete en el bundle al construir, así que **cambiarla pide reconstruir**,
no alcanza con guardarla. Y esa URL tiene que estar en `DBZ_ORIGENES` del backend, o el
navegador corta los pedidos por CORS.

## El catálogo

`public/data/expansiones.json` se lee en caliente: se puede corregir sin recompilar.

Las cartas van del **1 al 1936** sin huecos ni repetidos. Los sets regulares son de 136;
las excepciones legítimas son Expansión 1 (129), Cartas Ocultas (6), Especial GT (129) y
las dos de Batalla Final (88 cada una). Ese patrón de 136 es la forma de darse cuenta si
un rango quedó mal cargado.
