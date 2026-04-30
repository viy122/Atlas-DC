import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatDateTime } from '../utils/formatters'

const EXPORT_OPTIONS = [
  {
    title: 'Feature Guide',
    text: 'Upload, profile, clean, compare, analyze, and visualize tabular datasets in one workflow.',
  },
  {
    title: 'Cleaning Methods',
    text: 'Documents duplicate removal, missing-value handling, type conversion, and format standardization.',
  },
  {
    title: 'Sample Dataset',
    text: 'A CSV file with missing values, duplicates, inconsistent casing, and numeric text for testing.',
  },
]

function ReportsPage() {
  const { datasetId, fileName, datasetMeta, activeProfile, charts } = useAtlas()

  if (!datasetId) {
    return (
      <div className="page-grid">
        <section className="surface-card empty-panel">
          <h1>No report source available</h1>
          <p>Upload a dataset first so ATLAS can prepare report assets and sharing options.</p>
          <Link to="/dataset" className="primary-button">
            Go to Dataset
          </Link>
        </section>
      </div>
    )
  }

  const shareLink = `https://atlas.app/report/${datasetId.slice(0, 8)}`

  return (
    <div className="page-grid">
      <section className="page-header">
        <div>
          <h1>Documentation</h1>
          <p>Feature notes, cleaning methods, screenshot checklist, and sample data for the final report.</p>
        </div>
      </section>

      <section className="reports-layout">
        <div className="surface-card">
          <div className="card-header">
            <div>
              <h2>Project Documentation</h2>
              <p>Use this page as the in-app reference for the required system documentation.</p>
            </div>
          </div>

          <div className="export-grid">
            {EXPORT_OPTIONS.map((option) => (
              <article key={option.title} className="export-card">
                <div className="export-card__icon">{option.title.slice(0, 2).toUpperCase()}</div>
                <h3>{option.title}</h3>
                <p>{option.text}</p>
              </article>
            ))}
          </div>

          <div className="report-preview-card">
            <strong>Preview: {fileName}</strong>
            <span>Generated {formatDateTime(datasetMeta.uploadedAt)}</span>
            <p>
              {activeProfile?.rows ?? 0} rows - {activeProfile?.columns_count ?? 0} columns -{' '}
              {charts ? 'Dashboard visuals ready' : 'Waiting for dashboard generation'}
            </p>
            <a className="primary-button" href="/sample_sales_dataset.csv" download>
              Download Sample CSV
            </a>
          </div>
        </div>

        <div className="reports-side-stack">
          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>Screenshot Checklist</h2>
                <p>Capture these screens after loading the sample dataset.</p>
              </div>
            </div>

            <div className="access-list">
              <div className="access-list__row">
                <div>
                  <strong>Upload</strong>
                  <span>Raw dataset preview after import</span>
                </div>
                <em>01</em>
              </div>
              <div className="access-list__row">
                <div>
                  <strong>Profile</strong>
                  <span>Rows, columns, types, and missing values</span>
                </div>
                <em>02</em>
              </div>
              <div className="access-list__row">
                <div>
                  <strong>Clean & Compare</strong>
                  <span>Transformation summary and highlighted changes</span>
                </div>
                <em>03</em>
              </div>
              <div className="access-list__row">
                <div>
                  <strong>Visualize</strong>
                  <span>User-selected bar, line, or pie chart</span>
                </div>
                <em>04</em>
              </div>
            </div>
          </section>

          <section className="surface-card security-card">
            <h2>Report Link</h2>
            <p>
              Use this identifier when referring to the current backend session in screenshots:
            </p>
            <strong>{shareLink}</strong>
          </section>
        </div>
      </section>
    </div>
  )
}

export default ReportsPage
