import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatValue, formatBytes, formatPercent } from '../utils/formatters'
import heroGraphic from '../assets/hero.png'

const COMPONENTS = [
  'Bar Chart',
  'Line Chart',
  'Pie Chart',
  'Metric Card',
  'Data Table',
]

const DONUT_COLORS = ['#635bff', '#00a76f', '#1f8efa', '#9aa7bd', '#b7c2d9']

function calculateDelta(data = []) {
  if (data.length < 2) {
    return null
  }

  const first = Number(data[0]?.value)
  const last = Number(data[data.length - 1]?.value)
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return null
  }

  return ((last - first) / Math.abs(first)) * 100
}

function BuilderMetricWidget({ title, value, delta }) {
  return (
    <article className="builder-widget builder-widget--metric">
      <div className="builder-widget__header">
        <h3>{title}</h3>
      </div>
      <strong>{formatValue(value)}</strong>
      <span className={delta !== null && delta >= 0 ? 'trend-chip trend-chip--up' : 'trend-chip'}>
        {delta === null ? 'No delta yet' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs baseline`}
      </span>
    </article>
  )
}

function BuilderLineWidget({ title, data = [] }) {
  const points = data
    .map((item) => ({ label: item.label, value: Number(item.value) }))
    .filter((item) => Number.isFinite(item.value))

  if (points.length < 2) {
    return (
      <article className="builder-widget builder-widget--line">
        <div className="builder-widget__header">
          <h3>{title}</h3>
        </div>
        <p className="empty-state-inline">Not enough points to render the line chart.</p>
      </article>
    )
  }

  const width = 620
  const height = 270
  const pad = 28
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
    <article className="builder-widget builder-widget--line">
      <div className="builder-widget__header">
        <h3>{title}</h3>
      </div>
      <svg className="builder-line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="line-axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="line-axis" />
        <polyline points={polyline} className="line-path" />
      </svg>
      <div className="builder-line-footer">
        {points.slice(0, 5).map((point) => (
          <span key={`${title}-${point.label}`}>{point.label}</span>
        ))}
      </div>
    </article>
  )
}

function BuilderDonutWidget({ title, data = [] }) {
  const points = data
    .map((item) => ({ label: item.label, value: Number(item.value) || 0 }))
    .filter((item) => item.value > 0)
    .slice(0, 5)

  if (points.length === 0) {
    return (
      <article className="builder-widget builder-widget--donut">
        <div className="builder-widget__header">
          <h3>{title}</h3>
        </div>
        <p className="empty-state-inline">No category data yet.</p>
      </article>
    )
  }

  const total = points.reduce((sum, item) => sum + item.value, 0)
  const cumulative = points.map((p, i) => points.slice(0, i).reduce((s, x) => s + x.value, 0))
  const gradient = points
    .map((point, index) => {
      const start = (cumulative[index] / total) * 100
      const end = ((cumulative[index] + point.value) / total) * 100
      return `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start}% ${end}%`
    })
    .join(', ')

  return (
    <article className="builder-widget builder-widget--donut">
      <div className="builder-widget__header">
        <h3>{title}</h3>
      </div>
      <div className="builder-donut-layout">
        <div className="builder-donut" style={{ backgroundImage: `conic-gradient(${gradient})` }} />
        <ul className="builder-legend">
          {points.map((point, index) => (
            <li key={`${title}-${point.label}`}>
              <span
                className="legend-dot"
                style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
              />
              <span>{point.label}</span>
              <strong>{formatValue(point.value)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

function BuilderTableWidget({ title, rows = [] }) {
  return (
    <article className="builder-widget builder-widget--table">
      <div className="builder-widget__header">
        <h3>{title}</h3>
      </div>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.label}-${row.value}`}>
                  <td>{row.label}</td>
                  <td>{formatValue(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state-inline">No table rows available yet.</p>
      )}
    </article>
  )
}

function DashboardPage() {
  const {
    datasetId,
    fileName,
    datasetMeta,
    activeProfile,
    analysis,
    charts,
    busyAction,
    generateDashboard,
  } = useAtlas()

  const [dimension, setDimension] = useState('')
  const [measure, setMeasure] = useState('')

  const columns = useMemo(() => activeProfile?.columns ?? [], [activeProfile])
  const numericSummary = useMemo(() => analysis?.numeric_summary ?? [], [analysis])
  const topFrequencies = analysis?.top_frequencies ?? []

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setDimension(columns[1] ?? columns[0] ?? '')
    setMeasure(numericSummary[0]?.column ?? '')
  }, [columns, numericSummary])
  /* eslint-enable react-hooks/set-state-in-effect */

  const metricDelta = calculateDelta(charts?.trend_line?.data ?? [])
  const frequencyRows =
    topFrequencies[0]?.values?.map((item) => ({ label: item.label, value: item.count })) ?? []
  const missingRows =
    charts?.missing_values?.map((item) => ({ label: item.label, value: item.value })) ?? []
  const totalMissingCells = missingRows.reduce((sum, row) => sum + Number(row.value || 0), 0)

  const rowsCount = activeProfile?.rows ?? 0
  const columnsCount = activeProfile?.columns_count ?? activeProfile?.columns?.length ?? 0
  const datasetSize = datasetMeta?.sizeBytes ?? 0
  let qualityScore = null
  if (rowsCount && columnsCount) {
    const totalCells = rowsCount * columnsCount
    qualityScore = Math.max(0, ((totalCells - totalMissingCells) / totalCells) * 100)
  }

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="surface-card empty-panel">
          <h1>No dataset connected</h1>
          <p>Open the Dataset page first, upload a source file, then return here to build the dashboard.</p>
          <Link to="/dataset" className="primary-button">
            Go to Dataset
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page-grid">
      <section className="dashboard-hero surface-card">
        <div className="dashboard-hero__copy">
          <p className="dashboard-hero__eyebrow">Good afternoon</p>
          <h1>Build dashboards that feel calm, clear, and decision-ready.</h1>
          <p>
            {fileName || 'Your dataset'} is connected. Use the builder to shape visuals, review trends,
            and export a shareable layout for stakeholders.
          </p>

          <div className="dashboard-hero__actions">
            <button
              type="button"
              className="primary-button"
              onClick={generateDashboard}
              disabled={busyAction === 'dashboarding'}
            >
              {busyAction === 'dashboarding' ? 'Refreshing...' : 'Refresh Layout'}
            </button>
            <span className="draft-chip">Autosaved draft</span>
          </div>
        </div>

        <div className="dashboard-hero__art" aria-hidden="true">
          <img src={heroGraphic} alt="" />
          <div className="dashboard-hero__badge">
            <strong>{activeProfile?.rows ?? 0}</strong>
            <span>Rows active</span>
          </div>
        </div>
      </section>

      <section className="dashboard-stats-grid">
        <article className="dashboard-stat-card">
          <span>ROWS</span>
          <strong>{formatValue(rowsCount)}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>COLUMNS</span>
          <strong>{formatValue(columnsCount)}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>SIZE</span>
          <strong>{formatBytes(datasetSize)}</strong>
        </article>
        <article className="dashboard-stat-card">
          <span>QUALITY</span>
          <strong>{qualityScore === null ? '-' : formatPercent(qualityScore, 0)}</strong>
        </article>
      </section>

      <section className="builder-toolbar">
        <div className="builder-toolbar__title">
          <h1>Dashboard Builder</h1>
          <p>{fileName || 'Untitled dataset'}</p>
        </div>

        <div className="builder-toolbar__actions">
          <span className="draft-chip">Draft - Autosaved</span>
          <button type="button" className="ghost-button">
            Preview
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={generateDashboard}
            disabled={busyAction === 'dashboarding'}
          >
            {busyAction === 'dashboarding' ? 'Refreshing...' : 'Save Layout'}
          </button>
        </div>
      </section>

      <section className="builder-layout">
        <aside className="surface-card builder-sidebar">
          <div className="card-header">
            <div>
              <h2>Components</h2>
              <p>Drag-ready building blocks</p>
            </div>
          </div>

          <div className="component-grid">
            {COMPONENTS.map((component) => (
              <button key={component} type="button" className="component-card">
                <span>{component.slice(0, 2).toUpperCase()}</span>
                <strong>{component}</strong>
              </button>
            ))}
          </div>
        </aside>

        <div className="surface-card builder-canvas">
          {charts ? (
            <div className="builder-grid">
              <BuilderLineWidget
                title={dimension ? `${measure || 'Metric'} by ${dimension}` : 'Trend Overview'}
                data={charts.trend_line?.data ?? []}
              />

              <BuilderMetricWidget
                title={numericSummary[0]?.column ?? 'Primary Metric'}
                value={numericSummary[0]?.max ?? activeProfile?.rows ?? 0}
                delta={metricDelta}
              />

              <BuilderDonutWidget
                title={charts.top_categories?.column ?? 'Top Categories'}
                data={charts.top_categories?.data ?? []}
              />

              <BuilderDonutWidget
                title={charts.numeric_distribution?.column ?? 'Distribution'}
                data={charts.numeric_distribution?.data ?? []}
              />

              <BuilderTableWidget
                title={topFrequencies[0]?.column ?? 'Frequent Values'}
                rows={frequencyRows}
              />

              <BuilderMetricWidget title="Missing Cells" value={totalMissingCells} delta={null} />
            </div>
          ) : (
            <div className="empty-panel">
              <h2>No dashboard widgets yet</h2>
              <p>Generate dashboard outputs to populate the builder canvas with charts and data widgets.</p>
              <button
                type="button"
                className="primary-button"
                onClick={generateDashboard}
                disabled={busyAction === 'dashboarding'}
              >
                {busyAction === 'dashboarding' ? 'Generating...' : 'Generate Dashboard'}
              </button>
            </div>
          )}
        </div>

        <aside className="surface-card builder-config">
          <div className="card-header">
            <div>
              <h2>Configuration</h2>
              <p>Widget mapping and layout controls</p>
            </div>
          </div>

          <div className="config-group">
            <label htmlFor="widget-title">Widget Title</label>
            <input id="widget-title" type="text" value="New Line Chart" readOnly />
          </div>

          <div className="config-group">
            <label htmlFor="data-source">Data Source</label>
            <select id="data-source" value={fileName || 'dataset'} disabled>
              <option>{fileName || 'Dataset'}</option>
            </select>
          </div>

          <div className="config-group">
            <label htmlFor="dimension-select">X-Axis (Dimension)</label>
            <select
              id="dimension-select"
              value={dimension}
              onChange={(event) => setDimension(event.target.value)}
            >
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </div>

          <div className="config-group">
            <label htmlFor="measure-select">Y-Axis (Measure)</label>
            <select
              id="measure-select"
              value={measure}
              onChange={(event) => setMeasure(event.target.value)}
            >
              {numericSummary.map((item) => (
                <option key={item.column} value={item.column}>
                  {item.column}
                </option>
              ))}
            </select>
          </div>

          <div className="config-group">
            <label htmlFor="layout-width">Width (Span)</label>
            <select id="layout-width" defaultValue="2 Columns">
              <option>1 Column</option>
              <option>2 Columns</option>
              <option>3 Columns</option>
            </select>
          </div>

          <div className="config-group">
            <label htmlFor="layout-height">Height (Span)</label>
            <select id="layout-height" defaultValue="2 Rows">
              <option>1 Row</option>
              <option>2 Rows</option>
              <option>3 Rows</option>
            </select>
          </div>
        </aside>
      </section>
    </div>
  )
}

export default DashboardPage
