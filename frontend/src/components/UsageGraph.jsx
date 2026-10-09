const WIDTH = 960
const HEIGHT = 280
const PAD = { top: 16, right: 12, bottom: 28, left: 44 }

export default function UsageGraph({ data }) {
  if (!data || data.length === 0) {
    return <p className="graph-empty">Waiting for traffic…</p>
  }

  const chartW = WIDTH - PAD.left - PAD.right
  const chartH = HEIGHT - PAD.top - PAD.bottom
  const n = data.length

  const maxVal = Math.max(1, ...data)
  const mag = Math.pow(10, Math.floor(Math.log10(maxVal)))
  const niceMax = Math.ceil(maxVal / mag) * mag

  const x = (i) => PAD.left + (i / Math.max(n - 1, 1)) * chartW
  const y = (v) => PAD.top + chartH - (v / niceMax) * chartH

  const linePath = 'M ' + data.map((v, i) => `${x(i)},${y(v)}`).join(' L ')
  const areaPath = `${linePath} L ${x(n - 1)},${PAD.top + chartH} L ${x(0)},${PAD.top + chartH} Z`

  const gridLines = [0, 0.5, 1].map(frac => ({ y: PAD.top + chartH - frac * chartH, label: Math.round(frac * niceMax) }))

  const xLabels = n < 30 ? [{ i: n - 1, text: 'now' }] : [
    { i: 0, text: `${Math.ceil(n / 60)} min ago` },
    { i: Math.floor((n - 1) / 2), text: `${Math.ceil(n / 120)} min ago` },
    { i: n - 1, text: 'now' },
  ]

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="usage-graph"
      role="img"
      aria-label={`Requests per second over the last ${Math.ceil(n / 60)} minutes; currently ${data[n - 1]}, peak ${maxVal}`}
    >
      {gridLines.map(gl => (
        <g key={gl.y}>
          <line x1={PAD.left} y1={gl.y} x2={WIDTH - PAD.right} y2={gl.y} stroke="var(--border)" strokeWidth="1" />
          <text x={PAD.left - 8} y={gl.y + 4} textAnchor="end" className="graph-label">{gl.label}</text>
        </g>
      ))}
      <path d={areaPath} fill="var(--accent)" fillOpacity="0.12" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {xLabels.map((l, k) => (
        <text
          key={k}
          x={x(l.i)}
          y={HEIGHT - 6}
          textAnchor={k === xLabels.length - 1 ? 'end' : k === 0 ? 'start' : 'middle'}
          className="graph-label"
        >
          {l.text}
        </text>
      ))}
    </svg>
  )
}
