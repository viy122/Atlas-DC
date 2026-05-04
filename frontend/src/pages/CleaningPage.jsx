import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import ComparisonTable from '../components/ComparisonTable'
import { useAtlas } from '../context/AtlasContext'
import { buildCleaningRecommendations, buildQualityReport } from '../utils/dataQuality'
import { formatPercent } from '../utils/formatters'

const DEFAULT_CLEANING_OPTIONS = {
  normalize_placeholder_nulls: true,
  standardize_text: true,
  convert_datetime_columns: true,
  convert_numeric_columns: true,
  validate_emails: true,
  validate_numeric_ranges: true,
  validate_future_dates: true,
  drop_all_null_rows: true,
  remove_duplicates: true,
  flag_duplicate_keys: true,
  flag_required_missing: true,
  drop_critical_missing: true,
  fill_numeric_missing: true,
  fill_datetime_missing: true,
  fill_text_with_mode: false,
}

const CLEANING_OPTIONS = [
  {
    key: 'normalize_placeholder_nulls',
    title: 'Normalize null placeholders',
    description: 'Turn blanks, NA, null, unknown, and dash values into missing cells.',
  },
  {
    key: 'standardize_text',
    title: 'Standardize text',
    description: 'Trim spacing and normalize name or label casing for cleaner grouping.',
  },
  {
    key: 'convert_datetime_columns',
    title: 'Convert date columns',
    description: 'Parse trusted date-like fields so trend charts and date filters work.',
  },
  {
    key: 'convert_numeric_columns',
    title: 'Convert numeric text',
    description: 'Parse values like currency and comma-formatted numbers into measures.',
  },
  {
    key: 'fill_numeric_missing',
    title: 'Fill numeric missing values',
    description: 'Use mean or median depending on skew and outliers.',
  },
  {
    key: 'fill_text_with_mode',
    title: 'Fill text with mode',
    description: 'Optional: replace missing text with the most frequent value.',
  },
  {
    key: 'remove_duplicates',
    title: 'Remove duplicate rows',
    description: 'Delete only exact duplicate records to avoid double counting.',
  },
  {
    key: 'drop_critical_missing',
    title: 'Drop missing IDs/emails',
    description: 'Remove rows missing critical identifier columns.',
  },
  {
    key: 'flag_duplicate_keys',
    title: 'Flag duplicate keys',
    description: 'Keep possible duplicate IDs/emails but mark them for review.',
  },
  {
    key: 'validate_emails',
    title: 'Validate emails',
    description: 'Nullify invalid email formats instead of guessing corrections.',
  },
  {
    key: 'validate_numeric_ranges',
    title: 'Validate numeric ranges',
    description: 'Apply configured rules such as age must not be negative.',
  },
  {
    key: 'validate_future_dates',
    title: 'Validate future dates',
    description: 'Flag future birthdate-style values as invalid.',
  },
]

function parseKeywordList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function CleaningMetric({ label, value, hint }) {
  return (
    <article className="cleaning-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function CleaningOptionToggle({ option, checked, onChange }) {
  return (
    <label className="cleaning-option-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(option.key, event.target.checked)}
      />
      <span>
        <strong>{option.title}</strong>
        <small>{option.description}</small>
      </span>
    </label>
  )
}

function SmartRecommendationPanel({ recommendations, onApply }) {
  return (
    <details className="smart-recommendation-panel">
      <summary className="smart-recommendation-head">
        <div>
          <span>Smart Recommendations</span>
          <h2>{recommendations.length} suggested cleaning rule(s)</h2>
          <p>Open only when you want ATLAS to preselect likely rules.</p>
        </div>
        <em>Open</em>
      </summary>

      <div className="smart-recommendation-body">
        <button
          type="button"
          className="primary-button smart-recommendation-apply"
          onClick={onApply}
          disabled={recommendations.length === 0}
          title="Apply recommendations"
          aria-label="Apply recommendations"
        >
          <IconButtonContent icon="spark" label="Apply recommendations" showLabel />
        </button>

        {recommendations.length > 0 ? (
          <div className="smart-recommendation-grid">
            {recommendations.map((recommendation) => (
              <article key={recommendation.id} className="smart-recommendation-card">
                <div>
                  <strong>{recommendation.title}</strong>
                  <span>{recommendation.reason}</span>
                </div>
                <small>{recommendation.impact}</small>
                <em>{recommendation.confidence}% confidence</em>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state-inline">No high-confidence recommendation is needed for the current profile.</p>
        )}
      </div>
    </details>
  )
}

function QualityScoreCard({ title, report, muted = false }) {
  return (
    <article className={muted ? 'quality-score-card quality-score-card--muted' : 'quality-score-card'}>
      <div className="quality-score-card__head">
        <div>
          <span>{title}</span>
          <strong>{formatPercent(report.score, 1)}</strong>
        </div>
        <em>{report.score >= 90 ? 'Ready' : report.score >= 75 ? 'Review' : 'Needs cleaning'}</em>
      </div>

      <div className="quality-dimension-list">
        {report.dimensions.map((dimension) => (
          <div key={`${title}-${dimension.label}`} className="quality-dimension-row">
            <div>
              <span>{dimension.label}</span>
              <small>{dimension.detail}</small>
            </div>
            <strong>{formatPercent(dimension.score, 0)}</strong>
          </div>
        ))}
      </div>
    </article>
  )
}

function CleaningPage() {
  const [cleaningOptions, setCleaningOptions] = useState(DEFAULT_CLEANING_OPTIONS)
  const [criticalKeywordsText, setCriticalKeywordsText] = useState('id,email')
  const [requiredKeywordsText, setRequiredKeywordsText] = useState('')
  const [requiredDropThreshold, setRequiredDropThreshold] = useState('')

  const {
    datasetId,
    fileName,
    uploadedDataset,
    rawProfile,
    cleanedProfile,
    cleaningSummary,
    comparison,
    busyAction,
    errorMessage,
    runAutoClean,
    downloadDataset,
  } = useAtlas()

  function updateCleaningOption(key, value) {
    setCleaningOptions((currentOptions) => ({
      ...currentOptions,
      [key]: value,
    }))
  }

  function resetCleaningOptions() {
    setCleaningOptions(DEFAULT_CLEANING_OPTIONS)
    setCriticalKeywordsText('id,email')
    setRequiredKeywordsText('')
    setRequiredDropThreshold('')
  }

  function buildCleaningPayload() {
    return {
      ...cleaningOptions,
      critical_keywords: parseKeywordList(criticalKeywordsText),
      required_keywords: parseKeywordList(requiredKeywordsText),
      required_missing_drop_threshold: requiredDropThreshold
        ? Number(requiredDropThreshold)
        : null,
    }
  }

  function handleRunCleaning() {
    runAutoClean(buildCleaningPayload())
  }

  if (!datasetId || !rawProfile) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel">
          <h2>No dataset available</h2>
          <p>Upload and save a dataset first before running the cleaning pipeline.</p>
          <Link to="/dataset" className="action-button">
            Go to Upload
          </Link>
        </section>
      </div>
    )
  }

  const auditLog = cleaningSummary?.audit_log ?? {}
  const rowsDropped = cleaningSummary?.rows_dropped ?? auditLog.rows_dropped ?? {}
  const flaggedRows = cleaningSummary?.flagged_rows ?? auditLog.flagged_rows ?? {}
  const filledNumeric = cleaningSummary?.filled_numeric_values ?? auditLog.filled_numeric_values ?? {}
  const filledText = cleaningSummary?.filled_text_values ?? auditLog.filled_text_values ?? {}
  const hasCleaned = Boolean(cleanedProfile)
  const rawRowsForScoring = hasCleaned ? [] : uploadedDataset.rows
  const cleanedRowsForScoring = hasCleaned ? uploadedDataset.rows : []
  const rawQualityReport = buildQualityReport(rawProfile, rawRowsForScoring, {
    duplicateRows: cleaningSummary?.duplicates_removed,
  })
  const cleanedQualityReport = buildQualityReport(cleanedProfile ?? rawProfile, cleanedRowsForScoring)
  const recommendationReport = buildCleaningRecommendations(rawProfile, rawRowsForScoring)
  const todayLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  function applySmartRecommendations() {
    setCleaningOptions((currentOptions) => ({
      ...currentOptions,
      ...recommendationReport.recommendedOptions,
      fill_text_with_mode: false,
    }))
    setCriticalKeywordsText(recommendationReport.criticalKeywords || 'id,email')
    setRequiredKeywordsText(recommendationReport.requiredKeywords)
  }

  return (
    <div className="cleaning-workbench">
      <header className="cleaning-toolbar">
        <div>
          <span>Clean</span>
          <strong>{fileName || datasetId}</strong>
        </div>

        <div className="cleaning-toolbar__actions">
          <Link to="/profiling" className="ghost-button icon-only-button" title="Back to profile" aria-label="Back to profile">
            <IconButtonContent icon="back" label="Back to profile" />
          </Link>
          <button
            type="button"
            className="ghost-button icon-only-button"
            onClick={() => downloadDataset({ stage: 'cleaned' })}
            disabled={!hasCleaned || busyAction === 'exporting'}
            title={busyAction === 'exporting' ? 'Exporting' : 'Download cleaned CSV'}
            aria-label={busyAction === 'exporting' ? 'Exporting' : 'Download cleaned CSV'}
          >
            <IconButtonContent icon="download" label={busyAction === 'exporting' ? 'Exporting' : 'Download cleaned CSV'} />
          </button>
          <Link to="/analysis" className={hasCleaned ? 'ghost-button icon-only-button' : 'ghost-button icon-only-button disabled-link'} title="Analyze" aria-label="Analyze">
            <IconButtonContent icon="analyze" label="Analyze" />
          </Link>
          <Link to="/visualization" className={hasCleaned ? 'ghost-button icon-only-button' : 'ghost-button icon-only-button disabled-link'} title="Visualize" aria-label="Visualize">
            <IconButtonContent icon="visualize" label="Visualize" />
          </Link>
        </div>

        <div className="cleaning-toolbar__right">
          <span className="cleaning-toolbar__date">
            <IconButtonContent icon="calendar" label={todayLabel} showLabel />
          </span>
          <button
            type="button"
            className="primary-button icon-only-button"
            onClick={handleRunCleaning}
            disabled={busyAction === 'cleaning'}
            title={busyAction === 'cleaning' ? 'Cleaning' : hasCleaned ? 'Clean all again' : 'Clean all'}
            aria-label={busyAction === 'cleaning' ? 'Cleaning' : hasCleaned ? 'Clean all again' : 'Clean all'}
          >
            <IconButtonContent icon="spark" label={busyAction === 'cleaning' ? 'Cleaning' : 'Clean all'} />
          </button>
        </div>
      </header>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <SmartRecommendationPanel
        recommendations={recommendationReport.recommendations}
        onApply={applySmartRecommendations}
      />

      <section className="cleaning-controls-panel">
        <div className="cleaning-controls-head">
          <div>
            <h2>Cleaning Controls</h2>
            <p>Select the rules to apply, then run the cleaning pipeline.</p>
          </div>
          <button type="button" className="ghost-button icon-only-button" onClick={resetCleaningOptions} title="Reset rules" aria-label="Reset rules">
            <IconButtonContent icon="reset" label="Reset rules" />
          </button>
        </div>

        <div className="cleaning-options-grid">
          {CLEANING_OPTIONS.map((option) => (
            <CleaningOptionToggle
              key={option.key}
              option={option}
              checked={Boolean(cleaningOptions[option.key])}
              onChange={updateCleaningOption}
            />
          ))}
        </div>

        <div className="cleaning-keyword-grid">
          <label>
            <span>Critical keywords</span>
            <input
              type="text"
              value={criticalKeywordsText}
              onChange={(event) => setCriticalKeywordsText(event.target.value)}
              placeholder="id,email"
            />
          </label>
          <label>
            <span>Required-field keywords</span>
            <input
              type="text"
              value={requiredKeywordsText}
              onChange={(event) => setRequiredKeywordsText(event.target.value)}
              placeholder="customer_name,status"
            />
          </label>
          <label>
            <span>Required drop rule</span>
            <select
              value={requiredDropThreshold}
              onChange={(event) => setRequiredDropThreshold(event.target.value)}
            >
              <option value="">Flag only</option>
              <option value="0.5">Drop over 50% missing</option>
              <option value="1">Drop fully missing</option>
            </select>
          </label>
        </div>
      </section>

      <section className="quality-score-comparison quality-score-comparison--single">
        <QualityScoreCard
          title={hasCleaned ? 'Cleaned Quality Score' : 'Current Quality Score'}
          report={hasCleaned ? cleanedQualityReport : rawQualityReport}
        />
      </section>

      <section className="cleaning-summary-strip">
        <CleaningMetric label="Nulls Normalized" value={cleaningSummary?.nulls_normalized ?? 0} hint="Explicit placeholders only" />
        <CleaningMetric label="Rows Dropped" value={rowsDropped.total ?? 0} hint="Critical or invalid rows" />
        <CleaningMetric label="Duplicates Removed" value={cleaningSummary?.duplicates_removed ?? 0} hint="Full-row duplicates only" />
        <CleaningMetric label="Flagged Rows" value={flaggedRows.total ?? 0} hint="Kept for review" />
        <CleaningMetric label="Numeric Filled" value={filledNumeric.total ?? 0} hint="Mean or median" />
        <CleaningMetric label="Text Filled" value={filledText.total ?? 0} hint="Off by default" />
      </section>

      <section className="cleaning-tab-shell">
        <div className="cleaning-tabs" role="tablist" aria-label="Cleaning views">
          <button
            type="button"
            className="cleaning-tab cleaning-tab--active"
            role="tab"
            aria-selected="true"
          >
            Original vs Cleaned Dataset
          </button>
        </div>

        <section className="cleaning-comparison-area">
          <ComparisonTable comparison={comparison} />
        </section>
      </section>
    </div>
  )
}

export default CleaningPage
