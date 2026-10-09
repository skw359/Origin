const ENDPOINTS = [
  { path: '/city', methods: 'GET · POST', desc: 'City or town containing the point' },
  { path: '/place', methods: 'GET · POST', desc: 'Name of the building, point of interest or area at the point' },
  { path: '/building', methods: 'GET · POST', desc: <>The building at the point, with its address and outline. Optional <code>radius</code> in metres (default 25, max 250)</> },
  { path: '/road', methods: 'GET', desc: 'Nearest named road, its type and distance' },
  { path: '/lookup', methods: 'GET · POST', desc: 'City, place, road, state, county and country together' },
  { path: '/cities/batch', methods: 'POST', desc: 'City for up to 100 points' },
  { path: '/lookup/batch', methods: 'POST', desc: 'Full lookup for up to 100 points' },
  { path: '/health', methods: 'GET', desc: 'Database connection check' },
]

export default function EndpointsCard() {
  return (
    <section className="card">
      <h2 className="card-title">Endpoints</h2>
      <p className="card-text">
        GET takes <code>lat</code> and <code>lon</code> as query parameters; POST takes them as a JSON body.
      </p>
      <ul className="endpoints">
        {ENDPOINTS.map(e => (
          <li className="endpoint" key={e.path}>
            <div>
              <code className="endpoint-path">{e.path}</code>
              <span className="endpoint-methods">{e.methods}</span>
            </div>
            <p className="endpoint-desc">{e.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
