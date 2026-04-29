import { Link } from 'react-router-dom'
import DataTable from '../components/DataTable'
import MetricCard from '../components/MetricCard'
import { useAtlas } from '../context/AtlasContext'
import { totalMissing } from '../utils/formatters'

function ProfilingPage() {
  const { datasetId, rawProfile, fileName } = useAtlas()

  if (!datasetId || !rawProfile) {
    return (
      <div className="page-grid">
        <section className="panel empty-panel">
          <h2>No dataset uploaded yet</h2>
          <p>Go to Upload page first, then return here for profiling details.</p>
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
          <p className="page-kicker">Stage 02 / Profiling</p>
          <h2>Understand structure, data types, and completeness before making changes.</h2>
          <p>
            This view keeps the diagnostics close to the preview so you can quickly spot risky
            columns and decide what needs cleaning next.
          </p>

          <div className="page-hero-meta">
            <div className="hero-stat">
              <span>Total rows</span>
              <strong>{rawProfile.rows}</strong>
            </div>
            <div className="hero-stat">
              <span>Total columns</span>
              <strong>{rawProfile.columns_count}</strong>
            </div>
            <div className="hero-stat">
              <span>Missing cells</span>
              <strong>{totalMissing(rawProfile.column_profiles)}</strong>
            </div>
          </div>
        </div>

        <aside className="hero-side-card">
          <div>
            <h3>Profile Focus</h3>
            <p>Check which fields are sparse, which are numeric, and which may need normalization.</p>
          </div>
          <div className="hero-side-list">
            <div className="hero-side-item">
              <span>Dataset</span>
              <strong>{fileName || datasetId}</strong>
            </div>
            <div className="hero-side-item">
              <span>Columns with missing</span>
              <strong>
                {rawProfile.column_profiles.filter((column) => column.missing_values > 0).length}
              </strong>
            </div>
            <div className="hero-side-item">
              <span>Recommended next step</span>
              <strong>Review cleaning rules</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="section-title-row">
          <h3>Dataset Profile</h3>
          <p>{fileName || datasetId}</p>
        </div>

        <div className="metric-grid">
          <MetricCard label="Rows" value={rawProfile.rows} hint="Raw dataset record count." />
          <MetricCard
            label="Columns"
            value={rawProfile.columns_count}
            hint="Distinct fields detected in the file."
          />
          <MetricCard
            label="Columns with Missing"
            value={rawProfile.column_profiles.filter((column) => column.missing_values > 0).length}
            hint="Useful targets for cleaning rules."
          />
          <MetricCard
            label="Missing Cells"
            value={totalMissing(rawProfile.column_profiles)}
            hint="Total null or empty values across the raw data."
          />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Data Type</th>
                <th>Missing Values</th>
                <th>Non-null Values</th>
              </tr>
            </thead>
            <tbody>
              {rawProfile.column_profiles.map((column) => (
                <tr key={`profile-${column.name}`}>
                  <td>{column.name}</td>
                  <td>{column.dtype}</td>
                  <td>{column.missing_values}</td>
                  <td>{column.non_null_values}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DataTable
          title="Profile Preview"
          columns={rawProfile.columns}
          rows={rawProfile.preview}
          emptyMessage="No preview available."
        />

        <div className="page-actions">
          <Link to="/dataset" className="text-link">
            Back to Upload
          </Link>
          <Link to="/dataset" className="action-button secondary">
            Continue to Cleaning
          </Link>
        </div>
      </section>
    </div>
  )
}

export default ProfilingPage
