import { useState, useEffect, useCallback } from 'react'
import { parseCoords } from '../utils/parseCoords'

const MODES = {
  city:   { endpoint: '/city',   label: 'City',        example: '38.978600, -76.490900' },
  place:  { endpoint: '/place',  label: 'Place',       example: '38.981997, -76.937028' },
  road:   { endpoint: '/road',   label: 'Road',        example: '39.286600, -76.612700' },
  lookup: { endpoint: '/lookup', label: 'Lookup',      example: '38.981997, -76.937028' },
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(obj) {
  return escHtml(JSON.stringify(obj, null, 2))
    .replace(/("(\\u[\dA-Fa-f]{4}|\\[^u]|[^"\\])*")(\s*:)?/g, (m, str, _, colon) => {
      if (colon) return `<span class="key">${str}</span><span class="punct">:</span>`
      return `<span class="str">${str}</span>`
    })
    .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="num">$1</span>')
}

function requestUrl(mode, p) {
  return `${MODES[mode].endpoint}?lat=${encodeURIComponent(p.lat)}&lon=${encodeURIComponent(p.lon)}`
}

export default function LiveTestCard() {
  const [mode, setMode] = useState('city')
  const [coords, setCoords] = useState(MODES.city.example)
  const [resultHtml, setResultHtml] = useState('Results appear here.')
  const [resultClass, setResultClass] = useState('result-box')
  const [loading, setLoading] = useState(false)

  const parsed = coords.trim() ? parseCoords(coords) : null

  const runQuery = useCallback(async (value = coords) => {
    const p = parseCoords(value)
    if (!p) {
      setResultClass('result-box fail')
      setResultHtml('Could not read those coordinates.')
      return
    }

    setLoading(true)
    setResultClass('result-box loading')
    setResultHtml('<div class="loader" role="status" aria-label="Loading"></div>')

    try {
      const res = await fetch(requestUrl(mode, p))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setResultClass('result-box success')
      setResultHtml(highlight(data))
    } catch (e) {
      setResultClass('result-box fail')
      setResultHtml(escHtml(e.message))
    } finally {
      setLoading(false)
    }
  }, [coords, mode])

  function selectMode(next) {
    setMode(next)
    setResultClass('result-box')
    setResultHtml('Results appear here.')
    if (Object.values(MODES).some(m => m.example === coords.trim())) setCoords(MODES[next].example)
  }

  // The pasted text lands in the input after this event, so read it on the
  // next tick, straight from the input rather than from stale state.
  function handlePaste(e) {
    const input = e.currentTarget
    setTimeout(() => {
      if (parseCoords(input.value)) runQuery(input.value)
    }, 0)
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Enter' && !loading) runQuery()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [loading, runQuery])

  let hint = <>Decimal degrees, degrees-minutes-seconds, or a Google Maps link</>
  if (coords.trim() && parsed) hint = <code>GET {requestUrl(mode, parsed)}</code>

  return (
    <section className="card">
      <h2 className="card-title">Try it</h2>

      <div className="segmented" role="tablist" aria-label="Endpoint">
        {Object.entries(MODES).map(([key, m]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            className="segment"
            onClick={() => selectMode(key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label htmlFor="coords" className="field-label">Coordinates</label>
      <div className="input-row">
        <input
          id="coords"
          className="input"
          type="text"
          placeholder="38.9820, -76.9370"
          autoComplete="off"
          spellCheck="false"
          value={coords}
          onChange={e => setCoords(e.target.value)}
          onPaste={handlePaste}
        />
        <button className="button-primary" disabled={loading} onClick={() => runQuery()}>
          Run
        </button>
      </div>
      <p className={coords.trim() && !parsed ? 'hint bad' : 'hint'}>
        {coords.trim() && !parsed ? 'Could not read those coordinates.' : hint}
      </p>

      <div
        className={resultClass}
        aria-live="polite"
        dangerouslySetInnerHTML={{ __html: resultHtml }}
      />
    </section>
  )
}
