const EXAMPLE_RESPONSE = JSON.stringify({
  city: 'College Park',
  place_name: 'McKeldin Library',
  state: 'Maryland',
  state_code: 'MD',
  county: "Prince George's County",
  country: 'United States',
  country_code: 'US',
  road: 'Campus Drive',
  road_type: 'tertiary',
  road_distance_m: 41.7,
  lat: 38.982,
  lon: -76.937,
}, null, 2)

export default function GettingStartedCard() {
  const origin = window.location.origin

  return (
    <section className="card">
      <h2 className="card-title">Quick start</h2>
      <p className="card-text">
        Send a latitude and longitude and get back the city, place, nearest road and region at that point.
      </p>

      <p className="subhead">Request</p>
      <pre className="code">{`curl "${origin}/lookup?lat=38.982&lon=-76.937"`}</pre>

      <p className="subhead">Response</p>
      <pre className="code">{EXAMPLE_RESPONSE}</pre>

      <p className="subhead">Many points at once</p>
      <pre className="code">{`curl -X POST "${origin}/lookup/batch" \\
  -H "Content-Type: application/json" \\
  -d '{"points":[{"lat":38.982,"lon":-76.937},{"lat":38.9786,"lon":-76.4909}]}'`}</pre>
    </section>
  )
}
