import { useState, useEffect } from 'react'

export default function Header() {
  const [adminEnabled, setAdminEnabled] = useState(false)

  useEffect(() => {
    fetch('/admin/session')
      .then(res => res.json())
      .then(session => setAdminEnabled(Boolean(session.enabled)))
      .catch(() => {})
  }, [])

  return (
    <header className="header">
      <h1 className="title">Origin</h1>
      {adminEnabled && <a href="#/admin" className="link-button">Admin</a>}
    </header>
  )
}
