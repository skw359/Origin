import { useState, useEffect } from 'react'
import Header from './components/Header'
import LiveTestCard from './components/LiveTestCard'
import GettingStartedCard from './components/GettingStartedCard'
import EndpointsCard from './components/EndpointsCard'
import AdminPanel from './components/AdminPanel'

export default function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route === '#/admin') {
    return <AdminPanel />
  }

  return (
    <div className="page">
      <Header />
      <main>
        <LiveTestCard />
        <GettingStartedCard />
        <EndpointsCard />
      </main>
      <footer className="footer">
        Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, ODbL
      </footer>
    </div>
  )
}
