import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { buildQualityReport } from '../utils/dataQuality'
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

function getCorrelationPairs(correlationMatrix = []) {
  const seenPairs = new Set()
  const pairs = []

  for (const row of correlationMatrix) {
    for (const [target, score] of Object.entries(row.correlations ?? {})) {
      const numericScore = Number(score)
      if (!Number.isFinite(numericScore)) {
        continue
      }

      const pairKey = [row.column, target].sort().join('::')
      if (seenPairs.has(pairKey)) {
        continue
      }

      seenPairs.add(pairKey)
      pairs.push({ source: row.column, target, score: numericScore })
    }
  }

  return pairs.sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
}

function AnalysisMetric({ label, value, hint }) {
  return (
    <article className="analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
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
    uploadedDataset,
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
  const correlationPairs = getCorrelationPairs(analysis?.correlation_matrix ?? [])
  const trendDelta = getTrendDelta(charts?.trend_line?.data ?? [])
  const activeProfile = cleanedProfile ?? rawProfile
  const activeColumnProfiles = activeProfile?.column_profiles ?? []
  const missingTotal = totalMissing(activeColumnProfiles)
  const qualityReport = buildQualityReport(activeProfile, uploadedDataset.rows)
  const bestCategory = topFrequencies[0]?.values?.[0]
  const chartCount = charts?.chart_configs?.length ?? charts?.charts?.length ?? 0
  const cleaningSteps = cleaningSummary?.cleaning_steps ?? []
  const recommendations = [
    missingTotal > 0
      ? `Review ${formatValue(missingTotal)} remaining missing cells before final reporting.`
      : 'Dataset completeness is strong after the current cleaning stage.',
    cleaningSummary?.duplicates_removed > 0
      ? `${formatValue(cleaningSummary.duplicates_removed)} duplicate row(s) were removed, reducing possible double counting.`
      : 'No exact duplicate removal impact is currently recorded.',
    strongestCorrelation
      ? `Use ${strongestCorrelation.source} and ${strongestCorrelation.target} together when explaining numeric behavior.`
      : 'Add or clean more numeric fields to unlock stronger relationship analysis.',
    chartCount > 0
      ? `${formatValue(chartCount)} dashboard chart configuration(s) are ready for visual validation.`
      : 'Generate visualizations after analysis to validate the patterns on charts.',
  ]

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

      <section className="analysis-metric-grid">
        <AnalysisMetric
          label="Quality Score"
          value={formatPercent(qualityReport.score, 1)}
          hint={`${qualityReport.missingCells} missing cells`}
        />
        <AnalysisMetric
          label="Numeric Fields"
          value={numericSummary.length}
          hint="Columns with statistics"
        />
        <AnalysisMetric
          label="Category Fields"
          value={topFrequencies.length}
          hint="Columns with frequent values"
        />
        <AnalysisMetric
          label="Relationships"
          value={correlationPairs.length}
          hint="Numeric pair checks"
        />
      </section>

      <section className="analysis-detail-grid">
        <article className="surface-card analysis-panel analysis-panel--wide">
          <div className="card-header">
            <div>
              <h2>Numeric Summary</h2>
              <p>Mean, median, range, and spread for measurable columns.</p>
            </div>
          </div>

          {numericSummary.length > 0 ? (
            <div className="analysis-table-wrap">
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Std Dev</th>
                  </tr>
                </thead>
                <tbody>
                  {numericSummary.map((stat) => (
                    <tr key={`numeric-${stat.column}`}>
                      <td>
                        <strong>{stat.column}</strong>
                      </td>
                      <td>{formatValue(stat.mean)}</td>
                      <td>{formatValue(stat.median)}</td>
                      <td>{formatValue(stat.min)}</td>
                      <td>{formatValue(stat.max)}</td>
                      <td>{formatValue(stat.std)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state-inline">No numeric columns are available for summary statistics.</p>
          )}
        </article>

        <article className="surface-card analysis-panel">
          <div className="card-header">
            <div>
              <h2>Decision Notes</h2>
              <p>Recommended talking points for defense and reporting.</p>
            </div>
          </div>

          <div className="analysis-recommendation-list">
            {recommendations.map((recommendation) => (
              <div key={recommendation}>{recommendation}</div>
            ))}
          </div>
        </article>

        <article className="surface-card analysis-panel">
          <div className="card-header">
            <div>
              <h2>Most Frequent Values</h2>
              <p>Dominant categories found in the active dataset.</p>
            </div>
          </div>

          {topFrequencies.length > 0 ? (
            <div className="frequency-column-list">
              {topFrequencies.map((column) => (
                <section key={`freq-${column.column}`} className="frequency-column">
                  <h3>{column.column}</h3>
                  {(column.values ?? []).slice(0, 5).map((item) => (
                    <div key={`${column.column}-${item.label}`} className="frequency-row">
                      <span>{item.label}</span>
                      <strong>{formatValue(item.count)}</strong>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <p className="empty-state-inline">No categorical frequency output is available yet.</p>
          )}
        </article>

        <article className="surface-card analysis-panel">
          <div className="card-header">
            <div>
              <h2>Correlation Check</h2>
              <p>Top numeric relationships ranked by absolute score.</p>
            </div>
          </div>

          {correlationPairs.length > 0 ? (
            <div className="correlation-list">
              {correlationPairs.slice(0, 6).map((pair) => (
                <div key={`${pair.source}-${pair.target}`} className="correlation-row">
                  <span>
                    {pair.source} / {pair.target}
                  </span>
                  <strong>{pair.score.toFixed(2)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state-inline">Correlation analysis needs at least two numeric columns.</p>
          )}
        </article>

        <article className="surface-card analysis-panel">
          <div className="card-header">
            <div>
              <h2>Cleaning Impact</h2>
              <p>How preprocessing affected this analysis stage.</p>
            </div>
          </div>

          {cleaningSummary ? (
            <div className="analysis-impact-list">
              <div>
                <span>Rows</span>
                <strong>
                  {formatValue(cleaningSummary.rows_before)} to {formatValue(cleaningSummary.rows_after)}
                </strong>
              </div>
              <div>
                <span>Missing Cells</span>
                <strong>
                  {formatValue(cleaningSummary.missing_values_before)} to{' '}
                  {formatValue(cleaningSummary.missing_values_after)}
                </strong>
              </div>
              <div>
                <span>Duplicates Removed</span>
                <strong>{formatValue(cleaningSummary.duplicates_removed ?? 0)}</strong>
              </div>
              <div>
                <span>Rules Applied</span>
                <strong>{cleaningSteps.filter((step) => step.enabled).length}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state-inline">Run the cleaning step to show preprocessing impact here.</p>
          )}
        </article>
      </section>
    </div>
  )
}

export default AnalysisPage
