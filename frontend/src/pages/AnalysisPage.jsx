import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CompactWorkspaceBar } from '../components/CompactUI'
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

function describeCorrelation(score) {
  const absoluteScore = Math.abs(Number(score) || 0)
  const strength = absoluteScore >= 0.75 ? 'strong' : absoluteScore >= 0.45 ? 'moderate' : 'light'
  const direction = score >= 0 ? 'positive' : 'negative'

  return `${strength} ${direction}`
}

function describeChange(before, after, label) {
  const beforeValue = Number(before ?? 0)
  const afterValue = Number(after ?? 0)
  const difference = afterValue - beforeValue

  if (difference === 0) {
    return `${label} stayed at ${formatValue(afterValue)}.`
  }

  return `${label} ${difference > 0 ? 'increased' : 'decreased'} by ${formatValue(
    Math.abs(difference),
  )}, from ${formatValue(beforeValue)} to ${formatValue(afterValue)}.`
}

function formatMetricNumber(value, digits = 2) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return '-'
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
  }).format(numericValue)
}

function formatShare(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return ''
  }

  return `${(numericValue * 100).toFixed(1)}%`
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

const AI_INSIGHT_SECTIONS = [
  { key: 'key_insights', title: 'Key Insights' },
  { key: 'trends', title: 'Trends' },
  { key: 'data_quality_notes', title: 'Data Quality Notes' },
  { key: 'simple_recommendations', title: 'Simple Recommendations' },
]

const ANALYSIS_TABS = [
  { key: 'ai', label: 'AI Insights' },
  { key: 'system', label: 'System Analysis' },
]

function normalizeAiItems(items) {
  if (!Array.isArray(items)) {
    return []
  }

  return items.map((item) => cleanAiInsightText(item)).filter(Boolean)
}

function parseJsonishText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  if (!cleaned) {
    return null
  }

  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) {
      return null
    }

    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function cleanAiInsightText(item) {
  return String(item ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
    .replace(/^[,:\]}\s"]+|[,:\]}\s"]+$/g, '')
    .trim()
}

function hasAiSectionItems(sections) {
  return AI_INSIGHT_SECTIONS.some(({ key }) => sections[key]?.length > 0)
}

function emptyAiSections() {
  return Object.fromEntries(AI_INSIGHT_SECTIONS.map(({ key }) => [key, []]))
}

function getDirectAiSections(source) {
  return Object.fromEntries(
    AI_INSIGHT_SECTIONS.map(({ key }) => [key, normalizeAiItems(source?.[key])]),
  )
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, ' ')
  }
}

function getInsightSectionMarkers(text) {
  const markers = []

  for (const { key, title } of AI_INSIGHT_SECTIONS) {
    const aliases = [key, title]

    for (const alias of aliases) {
      const aliasPattern = alias
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[_\s-]+/g, '[_\\s-]+')
      const regex = new RegExp(`["']?${aliasPattern}["']?\\s*:\\s*\\[`, 'i')
      const match = regex.exec(text)

      if (match) {
        markers.push({ key, index: match.index, contentStart: match.index + match[0].length })
        break
      }
    }
  }

  return markers.sort((left, right) => left.index - right.index)
}

function extractQuotedItems(segment) {
  const items = []
  const quotedPattern = /"((?:\\.|[^"\\])*)"/g
  let match = quotedPattern.exec(segment)

  while (match) {
    const item = cleanAiInsightText(decodeJsonString(match[1]))
    if (item) {
      items.push(item)
    }
    match = quotedPattern.exec(segment)
  }

  if (items.length > 0) {
    return items
  }

  const firstQuoteIndex = segment.indexOf('"')
  const fallback = firstQuoteIndex >= 0 ? segment.slice(firstQuoteIndex + 1) : segment
  const item = cleanAiInsightText(fallback)
  return item ? [item] : []
}

function extractAiSectionsFromJsonLikeText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  if (!cleaned || !cleaned.includes('{')) {
    return null
  }

  const parsed = parseJsonishText(cleaned)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const parsedSections = getDirectAiSections(parsed)
    if (hasAiSectionItems(parsedSections)) {
      return parsedSections
    }
  }

  const markers = getInsightSectionMarkers(cleaned)
  if (markers.length === 0) {
    return null
  }

  const sections = emptyAiSections()
  markers.forEach((marker, index) => {
    const nextMarker = markers[index + 1]
    const segment = cleaned.slice(marker.contentStart, nextMarker?.index ?? cleaned.length)
    sections[marker.key] = extractQuotedItems(segment)
  })

  return hasAiSectionItems(sections) ? sections : null
}

function mergeAiSections(primary, secondary) {
  return Object.fromEntries(
    AI_INSIGHT_SECTIONS.map(({ key }) => [
      key,
      [...(primary?.[key] ?? []), ...(secondary?.[key] ?? [])],
    ]),
  )
}

function isJsonLikeInsightWrapper(text) {
  const cleaned = String(text || '').trim()
  return cleaned.startsWith('{') && /key[_\s-]*insights|data[_\s-]*quality|recommendations|trends/i.test(cleaned)
}

function normalizeAiInsights(insights) {
  if (!insights || typeof insights !== 'object') {
    return null
  }

  const normalized = getDirectAiSections(insights)
  let retained = emptyAiSections()
  let nestedSections = emptyAiSections()
  let foundNestedSections = false

  for (const { key } of AI_INSIGHT_SECTIONS) {
    for (const item of normalized[key]) {
      const extractedSections = extractAiSectionsFromJsonLikeText(item)

      if (extractedSections) {
        nestedSections = mergeAiSections(nestedSections, extractedSections)
        foundNestedSections = true
        continue
      }

      if (!isJsonLikeInsightWrapper(item)) {
        retained[key].push(item)
      }
    }
  }

  return foundNestedSections ? mergeAiSections(retained, nestedSections) : normalized
}

function normalizeAiErrorMessage(message) {
  return String(message || '').replaceAll(/Gemini/gi, 'AI')
}

function AiInsightSection({ title, items }) {
  const normalizedItems = normalizeAiItems(items)

  return (
    <article className="surface-card ai-insight-section">
      <h3>{title}</h3>
      {normalizedItems.length > 0 ? (
        <div className="ai-insight-copy-list">
          {normalizedItems.map((item, index) => (
            <p key={`${title}-${index}-${item.slice(0, 24)}`}>{item}</p>
          ))}
        </div>
      ) : (
        <p className="empty-state-inline">No generated notes yet.</p>
      )}
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
    generateAiInsights,
    markWorkflowStep,
  } = useAtlas()
  const [aiInsightsPayload, setAiInsightsPayload] = useState(null)
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false)
  const [aiInsightsError, setAiInsightsError] = useState({ contextKey: '', message: '' })
  const [activeAnalysisTab, setActiveAnalysisTab] = useState('ai')
  const aiContextKey = [
    datasetId,
    cleanedProfile ? 'cleaned' : 'raw',
    rawProfile?.rows ?? 0,
    cleanedProfile?.rows ?? 0,
    cleaningSummary?.duplicates_removed ?? 0,
    cleaningSummary?.missing_values_after ?? 0,
  ].join(':')
  const currentAiPayload = aiInsightsPayload?.contextKey === aiContextKey ? aiInsightsPayload.payload : null
  const currentAiError = aiInsightsError.contextKey === aiContextKey ? aiInsightsError.message : ''

  useEffect(() => {
    if (datasetId && cleanedProfile) {
      markWorkflowStep('analyzed')
    }
  }, [cleanedProfile, datasetId, markWorkflowStep])

  async function handleGenerateAiInsights() {
    if (!datasetId || aiInsightsLoading) {
      return
    }

    setAiInsightsLoading(true)
    setAiInsightsError({ contextKey: aiContextKey, message: '' })

    try {
      const payload = await generateAiInsights({ stage: 'latest', refresh: true })
      setAiInsightsPayload({ contextKey: aiContextKey, payload })
    } catch (error) {
      setAiInsightsError({
        contextKey: aiContextKey,
        message: normalizeAiErrorMessage(
          error.message ||
            'AI insights are unavailable right now. You can still use the built-in decision notes below.',
        ),
      })
    } finally {
      setAiInsightsLoading(false)
    }
  }

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="surface-card empty-panel" data-tour="ai-insights">
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
  const relationshipInsights = analysis?.relationship_insights ?? []
  const segmentBreakdowns = analysis?.segment_breakdowns ?? []
  const smartInsights = analysis?.smart_insights ?? []
  const excludedNumericIdentifiers = analysis?.excluded_numeric_identifiers ?? []
  const primaryMeasure = analysis?.primary_measure
  const trendDelta = getTrendDelta(charts?.trend_line?.data ?? [])
  const activeProfile = cleanedProfile ?? rawProfile
  const activeColumnProfiles = activeProfile?.column_profiles ?? []
  const missingTotal = totalMissing(activeColumnProfiles)
  const qualityReport = buildQualityReport(activeProfile, uploadedDataset.rows)
  const bestCategory = topFrequencies[0]?.values?.[0]
  const leadBreakdown = segmentBreakdowns[0]
  const leadSegment = leadBreakdown?.leaders?.[0]
  const chartCount = charts?.chart_configs?.length ?? charts?.charts?.length ?? 0
  const cleaningSteps = cleaningSummary?.cleaning_steps ?? []
  const aiInsights = normalizeAiInsights(currentAiPayload?.insights)
  const hasAiInsights = AI_INSIGHT_SECTIONS.some(({ key }) => normalizeAiItems(aiInsights?.[key]).length > 0)
  const relationshipRows = relationshipInsights.length > 0
    ? relationshipInsights
    : correlationPairs.map((pair) => ({
        ...pair,
        interpretation: `${pair.source} and ${pair.target} have a ${describeCorrelation(pair.score)} relationship.`,
      }))
  const recommendations = [
    ...smartInsights.slice(0, 3).map((insight) => insight.detail),
    missingTotal > 0
      ? `Review ${formatValue(missingTotal)} remaining missing cells before final reporting.`
      : 'Dataset completeness is strong after the current cleaning stage.',
    cleaningSummary?.duplicates_removed > 0
      ? `${formatValue(cleaningSummary.duplicates_removed)} duplicate row(s) were removed, reducing possible double counting.`
      : 'No exact duplicate removal impact is currently recorded.',
    relationshipRows[0]
      ? relationshipRows[0].interpretation
      : null,
    excludedNumericIdentifiers.length > 0
      ? `${excludedNumericIdentifiers.join(', ')} are excluded from relationship checks because they behave like identifiers.`
      : null,
    chartCount > 0
      ? `${formatValue(chartCount)} dashboard chart configuration(s) are ready for visual validation.`
      : 'Generate visualizations after analysis to validate the patterns on charts.',
  ].filter(Boolean)

  const executiveSummaryParts = [
    leadSegment
      ? `${leadSegment.label} is the leading ${leadBreakdown.column} segment for ${leadBreakdown.measure}, contributing ${formatMetricNumber(
          leadSegment.value,
        )}${leadSegment.share ? ` or ${formatShare(leadSegment.share)} of the measured total` : ''}.`
      : null,
    strongestCorrelation
      ? `Use ${strongestCorrelation.source} and ${strongestCorrelation.target} together when explaining numeric behavior.`
      : null,
    strongestCorrelation
      ? `${strongestCorrelation.source} and ${strongestCorrelation.target} move together with a ${describeCorrelation(
          strongestCorrelation.score,
        )} relationship.`
      : 'ATLAS can interpret the dataset, but stronger relationship notes need at least two useful numeric measures.',
    missingTotal > 0
      ? `Data quality still shows ${formatValue(missingTotal)} missing cell(s), so interpretation should be read with that context in mind.`
      : 'The active dataset has no remaining missing cells after the current cleaning stage.',
  ].filter(Boolean)
  const executiveSummary = executiveSummaryParts.join(' ')

  return (
    <div className="page-grid">
      <CompactWorkspaceBar
        title="Analyze"
        datasetName={fileName || 'your active dataset'}
        status={currentAiPayload?.cached ? 'Cached' : 'Live Analysis Active'}
        actions={(
          <button
            type="button"
            className="primary-button"
            onClick={handleGenerateAiInsights}
            disabled={aiInsightsLoading}
            data-tour="generate-ai-insights"
          >
            {aiInsightsLoading ? 'Generating...' : 'Generate AI Insights'}
          </button>
        )}
      >
        <div className="analysis-view-tabs analysis-view-tabs--compact" role="tablist" aria-label="Analysis views">
          {ANALYSIS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              id={`analysis-tab-${tab.key}`}
              className={`analysis-view-tab${activeAnalysisTab === tab.key ? ' analysis-view-tab--active' : ''}`}
              role="tab"
              aria-selected={activeAnalysisTab === tab.key}
              aria-controls={`analysis-panel-${tab.key}`}
              onClick={() => setActiveAnalysisTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </CompactWorkspaceBar>

      {activeAnalysisTab === 'ai' ? (
        <section
          id="analysis-panel-ai"
          className="analysis-tab-panel"
          role="tabpanel"
          aria-labelledby="analysis-tab-ai"
        >
          <section className="ai-insights-panel" aria-busy={aiInsightsLoading} data-tour="ai-insights">
            <div className="surface-card ai-insights-control">
              <div>
                <h2>AI Insights</h2>
                <p>Generated from computed dataset summaries.</p>
              </div>

              <div className="ai-insights-actions">
                {currentAiPayload?.cached ? <span className="status-badge">Cached</span> : null}
              </div>
            </div>

            {currentAiError ? (
              <div className="error-banner ai-insights-error">
                {currentAiError} System Analysis remains available in the other tab.
              </div>
            ) : null}

            {hasAiInsights ? (
              <div className="ai-insights-grid">
                {AI_INSIGHT_SECTIONS.map((section) => (
                  <AiInsightSection
                    key={section.key}
                    title={section.title}
                    items={aiInsights?.[section.key]}
                  />
                ))}
              </div>
            ) : (
              <p className="empty-state-inline ai-insights-empty">
                Generate AI insights when you want a plain-language readout for this dataset.
              </p>
            )}
          </section>
        </section>
      ) : (
        <section
          id="analysis-panel-system"
          className="analysis-tab-panel analysis-tab-panel--system"
          role="tabpanel"
          aria-labelledby="analysis-tab-system"
        >
          <section className="insight-hero">
            <article className="surface-card insight-summary-card">
              <div className="card-header">
                <div>
                  <h2>Executive Summary</h2>
                  <p>Simple interpretations generated from profiling, cleaning, and statistical outputs.</p>
                </div>
              </div>

              <p className="insight-summary-card__body">
                {executiveSummary}
              </p>

              <div className="change-pill-row">
                <span className="change-pill">
                  {trendDelta !== null
                    ? `${trendDelta >= 0 ? 'Positive' : 'Negative'} trend detected`
                    : 'Trend still stabilizing'}
                </span>
                <span className="change-pill">
                  {strongestCorrelation
                    ? `${describeCorrelation(strongestCorrelation.score)} correlation: ${strongestCorrelation.score.toFixed(2)}`
                    : 'No strong numeric correlation yet'}
                </span>
                <span className="change-pill">
                  Primary metric: {primaryMeasure || 'Not selected'}
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
              value={relationshipRows.length}
              hint="Numeric pair checks"
            />
          </section>

          <section className="analysis-detail-grid">
            <div className="analysis-detail-column">
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
                    <h2>Smart Signals</h2>
                    <p>Priority notes generated from quality, drivers, relationships, and risk checks.</p>
                  </div>
                </div>

                {smartInsights.length > 0 ? (
                  <div className="smart-signal-list">
                    {smartInsights.map((insight) => (
                      <div key={`${insight.title}-${insight.detail}`} className={`smart-signal smart-signal--${insight.priority || 'medium'}`}>
                        <span>{insight.priority || 'note'}</span>
                        <strong>{insight.title}</strong>
                        <p>{insight.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No system signals are available for this dataset yet.</p>
                )}
              </article>

              <article className="surface-card analysis-panel">
                <div className="card-header">
                  <div>
                    <h2>Correlation Check</h2>
                    <p>Readable relationship notes between numeric fields.</p>
                  </div>
                </div>

                {relationshipRows.length > 0 ? (
                  <div className="correlation-list">
                    {relationshipRows.slice(0, 4).map((pair) => (
                      <div key={`${pair.source}-${pair.target}`} className="correlation-row">
                        <span>{pair.interpretation}</span>
                        <strong>{Number(pair.score).toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">Correlation analysis needs at least two non-identifier numeric columns.</p>
                )}
              </article>
            </div>

            <div className="analysis-detail-column">
              <article className="surface-card analysis-panel">
                <div className="card-header">
                  <div>
                    <h2>Segment Drivers</h2>
                    <p>Which groups contribute most to the primary measure.</p>
                  </div>
                </div>

                {segmentBreakdowns.length > 0 ? (
                  <div className="segment-driver-list">
                    {segmentBreakdowns.slice(0, 4).map((breakdown) => (
                      <section key={`segment-${breakdown.column}`} className="segment-driver-card">
                        <h3>{breakdown.measure} by {breakdown.column}</h3>
                        {(breakdown.leaders ?? []).slice(0, 4).map((leader) => (
                          <div key={`${breakdown.column}-${leader.label}`} className="segment-leader-row">
                            <span>{leader.label}</span>
                            <strong>{formatMetricNumber(leader.value)}</strong>
                            {leader.share ? <em>{formatShare(leader.share)}</em> : null}
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No segment driver breakdown is available yet.</p>
                )}
              </article>

              <article className="surface-card analysis-panel">
                <div className="card-header">
                  <div>
                    <h2>Most Frequent Values</h2>
                    <p>Plain-language category patterns from the active dataset.</p>
                  </div>
                </div>

                {topFrequencies.length > 0 ? (
                  <div className="frequency-column-list">
                    {topFrequencies.map((column) => {
                      const values = column.values ?? []
                      const topValue = values[0]
                      const otherValues = values.slice(1, 4).map((item) => item.label).join(', ')

                      return (
                        <section key={`freq-${column.column}`} className="frequency-column">
                          <h3>{column.column}</h3>
                          <p>
                            {topValue
                              ? `${topValue.label} appears most often, showing up in ${formatValue(
                                  topValue.count,
                                )} row(s)${column.top_share ? ` (${formatShare(column.top_share)} share)` : ''}.`
                              : 'No clear top value was detected.'}
                          </p>
                          {otherValues ? <small>Other common values: {otherValues}</small> : null}
                        </section>
                      )
                    })}
                  </div>
                ) : (
                  <p className="empty-state-inline">No categorical frequency output is available yet.</p>
                )}
              </article>

              <article className="surface-card analysis-panel">
                <div className="card-header">
                  <div>
                    <h2>Numeric Field Intelligence</h2>
                    <p>Measure behavior, missing values, and possible outliers.</p>
                  </div>
                </div>

                {numericSummary.length > 0 ? (
                  <div className="numeric-intelligence-list">
                    {numericSummary.slice(0, 5).map((summary) => (
                      <section key={`numeric-${summary.column}`} className="numeric-intelligence-card">
                        <h3>{summary.column}</h3>
                        <div>
                          <span>Total</span>
                          <strong>{formatMetricNumber(summary.sum)}</strong>
                        </div>
                        <div>
                          <span>Average</span>
                          <strong>{formatMetricNumber(summary.mean)}</strong>
                        </div>
                        <p>
                          {summary.outlier_count > 0
                            ? `${summary.outlier_count} possible outlier value(s) need review.`
                            : 'No statistical outlier was detected by the current rule.'}
                        </p>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No non-identifier numeric measures are available yet.</p>
                )}
              </article>

              <article className="surface-card analysis-panel">
                <div className="card-header">
                  <div>
                    <h2>Cleaning Impact</h2>
                    <p>What changed after preprocessing.</p>
                  </div>
                </div>

                {cleaningSummary ? (
                  <div className="analysis-impact-list">
                    <div>
                      <span>{describeChange(cleaningSummary.rows_before, cleaningSummary.rows_after, 'Rows')}</span>
                    </div>
                    <div>
                      <span>
                        {describeChange(
                          cleaningSummary.missing_values_before,
                          cleaningSummary.missing_values_after,
                          'Missing cells',
                        )}
                      </span>
                    </div>
                    <div>
                      <span>
                        {cleaningSummary.duplicates_removed
                          ? `${formatValue(cleaningSummary.duplicates_removed)} duplicate row(s) were removed.`
                          : 'No exact duplicate rows were removed.'}
                      </span>
                    </div>
                    <div>
                      <span>
                        {cleaningSteps.filter((step) => step.enabled).length} cleaning rule(s) contributed to the final dataset.
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="empty-state-inline">Run the cleaning step to show preprocessing impact here.</p>
                )}
              </article>
            </div>
          </section>
        </section>
      )}
    </div>
  )
}

export default AnalysisPage
