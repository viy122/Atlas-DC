import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import { DatasetPill } from '../components/CompactUI'
import ComparisonTable from '../components/ComparisonTable'
import { useAtlas } from '../context/AtlasContext'
import { buildCleaningRecommendations, buildQualityReport } from '../utils/dataQuality'
import { formatPercent, formatValue } from '../utils/formatters'

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

const CLEANING_RULE_GROUPS = [
  {
    title: 'Missing Values',
    description: 'Normalize blanks and handle missing critical values.',
    keys: ['normalize_placeholder_nulls', 'fill_numeric_missing', 'fill_text_with_mode', 'drop_critical_missing'],
  },
  {
    title: 'Text Cleaning',
    description: 'Keep category and label text consistent.',
    keys: ['standardize_text'],
  },
  {
    title: 'Type Conversion',
    description: 'Prepare date and numeric fields for analysis.',
    keys: ['convert_datetime_columns', 'convert_numeric_columns'],
  },
  {
    title: 'Duplicate Handling',
    description: 'Remove exact duplicates and flag duplicate keys.',
    keys: ['remove_duplicates', 'flag_duplicate_keys'],
  },
  {
    title: 'Validation Rules',
    description: 'Validate emails, numeric ranges, and future dates.',
    keys: ['validate_emails', 'validate_numeric_ranges', 'validate_future_dates'],
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
      <em>{checked ? 'On' : 'Off'}</em>
    </label>
  )
}

function CleaningRuleGroup({ group, children, defaultOpen = false }) {
  return (
    <details className="cleaning-rule-group" open={defaultOpen}>
      <summary>
        <div>
          <strong>{group.title}</strong>
          <span>{group.description}</span>
        </div>
        <em>{group.keys.length} rules</em>
      </summary>
      <div className="cleaning-rule-group__body">{children}</div>
    </details>
  )
}

function SmartRecommendationPanel({ recommendations }) {
  return (
    <details className="smart-recommendation-panel">
      <summary className="smart-recommendation-head">
        <div>
          <span>Smart Recommendations</span>
          <h2>
            {recommendations.length
              ? `${recommendations.length} suggested cleaning rule(s)`
              : 'Your dataset looks clean'}
          </h2>
          <p>
            {recommendations.length
              ? 'Open only when you want ATLAS to preselect likely rules.'
              : 'You can still review optional rules.'}
          </p>
        </div>
        <em>Open</em>
      </summary>

      <div className="smart-recommendation-body">
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
          <p className="empty-state-inline">Your dataset looks clean. You can still review optional rules.</p>
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
              <div className="quality-progress-bar">
                <div style={{ width: `${Math.min(Math.max(Number(dimension.score) || 0, 0), 100)}%` }} />
              </div>
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
    workflow,
    busyAction,
    errorMessage,
    runAutoClean,
    resetCleaning,
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

  async function handleResetCleaning() {
    await resetCleaning()
    resetCleaningOptions()
  }

  if (!datasetId || !rawProfile) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel" data-tour="cleaning-rules">
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

  return (
    <div className="cleaning-workbench">
      <header className="cleaning-toolbar">
        <div>
          <span>Clean</span>
          <DatasetPill name={fileName || datasetId} />
        </div>

        <div className="cleaning-toolbar__actions">
          <Link to="/profiling" className="ghost-button" title="Back to profile">
            <IconButtonContent icon="back" label="Back" showLabel />
          </Link>
          <button
            type="button"
            className="ghost-button"
            onClick={handleResetCleaning}
            disabled={!hasCleaned || busyAction === 'resetting-cleaning'}
            title={busyAction === 'resetting-cleaning' ? 'Resetting cleaning' : 'Reset cleaned result'}
          >
            <IconButtonContent icon="reset" label={busyAction === 'resetting-cleaning' ? 'Resetting' : 'Reset Cleaning'} showLabel />
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => downloadDataset({ stage: 'cleaned' })}
            disabled={!hasCleaned || busyAction === 'exporting'}
            title={busyAction === 'exporting' ? 'Exporting' : 'Download cleaned CSV'}
          >
            <IconButtonContent icon="download" label={busyAction === 'exporting' ? 'Exporting' : 'Export Cleaned'} showLabel />
          </button>
          <Link to="/analysis" className={hasCleaned ? 'ghost-button' : 'ghost-button disabled-link'} title="Analyze">
            <IconButtonContent icon="analyze" label="Analyze" showLabel />
          </Link>
          <Link to="/visualization" className={workflow.analyzed ? 'ghost-button' : 'ghost-button disabled-link'} title="Visualize">
            <IconButtonContent icon="visualize" label="Visualize" showLabel />
          </Link>
        </div>

        <div className="cleaning-toolbar__right">
          <span className="cleaning-toolbar__date">
            <IconButtonContent icon="calendar" label={todayLabel} showLabel />
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={handleRunCleaning}
            disabled={busyAction === 'cleaning'}
            title={busyAction === 'cleaning' ? 'Cleaning' : hasCleaned ? 'Clean all again' : 'Clean all'}
            data-tour="run-cleaning"
          >
            <IconButtonContent icon="spark" label={busyAction === 'cleaning' ? 'Cleaning' : hasCleaned ? 'Run Again' : 'Run Cleaning'} showLabel />
          </button>
        </div>
      </header>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <SmartRecommendationPanel
        recommendations={recommendationReport.recommendations}
      />

      <section className="cleaning-controls-panel" data-tour="cleaning-rules">
        <div className="cleaning-controls-head">
          <div>
            <h2>Cleaning Controls</h2>
            <p>Select the rules to apply, then run the cleaning pipeline.</p>
          </div>
          <button type="button" className="ghost-button icon-only-button" onClick={resetCleaningOptions} title="Reset rules" aria-label="Reset rules">
            <IconButtonContent icon="reset" label="Reset rules" />
          </button>
        </div>

        <div className="cleaning-rule-group-stack">
          {CLEANING_RULE_GROUPS.map((group, index) => {
            const groupOptions = group.keys
              .map((key) => CLEANING_OPTIONS.find((option) => option.key === key))
              .filter(Boolean)

            return (
              <CleaningRuleGroup key={group.title} group={group} defaultOpen={index === 0}>
                <div className="cleaning-options-grid">
                  {groupOptions.map((option) => (
                    <CleaningOptionToggle
                      key={option.key}
                      option={option}
                      checked={Boolean(cleaningOptions[option.key])}
                      onChange={updateCleaningOption}
                    />
                  ))}
                </div>
              </CleaningRuleGroup>
            )
          })}
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
        <CleaningMetric label="Nulls Normalized" value={formatValue(cleaningSummary?.nulls_normalized ?? 0)} hint="Explicit placeholders only" />
        <CleaningMetric label="Rows Dropped" value={formatValue(rowsDropped.total ?? 0)} hint="Critical or invalid rows" />
        <CleaningMetric label="Duplicates Removed" value={formatValue(cleaningSummary?.duplicates_removed ?? 0)} hint="Full-row duplicates only" />
        <CleaningMetric label="Flagged Rows" value={formatValue(flaggedRows.total ?? 0)} hint="Kept for review" />
        <CleaningMetric label="Numeric Filled" value={formatValue(filledNumeric.total ?? 0)} hint="Mean or median" />
        <CleaningMetric label="Text Filled" value={formatValue(filledText.total ?? 0)} hint="Off by default" />
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
