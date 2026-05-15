import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { IconButtonContent } from '../components/AtlasBrand'
import { CompactMetric, DatasetPill } from '../components/CompactUI'
import { useAtlas } from '../context/AtlasContext'
import { formatDataType, formatPercent, formatValue, totalMissing } from '../utils/formatters'

function ProfileMetric({ label, value, hint }) {
  return <CompactMetric icon="profile" label={label} value={formatValue(value)} hint={hint} />
}

function TypeChip({ type }) {
  return <span className={`compact-type-chip compact-type-chip--${String(type).toLowerCase()}`}>{type}</span>
}

function formatStatValue(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 'Not available'
  }

  return formatValue(Number(numericValue.toFixed(2)))
}

function ProfilingPage() {
  const { datasetId, rawProfile, fileName, markWorkflowStep } = useAtlas()

  const profileSummary = useMemo(() => {
    const columnProfiles = rawProfile?.column_profiles ?? []
    const typeCounts = { NUMBER: 0, STRING: 0, BOOLEAN: 0, DATETIME: 0 }

    for (const column of columnProfiles) {
      const type = formatDataType(column.dtype, column.semantic_type)
      typeCounts[type] = (typeCounts[type] ?? 0) + 1
    }

    const missingColumns = columnProfiles.filter((column) => column.missing_values > 0)
    const riskiestColumn = [...columnProfiles].sort(
      (left, right) => (right.missing_values ?? 0) - (left.missing_values ?? 0),
    )[0]

    return {
      typeCounts,
      missingColumns,
      riskiestColumn,
      totalMissingCells: totalMissing(columnProfiles),
    }
  }, [rawProfile])

  if (!datasetId || !rawProfile) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel" data-tour="column-diagnostics">
          <h2>No dataset uploaded yet</h2>
          <p>Upload a dataset first, then return here for profiling details.</p>
          <Link to="/dataset" className="action-button">
            Go to Upload
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="profile-workbench">
      <header className="profile-toolbar">
        <div>
          <span>Profile</span>
          <DatasetPill name={fileName || datasetId} />
        </div>

        <div className="profile-toolbar__actions">
          <Link to="/dataset" className="ghost-button" title="Back to upload">
            <IconButtonContent icon="back" label="Back" showLabel />
          </Link>
          <Link
            to="/cleaning"
            className="primary-button profile-continue-button"
            onClick={() => markWorkflowStep('profiled')}
            title="Continue to clean"
          >
            <IconButtonContent icon="clean" label="Continue to Clean" showLabel />
          </Link>
        </div>
      </header>

      <section className="profile-summary-strip">
        <ProfileMetric label="Rows" value={rawProfile.rows} hint="Raw records" />
        <ProfileMetric label="Columns" value={rawProfile.columns_count} hint="Detected fields" />
        <ProfileMetric
          label="Missing Cells"
          value={profileSummary.totalMissingCells}
          hint="Null or blank values"
        />
        <ProfileMetric
          label="Columns With Missing"
          value={profileSummary.missingColumns.length}
          hint="Cleaning targets"
        />
      </section>

      <section className="profile-layout">
        <main className="profile-table-panel" data-tour="column-diagnostics">
          <div className="profile-panel-head">
            <div>
              <h2>Column Diagnostics</h2>
              <p>Data type, completeness, and uniqueness per field.</p>
            </div>
          </div>

          <div className="profile-table-scroll">
            <table className="profile-diagnostics-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Missing</th>
                  <th>Missing %</th>
                  <th>Unique</th>
                  <th>Non-null</th>
                </tr>
              </thead>
              <tbody>
                {rawProfile.column_profiles.map((column) => (
                  <tr key={`profile-${column.name}`}>
                    <td>
                      <strong>{column.name}</strong>
                    </td>
                    <td><TypeChip type={formatDataType(column.dtype, column.semantic_type)} /></td>
                    <td>{formatValue(column.missing_values)}</td>
                    <td>
                      <div className="profile-missing-cell">
                        <span>{formatPercent(column.missing_percent ?? 0, 1)}</span>
                        <div className="profile-missing-bar">
                          <div
                            style={{
                              width: `${Math.min(Number(column.missing_percent ?? 0), 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>{column.unique_values ?? '-'}</td>
                    <td>{formatValue(column.non_null_values)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>

        <aside className="profile-side-panel">
          <section className="profile-side-section">
            <h3>Detected Types</h3>
            <div className="profile-type-list">
              {Object.entries(profileSummary.typeCounts).map(([type, count]) => (
                <div key={type}>
                  <TypeChip type={type} />
                  <strong>{formatValue(count)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="profile-side-section">
            <h3>Quality Focus</h3>
            <div className="profile-note">
              <span>{profileSummary.totalMissingCells > 0 ? 'Highest missing' : 'No missing values detected'}</span>
              <strong>
                {profileSummary.totalMissingCells > 0
                  ? profileSummary.riskiestColumn?.name ?? '-'
                  : 'All columns complete'}
              </strong>
              <small>
                {profileSummary.totalMissingCells > 0 && profileSummary.riskiestColumn
                  ? `${profileSummary.riskiestColumn.missing_values} missing values`
                  : 'All columns are currently complete.'}
              </small>
            </div>
          </section>

          <section className="profile-side-section">
            <h3>Basic Statistics</h3>
            {rawProfile.basic_statistics?.length > 0 ? (
              <div className="profile-stat-list">
                {rawProfile.basic_statistics.slice(0, 5).map((stat) => (
                  <article key={`stat-${stat.column}`}>
                    <strong>{stat.column}</strong>
                    <div className="profile-stat-metrics">
                      <span>
                        <em>Sum</em>
                        {formatStatValue(stat.sum)}
                      </span>
                      <span>
                        <em>Average</em>
                        {formatStatValue(stat.mean)}
                      </span>
                      <span>
                        <em>Middle</em>
                        {formatStatValue(stat.median)}
                      </span>
                      <span>
                        <em>Range</em>
                        {formatStatValue(stat.min)} to {formatStatValue(stat.max)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state-inline">No numeric columns detected yet.</p>
            )}
          </section>
        </aside>
      </section>
    </div>
  )
}

export default ProfilingPage
