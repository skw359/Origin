import { useState, useEffect, useRef } from 'react'

const MAX_LINES = 500
// Request lines already start with "[ISO time]"; the panel shows its own time column.
const LEADING_TIMESTAMP = /^\[\d{4}-\d\d-\d\dT[^\]]*\]\s*/

export default function ConsolePanel() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState([])
  const bodyRef = useRef(null)

  useEffect(() => {
    const evtSrc = new EventSource('/console/stream')
    evtSrc.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data)
        setLogs(prev => [...prev.slice(-(MAX_LINES - 1)), entry])
      } catch {}
    }
    return () => evtSrc.close()
  }, [])

  // Follow new lines only while the reader is already at the bottom.
  useEffect(() => {
    const el = bodyRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight
  }, [logs])

  function show() {
    setOpen(true)
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }

  return (
    <>
      {!open && <button className="console-toggle" onClick={show}>Server log</button>}

      <div className={`console-panel${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="console-header">
          <span className="console-title">Server log</span>
          <div className="console-actions">
            <button className="link-button" onClick={() => setLogs([])}>Clear</button>
            <button className="link-button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
        <div className="console-body" ref={bodyRef}>
          {logs.map((entry, i) => (
            <div key={i} className={`console-line ${entry.level}`}>
              <span className="ts">{entry.ts.slice(11, 19)}</span>
              {entry.msg.replace(LEADING_TIMESTAMP, '')}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
