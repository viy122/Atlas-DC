import { useState } from 'react'
import { Link } from 'react-router-dom'
import ComparisonTable from '../components/ComparisonTable'
import { useAtlas } from '../context/AtlasContext'
import { totalMissing } from '../utils/formatters'

const CLEANING_RULES = [
  'Normalize placeholder nulls',
  'Drop rows missing critical IDs/emails',
  'Flag required-field gaps',
  'Fill numeric gaps only by mean/median',
  'Preserve unknown text as null',
  'Flag duplicate primary keys',
  'Validate emails, ranges, and dates',
]

function CleaningMetric({ label, value, hint }) {
  return (
    <article className="cleaning-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function CleaningPage() {
  const [activeTab, setActiveTab] = useState('audit')

  const {
    datasetId,
    fileName,
    rawProfile,
    cleanedProfile,
    cleaningSummary,
    comparison,
    busyAction,
    errorMessage,
    runAutoClean,
    downloadDataset,
  } = useAtlas()

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
  const rawMissingTotal = totalMissing(rawProfile.column_profiles ?? [])
  const cleanedMissingTotal = totalMissing(cleanedProfile?.column_profiles ?? [])
  const hasCleaned = Boolean(cleanedProfile)

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
            onClick={runAutoClean}
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
