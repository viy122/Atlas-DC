import { useState } from 'react'
import { Link } from 'react-router-dom'
import ComparisonTable from '../components/ComparisonTable'
import { useAtlas } from '../context/AtlasContext'
import { buildCleaningRecommendations, buildQualityReport } from '../utils/dataQuality'
import { formatPercent, totalMissing } from '../utils/formatters'

const CLEANING_RULES = [
  'Normalize placeholder nulls',
  'Drop rows missing critical IDs/emails',
  'Flag required-field gaps',
  'Fill numeric gaps only by mean/median',
  'Preserve unknown text as null',
  'Flag duplicate primary keys',
  'Validate emails, ranges, and dates',
]

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
    <section className="smart-recommendation-panel">
      <div className="smart-recommendation-head">
        <div>
          <span>Smart Recommendations</span>
          <h2>Suggested cleaning plan</h2>
          <p>ATLAS reads the profile and flags the cleaning rules most likely to improve this dataset.</p>
        </div>
        <button type="button" className="primary-button" onClick={onApply} disabled={recommendations.length === 0}>
          Apply Recommendations
        </button>
      </div>

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
    </section>
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
  const [activeTab, setActiveTab] = useState('audit')
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
  const validationErrors = cleaningSummary?.validation_errors ?? []
  const convertedColumns = cleaningSummary?.converted_columns ?? []
  const cleaningSteps = cleaningSummary?.cleaning_steps ?? auditLog.cleaning_steps ?? []
  const rawMissingTotal = totalMissing(rawProfile.column_profiles ?? [])
  const cleanedMissingTotal = totalMissing(cleanedProfile?.column_profiles ?? [])
  const hasCleaned = Boolean(cleanedProfile)
  const rawRowsForScoring = hasCleaned ? [] : uploadedDataset.rows
  const cleanedRowsForScoring = hasCleaned ? uploadedDataset.rows : []
  const rawQualityReport = buildQualityReport(rawProfile, rawRowsForScoring, {
    duplicateRows: cleaningSummary?.duplicates_removed,
  })
  const cleanedQualityReport = buildQualityReport(cleanedProfile ?? rawProfile, cleanedRowsForScoring)
  const recommendationReport = buildCleaningRecommendations(rawProfile, rawRowsForScoring)

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
          <Link to="/profiling" className="ghost-button">
            Back to Profile
          </Link>
          <button
            type="button"
            className="primary-button"
            onClick={handleRunCleaning}
            disabled={busyAction === 'cleaning'}
          >
            {busyAction === 'cleaning' ? 'Cleaning...' : hasCleaned ? 'Run Again' : 'Run Cleaning'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => downloadDataset({ stage: 'cleaned' })}
            disabled={!hasCleaned || busyAction === 'exporting'}
          >
            {busyAction === 'exporting' ? 'Exporting...' : 'Download Cleaned CSV'}
          </button>
          <Link to="/analysis" className={hasCleaned ? 'ghost-button' : 'ghost-button disabled-link'}>
            Analyze
          </Link>
          <Link to="/visualization" className={hasCleaned ? 'ghost-button' : 'ghost-button disabled-link'}>
            Visualize
          </Link>
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
          <button type="button" className="ghost-button" onClick={resetCleaningOptions}>
            Reset Rules
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

      <section className="quality-score-comparison">
        <QualityScoreCard title="Raw Quality Score" report={rawQualityReport} muted={hasCleaned} />
        <QualityScoreCard
          title={hasCleaned ? 'Cleaned Quality Score' : 'Projected Cleaned Score'}
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
            className={activeTab === 'audit' ? 'cleaning-tab cleaning-tab--active' : 'cleaning-tab'}
            onClick={() => setActiveTab('audit')}
            role="tab"
            aria-selected={activeTab === 'audit'}
          >
            Cleaning Audit
          </button>
          <button
            type="button"
            className={activeTab === 'compare' ? 'cleaning-tab cleaning-tab--active' : 'cleaning-tab'}
            onClick={() => setActiveTab('compare')}
            role="tab"
            aria-selected={activeTab === 'compare'}
          >
            Original vs Cleaned Dataset
          </button>
        </div>

        {activeTab === 'audit' ? (
          <section className="cleaning-layout">
            <main className="cleaning-audit-panel">
              <div className="cleaning-panel-head">
                <div>
                  <h2>Cleaning Audit</h2>
                  <p>{cleaningSummary?.data_integrity_policy ?? 'Unknown human-entered values are preserved as null and flagged instead of guessed.'}</p>
                </div>
              </div>

              <div className="cleaning-audit-grid">
                <article>
                  <span>Missing Before</span>
                  <strong>{rawMissingTotal}</strong>
                </article>
                <article>
                  <span>Missing After</span>
                  <strong>{hasCleaned ? cleanedMissingTotal : '-'}</strong>
                </article>
                <article>
                  <span>Rows Before</span>
                  <strong>{cleaningSummary?.rows_before ?? rawProfile.rows}</strong>
                </article>
                <article>
                  <span>Rows After</span>
                  <strong>{cleaningSummary?.rows_after ?? '-'}</strong>
                </article>
              </div>

              <div className="cleaning-rule-list">
                {CLEANING_RULES.map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>

              <div className="cleaning-decision-list">
                {cleaningSteps.length > 0 ? (
                  cleaningSteps.map((step) => (
                    <article
                      key={step.name}
                      className={
                        step.enabled
                          ? 'cleaning-decision-item'
                          : 'cleaning-decision-item cleaning-decision-item--disabled'
                      }
                    >
                      <div>
                        <strong>{step.name}</strong>
                        <span>{step.rationale}</span>
                      </div>
                      <em>{step.impact_count ?? 0}</em>
                      <small>{step.handling}</small>
                    </article>
                  ))
                ) : (
                  <p className="empty-state-inline">Run cleaning to generate the rule-by-rule decision log.</p>
                )}
              </div>

              <div className="cleaning-audit-table-wrap">
                <table className="cleaning-audit-table">
                  <thead>
                    <tr>
                      <th>Audit Item</th>
                      <th>Result</th>
                      <th>Handling</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Critical missing rows</td>
                      <td>{rowsDropped.critical_missing ?? 0}</td>
                      <td>Dropped</td>
                    </tr>
                    <tr>
                      <td>All-null rows</td>
                      <td>{rowsDropped.all_null ?? 0}</td>
                      <td>Dropped</td>
                    </tr>
                    <tr>
                      <td>Required field gaps</td>
                      <td>{flaggedRows.missing_required ?? 0}</td>
                      <td>Flagged and kept</td>
                    </tr>
                    <tr>
                      <td>Duplicate primary keys</td>
                      <td>{flaggedRows.duplicate_primary_key ?? 0}</td>
                      <td>Flagged, not deleted</td>
                    </tr>
                    <tr>
                      <td>Validation issues</td>
                      <td>{flaggedRows.validation ?? 0}</td>
                      <td>Flagged or nullified</td>
                    </tr>
                    <tr>
                      <td>Converted columns</td>
                      <td>{convertedColumns.length}</td>
                      <td>Datetime/numeric coercion</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </main>

            <aside className="cleaning-side-panel">
              <section>
                <h3>Converted Columns</h3>
                {convertedColumns.length > 0 ? (
                  <div className="cleaning-chip-list">
                    {convertedColumns.map((column) => (
                      <span key={`${column.column}-${column.to_type}`}>
                        {column.column} to {column.to_type}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No conversions yet.</p>
                )}
              </section>

              <section>
                <h3>Validation Errors</h3>
                {validationErrors.length > 0 ? (
                  <div className="cleaning-error-list">
                    {validationErrors.map((error, index) => (
                      <article key={`${error.column}-${error.issue}-${index}`}>
                        <strong>{error.column}</strong>
                        <span>{error.issue}</span>
                        <small>{error.rows} rows</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-inline">No validation errors logged.</p>
                )}
              </section>
            </aside>
          </section>
        ) : (
          <section className="cleaning-comparison-area">
            <ComparisonTable comparison={comparison} />
          </section>
        )}
      </section>
    </div>
  )
}

export default CleaningPage
