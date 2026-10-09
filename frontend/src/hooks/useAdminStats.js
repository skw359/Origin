import { useState, useEffect, useRef } from 'react'

export function useAdminStats(onSessionLost) {
  const [stats, setStats] = useState(null)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onSessionLostRef = useRef(onSessionLost)
  onSessionLostRef.current = onSessionLost

  useEffect(() => {
    let disposed = false

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/stats`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          setStats(JSON.parse(e.data))
        } catch {}
      }

      ws.onclose = async () => {
        wsRef.current = null
        if (disposed) return
        // A refused upgrade (expired session) closes like any network drop,
        // so ask the server before retrying forever.
        try {
          const res = await fetch('/admin/session')
          const session = await res.json()
          if (!session.authenticated) {
            if (!disposed) onSessionLostRef.current?.()
            return
          }
        } catch {}
        if (!disposed) reconnectTimer.current = setTimeout(connect, 2000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  return stats
}
