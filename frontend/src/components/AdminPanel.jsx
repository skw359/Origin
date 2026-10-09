import { useState, useEffect, useCallback } from 'react'
import { useAdminStats } from '../hooks/useAdminStats'
import UsageGraph from './UsageGraph'
import ConsolePanel from './ConsolePanel'

const TIMEFRAMES = [
  ['1h', '1 hour'],
  ['12h', '12 hours'],
  ['24h', '24 hours'],
  ['48h', '48 hours'],
  ['96h', '96 hours'],
  ['1mo', '1 month'],
  ['3mo', '3 months'],
  ['1yr', '1 year'],
  ['all', 'All time'],
]

const ENDPOINTS = [
  ['city', 'City'],
  ['place', 'Place'],
  ['road', 'Road'],
  ['lookup', 'Lookup'],
]

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 10000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function AdminHeader({ children }) {
  return (
    <header className="header">
      <div>
        <a href="#/" className="back-link">&larr; Back to API</a>
        <h1 className="title">Admin</h1>
      </div>
      <div className="header-actions">{children}</div>
    </header>
  )
}

function AdminLogin({ onLogin }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        onLogin()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Sign-in failed')
      }
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card login">
      <h2 className="card-title">Sign in</h2>
      <p className="card-text">Enter the server's ADMIN_TOKEN to see live stats and the request log.</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-token" className="field-label">Admin token</label>
        <div className="input-row">
          <input
            id="admin-token"
            className="input"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={e => setToken(e.target.value)}
            autoFocus
          />
          <button className="button-primary" type="submit" disabled={busy || !token}>Sign in</button>
        </div>
        <p className="form-error" role="alert">{error}</p>
      </form>
    </section>
  )
}

export default function AdminPanel() {
  // null while checking, then { enabled, authenticated }
  const [session, setSession] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/admin/session')
      setSession(await res.json())
    } catch {
      setSession({ enabled: false, authenticated: false, unreachable: true })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function logout() {
    await fetch('/admin/logout', { method: 'POST' }).catch(() => {})
    refresh()
  }

  if (session?.authenticated) {
    return <AdminDashboard onLogout={logout} onSessionLost={refresh} />
  }

  let body = null
  if (session?.unreachable) {
    body = <section className="card"><p className="card-text">Could not reach the server.</p></section>
  } else if (session && !session.enabled) {
    body = (
      <section className="card">
        <p className="card-text">The admin panel is disabled. Set ADMIN_TOKEN on the server to enable it.</p>
      </section>
    )
  } else if (session) {
    body = <AdminLogin onLogin={refresh} />
  }

  return (
    <div className="page">
      <AdminHeader />
      {body}
    </div>
  )
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function AdminDashboard({ onLogout, onSessionLost }) {
  const stats = useAdminStats(onSessionLost)

  return (
    <>
      <div className="page wide">
        <AdminHeader>
          <button className="link-button" onClick={onLogout}>Sign out</button>
        </AdminHeader>

        <div className="stats">
          <Stat value={stats ? stats.rps.toFixed(1) : '—'} label="Requests per second" />
          <Stat value={stats ? stats.throughput.toFixed(1) : '—'} label="Average per second, last minute" />
          <Stat value={stats ? formatNum(stats.timeframes['24h']?.total ?? 0) : '—'} label="Requests, last 24 hours" />
        </div>

        <section className="card">
          <h2 className="card-title">Requests per second, last 5 minutes</h2>
          <UsageGraph data={stats?.graph} />
        </section>

        <section className="card">
          <h2 className="card-title">Requests by period</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Total</th>
                  {ENDPOINTS.map(([key, label]) => <th key={key}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {TIMEFRAMES.map(([key, label]) => {
                  const tf = stats?.timeframes?.[key]
                  return (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="total">{tf ? formatNum(tf.total) : '—'}</td>
                      {ENDPOINTS.map(([ep]) => <td key={ep}>{tf ? formatNum(tf[ep]) : '—'}</td>)}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">By endpoint, all time</h2>
          {ENDPOINTS.map(([ep, label]) => {
            const pct = stats?.endpoints?.[ep]?.pct ?? 0
            const count = stats?.endpoints?.[ep]?.count ?? 0
            return (
              <div key={ep} className="breakdown-row">
                <span className="breakdown-label">
                  <span className="swatch" style={{ background: `var(--series-${ep})` }} aria-hidden="true" />
                  {label}
                </span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ background: `var(--series-${ep})`, transform: `scaleX(${pct / 100})` }} />
                </div>
                <span className="breakdown-count">{formatNum(count)}</span>
                <span className="breakdown-pct">{pct.toFixed(1)}%</span>
              </div>
            )
          })}
        </section>
      </div>
      <ConsolePanel />
    </>
  )
}
