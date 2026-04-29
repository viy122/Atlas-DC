import { formatValue } from '../utils/formatters'

function MetricCard({ label, value, hint }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{formatValue(value)}</p>
      {hint ? <p className="metric-hint">{hint}</p> : null}
    </article>
  )
}

export default MetricCard
