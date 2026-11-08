import { useEffect, useMemo, useRef, useState } from 'react'
import { trapFocus, useCloseOnEscape } from './dialog'
import { CONDITIONS, conditionLabel } from './conditions'
import { bulkTargets, bulkPlan, expansionRangeText, countsInTally, plainNumberRun, holeOwned } from './collections'

/* CARGA MASIVA: marcar muchas cartas de una vez, en vez de tocarlas una por una.
 *
 * Está pensada para alguien que llegó perdido: una pregunta por pantalla, ejemplos en cada
 * campo, los NÚMEROS a la vista antes de confirmar y un «Deshacer» al terminar. Los pasos:
 *
 *   scope    ¿Qué querés marcar? (una expansión / un tramo / todo el álbum)
 *   details  cuál, cuáles NO tenés (opcional) y en qué estado están
 *   confirm  «Vas a marcar 98 cartas…», con lo que ya tenías aparte
 *   working  guardando
 *   done     listo, con «Deshacer»
 *   error    no se pudo: no se marcó nada
 *
 * Lo que garantiza, y por qué no asusta: sólo marca las que NO tenés (nunca cambia el estado ni
 * la cantidad de una que ya cargaste), todo entra o no entra nada, y se puede deshacer.
 *
 * Va en las TRES colecciones, y se adapta a lo que cada una tiene:
 *   · sin estado (Leyenda) no pregunta en qué estado están;
 *   · con variantes (Leyenda) NO marca las cartas con acabados —eso es elegir cuál tenés— y se
 *     lo dice, para que las toque una por una;
 *   · donde un número se repite (Serie Dorada: la 5 es de las dos expansiones) no hay tramo, y
 *     «todo el álbum» no deja escribir excepciones por número, que serían ambiguas. */

const CONDITION_HINTS = {
  bien: 'La carta está bien, aunque tenga algo de uso.',
  perfecta: 'Está impecable, como nueva.',
  reemplazar: 'La tenés pero está fea y querés cambiarla por una mejor.',
}

const SCOPES = [
  { id: 'expansion', title: 'Una expansión entera', hint: 'Por ejemplo: toda la Expansión 3.' },
  { id: 'range', title: 'Un tramo de números', hint: 'Por ejemplo: de la 1 a la 50.' },
  { id: 'all', title: 'Todo el álbum', hint: 'Para cuando tenés casi todas las cartas.' },
]

const STEP_NUMBER = { scope: 1, details: 2, confirm: 3 }
const STEP_TITLE = { scope: '¿Qué querés marcar?', details: 'Completá los datos', confirm: 'Revisá antes de marcar' }

/* «Son las cartas de Expansión 2.» / «Son las cartas de la 120 a la 140.» / «Es la carta 7.» / «Son todas las cartas del álbum.» */
function scopeSentence(scope, text) {
  if (scope === 'expansion') return <>Son las cartas de <b>{text}</b>.</>
  if (scope === 'all') return <>Son <b>todas las cartas del álbum</b>.</>
  return text.startsWith('de ') ? <>Son las cartas <b>{text}</b>.</> : <>Es <b>{text}</b>.</>
}

const plural = (n, one, many) => (n === 1 ? one : many)
const fmt = (n) => n.toLocaleString('es-AR')

export default function BulkLoad({ catalog, hasCondition, quantities, isBusy, onApply, onUndo, onClose }) {
  const box = useRef(null)
  const prevFocus = useRef(document.activeElement)
  const [step, setStep] = useState('scope')
  const [scope, setScope] = useState(null)
  const [expansionId, setExpansionId] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [except, setExcept] = useState('')
  const [condition, setCondition] = useState('bien')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)   // { keys, completed, skipped } de lo que se marcó
  const [undone, setUndone] = useState(false)
  const [undoError, setUndoError] = useState(null)
  const working = step === 'working'

  useCloseOnEscape(() => { if (!working) onClose() })
  useEffect(() => trapFocus(box.current, prevFocus.current), [])

  /* Sin estado el valor que viaja es null, y el de «Deshacer» tiene que ser el mismo. */
  const chosen = hasCondition ? condition : null
  const run = useMemo(() => plainNumberRun(catalog), [catalog])
  const hasVariants = useMemo(() => catalog.some((exp) => exp.grupos?.length), [catalog])
  const hasUncounted = useMemo(() => catalog.some((exp) => !countsInTally(exp)), [catalog])
  /* Con un número que se repite entre expansiones, escribir «5» no dice de cuál: sólo se acepta
     elegida UNA expansión. */
  const exceptAllowed = !(scope === 'all' && !run)
  const scopes = SCOPES.filter((s) => s.id !== 'range' || run)

  const ownedIn = (exp) => exp.cardNumbers.filter((n) => holeOwned(exp, n, quantities)).length
  const spec = { scope, expansionId, from, to, except: exceptAllowed ? except : '' }
  const resolved = useMemo(
    () => (step === 'confirm' ? bulkTargets(catalog, spec) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, catalog, scope, expansionId, from, to, except]
  )
  const plan = resolved && !resolved.error ? bulkPlan(resolved.targets, quantities, isBusy) : null

  function goNext(e) {
    e.preventDefault()
    const check = bulkTargets(catalog, spec)
    if (check.error) { setError(check.error); return }
    if (!check.targets.length) { setError('Con eso no queda ninguna carta para marcar. Revisá las que dijiste que NO tenés.'); return }
    setError(null)
    setStep('confirm')
  }

  async function confirm() {
    if (working || !plan?.toMark.length) return
    const before = quantities
    setStep('working')
    try {
      const { markedKeys } = await onApply(plan.toMark.map((t) => t.cardKey), chosen)
      // Qué expansiones se completaron con esta carga, para decírselo.
      const marked = new Set(markedKeys)
      const touched = new Map(plan.toMark.map((t) => [t.exp.id, t.exp]))
      const completed = [...touched.values()]
        .filter((exp) => countsInTally(exp)
          && exp.cardNumbers.every((n) => (before[`${exp.id}:${n}`] ?? 0) > 0 || marked.has(`${exp.id}:${n}`))
          && exp.cardNumbers.some((n) => marked.has(`${exp.id}:${n}`)))
        .map((exp) => exp.nombre)
      setResult({ keys: markedKeys, completed, skipped: plan.skipped.length })
      setUndone(false)
      setUndoError(null)
      setStep('done')
    } catch (e) {
      setError(e?.message || 'No se pudo marcar.')
      setStep('error')
    }
  }

  async function undo() {
    if (working) return
    setUndoError(null)
    try {
      await onUndo(result.keys, chosen)
      setUndone(true)
    } catch (e) {
      setUndoError(e?.message || 'No se pudo deshacer.')
    }
  }

  return (
    <div className="overlay" onClick={() => { if (!working) onClose() }}>
      <div className="dialog bulk" role="dialog" aria-modal="true" aria-label="Carga masiva"
           ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h3>Carga masiva</h3>
        {STEP_NUMBER[step] && (
          <p className="bulk-step">Paso {STEP_NUMBER[step]} de 3 · <b>{STEP_TITLE[step]}</b></p>
        )}

        {step === 'scope' && (
          <>
            <p>Marcá muchas cartas de una sola vez, en vez de tocarlas una por una. Las que ya tenés marcadas no se tocan.</p>
            {hasVariants && (
              <p className="bulk-tip">Las cartas que vienen en distintos acabados (variantes) no se marcan acá: tenés que elegir cuál tenés, así que esas se tocan una por una.</p>
            )}
            {scopes.map((s) => (
              <button key={s.id} type="button" className="option bulk-choice"
                      onClick={() => {
                        setScope(s.id); setError(null); setStep('details')
                      }}>
                <span>{s.title}</span>
                <small>{s.hint}</small>
              </button>
            ))}
            <p className="bulk-tip">¿Tenés pocas? Es más fácil tocar cada carta{hasCondition ? ', o usar «Agregar por número»' : ''}.</p>
            <p className="exits"><button type="button" className="cancel" onClick={onClose}>Cancelar</button></p>
          </>
        )}

        {step === 'details' && (
          <form onSubmit={goNext} noValidate>
            {scope === 'expansion' && (
              <fieldset className="bulk-group">
                <legend>¿Cuál expansión?</legend>
                <div className="bulk-list" role="radiogroup" aria-label="Expansión">
                  {catalog.map((exp, i) => (
                    <label key={exp.id} className="collection-check">
                      <input type="radio" name="bulk-expansion" checked={expansionId === exp.id}
                             autoFocus={i === 0}
                             onChange={() => { setExpansionId(exp.id); setError(null) }} />
                      <span className="bulk-row">
                        <b>{exp.nombre}</b>
                        <small>{expansionRangeText(exp)} · tenés {ownedIn(exp)} de {exp.cardNumbers.length}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {scope === 'range' && (
              <fieldset className="bulk-group">
                <legend>¿De qué número a qué número?</legend>
                <div className="bulk-range">
                  <label>
                    Desde la carta
                    <input type="text" inputMode="numeric" autoComplete="off" placeholder="1" autoFocus
                           value={from} onChange={(e) => { setFrom(e.target.value); setError(null) }} />
                  </label>
                  <label>
                    Hasta la carta
                    <input type="text" inputMode="numeric" autoComplete="off" placeholder="50"
                           value={to} onChange={(e) => { setTo(e.target.value); setError(null) }} />
                  </label>
                </div>
                {run && <small className="bulk-hint">Las cartas van del {run.min} al {run.max}. Se marcan todas las de ese tramo, inclusive las dos puntas.</small>}
              </fieldset>
            )}

            {scope === 'all' && (
              <p className="bulk-all">Se van a marcar <b>todas las cartas del álbum</b> que todavía no tengas marcadas{hasUncounted ? ' (sin los manuales)' : ''}.</p>
            )}

            {exceptAllowed ? (
            <fieldset className="bulk-group">
              <legend>¿Hay alguna que NO tengas? <span>(opcional)</span></legend>
              <label className="bulk-except">
                <span className="sr-only">Números que no tenés</span>
                <input type="text" autoComplete="off" placeholder="Ej: 5, 17, 20-22"
                       value={except} onChange={(e) => { setExcept(e.target.value); setError(null) }} />
              </label>
              <small className="bulk-hint">Si no falta ninguna, dejalo vacío. Si falta alguna, escribí sus números separados por coma y esas se quedan sin marcar. {hasCondition ? ' Si alguna está en otro estado, ponela acá y después la cargás aparte.' : ''}</small>
            </fieldset>
            ) : (
              <p className="bulk-hint">Para dejar alguna sin marcar, elegí una expansión en vez de todo el álbum: así los números no se confunden.</p>
            )}

            {hasCondition && (
            <fieldset className="bulk-group">
              <legend>¿En qué estado están?</legend>
              <div role="radiogroup" aria-label="Estado de las cartas">
                {CONDITIONS.map((c) => (
                  <label key={c.id} className="collection-check">
                    <input type="radio" name="bulk-condition" checked={condition === c.id} onChange={() => setCondition(c.id)} />
                    <span className="bulk-row">
                      <b>{c.label}</b>
                      <small>{CONDITION_HINTS[c.id]}</small>
                    </span>
                  </label>
                ))}
              </div>
              <small className="bulk-hint">Si no sabés, dejá «Buen estado».</small>
            </fieldset>
            )}

            <div className="bulk-actions">
              {error && <p className="error" role="alert">{error}</p>}
              <button type="submit" className="primary">Siguiente</button>
              <div className="bulk-minor">
                <button type="button" className="secondary" onClick={() => { setError(null); setStep('scope') }}>Atrás</button>
                <button type="button" className="cancel" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          </form>
        )}

        {step === 'confirm' && plan && (
          <>
            {plan.toMark.length === 0 ? (
              <>
                <p className="bulk-big">No hay nada para marcar.</p>
                <p>
                  {plan.skipped.length > 0
                    ? `Las que faltan tienen variantes (acabados): tocalas una por una para elegir cuál tenés.`
                    : 'Ya tenías marcadas todas esas cartas. No se cambia ninguna.'}
                </p>
              </>
            ) : (
              <>
                <p className="bulk-big">
                  Vas a marcar <b>{fmt(plan.toMark.length)}</b> {plural(plan.toMark.length, 'carta', 'cartas')}{hasCondition && <> como <b>{conditionLabel(condition, 1)}</b></>}.
                </p>
                <ul className="bulk-facts">
                  <li>{scopeSentence(scope, resolved.scopeText)}</li>
                  {plan.owned.length > 0 && (
                    <li><b>{fmt(plan.owned.length)}</b> {plural(plan.owned.length, 'ya la tenías marcada', 'ya las tenías marcadas')}: {plural(plan.owned.length, 'esa no cambia', 'esas no cambian')}.</li>
                  )}
                  {plan.skipped.length > 0 && (
                    <li><b>{fmt(plan.skipped.length)}</b> {plural(plan.skipped.length, 'tiene variantes (acabados) y no se marca', 'tienen variantes (acabados) y no se marcan')}: {plural(plan.skipped.length, 'tocala', 'tocalas')} {plural(plan.skipped.length, 'y elegí', 'una por una y elegí')} cuál tenés.</li>
                  )}
                  {resolved.excludedCount > 0 && (
                    <li>{plural(resolved.excludedCount, 'La', 'Las')} <b>{fmt(resolved.excludedCount)}</b> que dijiste que NO {plural(resolved.excludedCount, 'tenés queda', 'tenés quedan')} sin marcar.</li>
                  )}
                </ul>
                {(scope === 'all' || plan.toMark.length > 300) && (
                  <p className="eye">Son muchas cartas. Fijate que de verdad las tengas: esta lista es la que ve la gente cuando intercambiás. Si te equivocás, podés deshacerlo en el paso que sigue.</p>
                )}
              </>
            )}
            <div className="bulk-actions">
              {plan.toMark.length > 0 && (
                <button type="button" className="primary" onClick={confirm}>
                  Sí, marcar {fmt(plan.toMark.length)} {plural(plan.toMark.length, 'carta', 'cartas')}
                </button>
              )}
              <div className="bulk-minor">
                <button type="button" className="secondary" autoFocus onClick={() => setStep('details')}>Volver</button>
                <button type="button" className="cancel" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          </>
        )}

        {step === 'working' && (
          <>
            <p className="bulk-big" role="status">Marcando…</p>
            <p>Esperá un momento y no cierres esta ventana.</p>
          </>
        )}

        {step === 'done' && result && (
          <>
            {undone ? (
              <>
                <p className="bulk-big" role="status">Deshecho.</p>
                <p>Esas {fmt(result.keys.length)} {plural(result.keys.length, 'carta volvió', 'cartas volvieron')} a quedar sin marcar, como estaban.</p>
              </>
            ) : (
              <>
                <p className="bulk-big" role="status">¡Listo! Se {plural(result.keys.length, 'marcó', 'marcaron')} {fmt(result.keys.length)} {plural(result.keys.length, 'carta', 'cartas')}.</p>
                {result.completed.length > 0 && (
                  <p className="bulk-celebrate">🎉 {result.completed.length > 3 ? <>Completaste <b>{result.completed.length} expansiones</b>.</> : <>Completaste: <b>{result.completed.join(', ')}</b>.</>}</p>
                )}
                <p>Cada carta quedó con 1. Si tenés repetidas, tocá la carta para sumar otra.</p>
                {result.skipped > 0 && (
                  <p>Quedaron <b>{fmt(result.skipped)}</b> sin marcar porque {plural(result.skipped, 'tiene variantes', 'tienen variantes')}: tocalas para elegir el acabado.</p>
                )}
                <p>¿Te equivocaste? Tocá «Deshacer» y quedan como estaban. Después, para sacar una carta suelta, mantenela apretada.</p>
                {undoError && <p className="error" role="alert">{undoError}</p>}
                <button type="button" className="secondary undo" onClick={undo}>Deshacer</button>
              </>
            )}
            <button type="button" className="primary" autoFocus onClick={onClose}>Cerrar</button>
          </>
        )}

        {step === 'error' && (
          <>
            <p className="bulk-big">No se pudo marcar.</p>
            <p>No se marcó ninguna carta: tu colección quedó como estaba.</p>
            <p className="error" role="alert">{error}</p>
            <button type="button" className="primary" autoFocus onClick={() => { setError(null); setStep('confirm') }}>Probar de nuevo</button>
            <p className="exits"><button type="button" className="cancel" onClick={onClose}>Cancelar</button></p>
          </>
        )}
      </div>
    </div>
  )
}
