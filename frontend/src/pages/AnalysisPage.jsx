import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatPercent, formatValue, totalMissing } from '../utils/formatters'

function getStrongestCorrelation(correlationMatrix = []) {
  let strongest = null

  for (const row of correlationMatrix) {
    for (const [target, score] of Object.entries(row.correlations ?? {})) {
      const numericScore = Number(score)
      if (!Number.isFinite(numericScore)) {
        continue
      }

      if (!strongest || Math.abs(numericScore) > Math.abs(strongest.score)) {
        strongest = { source: row.column, target, score: numericScore }
      }
    }
  }

  return strongest
}

function getTrendDelta(data = []) {
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

function InsightCard({ title, body, action, tone = 'default', meta }) {
  return (
    <article className={`insight-card insight-card--${tone}`}>
      <div className="insight-card__header">
        <h3>{title}</h3>
      </div>
      <p>{body}</p>
      {meta ? <div className="insight-card__meta">{meta}</div> : null}
      {action ? <span className="insight-card__action">{action}</span> : null}
    </article>
  )
}

function AnalysisPage() {
  const {
    datasetId,
    fileName,
    rawProfile,
    cleanedProfile,
    cleaningSummary,
    analysis,
    charts,
  } = useAtlas()

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="surface-card empty-panel">
          <h1>No analysis context yet</h1>
          <p>Upload a dataset first so ATLAS can generate profiling, trends, and simple interpretations.</p>
          <Link to="/dataset" className="primary-button">
            Go to Dataset
          </Link>
        </section>
      </div>
    )
  }

  const numericSummary = analysis?.numeric_summary ?? []
  const topFrequencies = analysis?.top_frequencies ?? []
  const strongestCorrelation = getStrongestCorrelation(analysis?.correlation_matrix ?? [])
  const trendDelta = getTrendDelta(charts?.trend_line?.data ?? [])
  const missingTotal = totalMissing((cleanedProfile ?? rawProfile)?.column_profiles ?? [])
  const bestCategory = topFrequencies[0]?.values?.[0]

  const executiveSummary = strongestCorrelation
    ? `ATLAS found the strongest relationship between ${strongestCorrelation.source} and ${strongestCorrelation.target}, with a correlation score of ${strongestCorrelation.score.toFixed(2)}.`
    : 'ATLAS is ready to interpret the dataset, but stronger relationships will appear once more numeric measures are available.'

  return (
    <div className="page-grid">
      <section className="page-header">
        <div>
          <h1>Automated Insights</h1>
          <p>AI-inspired interpretations for {fileName || 'your active dataset'}.</p>
        </div>

        <div className="page-header__actions">
          <span className="status-badge status-badge--success">Live Analysis Active</span>
        </div>
      </section>

      <section className="insight-hero">
        <article className="surface-card insight-summary-card">
          <div className="card-header">
            <div>
              <h2>Executive Summary</h2>
              <p>Simple interpretations generated from profiling, cleaning, and statistical outputs.</p>
            </div>
          </div>

          <p className="insight-summary-card__body">
            {executiveSummary}{' '}
            {bestCategory
              ? `${bestCategory.label} is the most frequent value in ${topFrequencies[0]?.column}, making it the dominant categorical segment in the current dataset.`
              : 'Frequent-value analysis will appear once categorical groups are available.'}{' '}
            {missingTotal > 0
              ? `Data quality still shows ${formatValue(missingTotal)} missing cells, so interpretation should be read with that context in mind.`
              : 'No major data quality gaps remain after cleaning.'}
          </p>

          <div className="change-pill-row">
            <span className="change-pill">
              {trendDelta !== null
                ? `${trendDelta >= 0 ? 'Positive' : 'Negative'} trend detected`
                : 'Trend still stabilizing'}
            </span>
            <span className="change-pill">
              {strongestCorrelation
                ? `Strong correlation: ${strongestCorrelation.score.toFixed(2)}`
                : 'No strong numeric correlation yet'}
            </span>
            <span className="change-pill">
              Clean step: {cleanedProfile ? 'Applied' : 'Raw dataset in use'}
            </span>
          </div>
        </article>

        <aside className="surface-card impact-card">
          <span>Key Metric Impact</span>
          <strong>{trendDelta !== null ? formatPercent(trendDelta, 1) : 'N/A'}</strong>
          <p>
            {trendDelta !== null
              ? 'Relative change across the current trend window in the lead metric.'
              : 'Upload or clean more data to unlock stronger trend interpretation.'}
          </p>
        </aside>
      </section>

      <section className="insight-grid">
        <InsightCard
          title="Growth Opportunity"
          tone="success"
          body={
            numericSummary[0]
              ? `${numericSummary[0].column} shows a mean of ${formatValue(
                  numericSummary[0].mean,
                )} and a max value of ${formatValue(
                  numericSummary[0].max,
                )}, suggesting room to monitor high-performing segments more closely.`
              : 'Generate numeric summaries to reveal possible growth opportunities.'
          }
          action="Explore Correlation"
        />

        <InsightCard
          title="Detected Anomalies"
          tone="warning"
          body={
            missingTotal > 0
              ? `ATLAS found ${formatValue(missingTotal)} missing cells across the current dataset stage. Prioritize sparse columns before publishing final outputs.`
              : 'No obvious missing-value anomaly remains in the active dataset stage.'
          }
          meta={
            cleaningSummary
              ? `Duplicates removed: ${cleaningSummary.duplicates_removed ?? 0} - Invalid rows filtered: ${cleaningSummary.invalid_rows_removed ?? 0}`
              : 'Review cleaning outputs after running the cleaning step.'
          }
          action="Review Data Quality"
        />

        <InsightCard
          title="Most Frequent Values"
          tone="default"
          body={
            bestCategory
              ? `${bestCategory.label} is currently the most frequent value in ${topFrequencies[0]?.column}, with a count of ${formatValue(
                  bestCategory.count,
                )}.`
              : 'Frequent-value insights will appear when categorical groups are detected.'
          }
          action="Inspect Categories"
        />

        <InsightCard
          title="Trends or Patterns"
          tone="accent"
          body={
            charts?.trend_line?.data?.length > 1
              ? `The trend line for ${charts.trend_line.y_label} across ${charts.trend_line.x_label} shows a ${
                  trendDelta !== null && trendDelta >= 0 ? 'positive' : 'mixed'
                } directional pattern.`
              : 'Trend interpretation becomes available when sequential numeric points exist.'
          }
          meta={
            charts?.trend_line?.data?.length > 0
              ? `Tracked points: ${charts.trend_line.data.length}`
              : 'No time or sequence-based pattern available yet.'
          }
          action="Open Dashboard Builder"
        />
      </section>
    </div>
  )
}

export default AnalysisPage
