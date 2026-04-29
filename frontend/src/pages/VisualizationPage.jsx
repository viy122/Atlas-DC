import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'

const PIE_COLORS = ['#5b8271', '#7f9ab0', '#9cb7a2', '#d0ad7d', '#6f8f99', '#8daaa0']

function EmptyChart({ title, text }) {
  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
      </div>
      <p className="empty-inline">{text}</p>
    </article>
  )
}

function BarChart({ title, subtitle, data }) {
  if (!data || data.length === 0) {
    return <EmptyChart title={title} text="No data for this chart." />
  }

  const points = data.map((item) => ({
    label: item.label,
    value: Number(item.value) || 0,
  }))
  const maxValue = Math.max(...points.map((item) => item.value), 1)

  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="bar-list">
        {points.map((item, index) => (
          <div className="bar-row" key={`${title}-${item.label}-${index}`}>
            <span className="bar-label">{item.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(item.value / maxValue) * 100}%` }} />
            </div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </article>
  )
}

function PieChart({ title, subtitle, data }) {
  if (!data || data.length === 0) {
    return <EmptyChart title={title} text="No category data yet." />
  }

  const points = data
    .map((item) => ({ label: item.label, value: Number(item.value) || 0 }))
    .filter((item) => item.value > 0)

  const total = points.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) {
    return <EmptyChart title={title} text="No category data yet." />
  }

  const percentages = points.map((item) => (item.value / total) * 100)
  const cumulativePercentages = percentages.reduce(
    (accumulator, currentValue) => [
      ...accumulator,
      (accumulator.at(-1) ?? 0) + currentValue,
    ],
    [],
  )

  const gradient = points
    .map((point, index) => {
      const start = index === 0 ? 0 : cumulativePercentages[index - 1]
      const end = cumulativePercentages[index]
      const color = PIE_COLORS[index % PIE_COLORS.length]
      return `${color} ${start}% ${end}%`
    })
    .join(', ')

  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="pie-layout">
        <div className="pie-visual" style={{ backgroundImage: `conic-gradient(${gradient})` }} />
        <ul className="pie-legend">
          {points.map((point, index) => (
            <li key={`${point.label}-${index}`}>
              <span
                className="legend-dot"
                style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
              />
              <span>{point.label}</span>
              <strong>{Math.round((point.value / total) * 100)}%</strong>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

function LineChart({ title, subtitle, data }) {
  if (!data || data.length < 2) {
    return <EmptyChart title={title} text="Not enough points for trend line." />
  }

  const points = data
    .map((item) => ({ label: item.label, value: Number(item.value) }))
    .filter((item) => Number.isFinite(item.value))

  if (points.length < 2) {
    return <EmptyChart title={title} text="Not enough points for trend line." />
  }

  const width = 540
  const height = 220
  const pad = 26

  const minValue = Math.min(...points.map((point) => point.value))
  const maxValue = Math.max(...points.map((point) => point.value))
  const span = maxValue - minValue || 1

  const polyline = points
    .map((point, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2)
      const y = height - pad - ((point.value - minValue) / span) * (height - pad * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <article className="chart-card chart-wide">
      <div className="chart-head">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <svg className="line-svg" viewBox={`0 0 ${width} ${height}`} role="img">
        <line className="line-axis" x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
        <line className="line-axis" x1={pad} y1={pad} x2={pad} y2={height - pad} />
        <polyline className="line-path" points={polyline} />
      </svg>
    </article>
  )
}

function VisualizationPage() {
  const { datasetId, charts, busyAction, errorMessage, generateDashboard } = useAtlas()

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel">
          <h2>No dataset available</h2>
          <p>Upload your file first before generating visualizations.</p>
          <Link to="/dataset" className="action-button">
            Go to Upload
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-hero-content">
          <p className="page-kicker">Stage 05 / Visualization</p>
          <h2>Read the dataset visually through calm, minimal charts that prioritize clarity.</h2>
          <p>
            These visuals are designed as quick monitoring surfaces: missingness, category share,
            numeric distribution, and trend in one quiet dashboard.
          </p>

          <div className="page-hero-meta">
            <div className="hero-stat">
              <span>Missing chart</span>
              <strong>{charts?.missing_values?.length ?? 0}</strong>
            </div>
            <div className="hero-stat">
              <span>Category chart</span>
              <strong>{charts?.top_categories?.data?.length ?? 0}</strong>
            </div>
            <div className="hero-stat">
              <span>Trend points</span>
              <strong>{charts?.trend_line?.data?.length ?? 0}</strong>
            </div>
          </div>
        </div>

        <aside className="hero-side-card">
          <div>
            <h3>Visualization Controls</h3>
            <p>Generate visuals from the latest available stage, usually the cleaned dataset when it exists.</p>
          </div>
          <div className="page-actions">
            <button
              type="button"
              className="action-button"
              onClick={generateDashboard}
              disabled={busyAction === 'dashboarding'}
            >
              {busyAction === 'dashboarding' ? 'Generating...' : 'Generate Visuals'}
            </button>
          </div>
        </aside>
      </section>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      {charts ? (
        <section className="panel">
          <div className="section-title-row">
            <h3>Visualization Board</h3>
            <p>Simple Power BI-style chart board</p>
          </div>

          <div className="chart-grid">
            <BarChart
              title="Missing Values"
              subtitle="Null count per column"
              data={charts.missing_values}
            />
            <PieChart
              title="Top Categories"
              subtitle={
                charts.top_categories
                  ? `Distribution of ${charts.top_categories.column}`
                  : 'Category distribution'
              }
              data={charts.top_categories?.data ?? []}
            />
            <BarChart
              title="Numeric Distribution"
              subtitle={
                charts.numeric_distribution
                  ? `Binned values for ${charts.numeric_distribution.column}`
                  : 'Numeric spread'
              }
              data={charts.numeric_distribution?.data ?? []}
            />
            <LineChart
              title="Trend Line"
              subtitle={
                charts.trend_line
                  ? `${charts.trend_line.y_label} vs ${charts.trend_line.x_label}`
                  : 'Sequential trend'
              }
              data={charts.trend_line?.data ?? []}
            />
          </div>
        </section>
      ) : (
        <section className="panel empty-panel">
          <h3>No charts yet</h3>
          <p>Click Generate Visuals to render your dashboard charts.</p>
        </section>
      )}
    </div>
  )
}

export default VisualizationPage
