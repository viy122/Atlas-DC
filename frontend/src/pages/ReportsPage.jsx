import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'
import { formatDateTime } from '../utils/formatters'

const EXPORT_OPTIONS = [
  {
    title: 'Executive PDF',
    text: 'High-resolution dashboard export optimized for stakeholders and presentation decks.',
  },
  {
    title: 'Excel Report',
    text: 'Structured workbook with the active dataset, summary metrics, and reusable table views.',
  },
  {
    title: 'Raw CSV',
    text: 'Flat data extract for external tools, backup snapshots, or secondary processing.',
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
          <h1>Reports & Sharing</h1>
          <p>Export, schedule, and share ATLAS outputs with your stakeholders.</p>
        </div>
      </section>

      <section className="reports-layout">
        <div className="surface-card">
          <div className="card-header">
            <div>
              <h2>Export Assets</h2>
              <p>Ready-made outputs generated from the active dataset workspace.</p>
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
          </div>
        </div>

        <div className="reports-side-stack">
          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>Share Access</h2>
                <p>Distribute read-only or collaborative report links.</p>
              </div>
            </div>

            <div className="config-group">
              <label htmlFor="share-link">Shareable Link</label>
              <div className="share-link-row">
                <input id="share-link" type="text" value={shareLink} readOnly />
                <button type="button" className="ghost-button">
                  Copy
                </button>
              </div>
            </div>

            <div className="config-group">
              <label htmlFor="invite-email">Invite Stakeholders</label>
              <div className="share-link-row">
                <input id="invite-email" type="email" placeholder="name@company.com" />
                <button type="button" className="primary-button">
                  Invite
                </button>
              </div>
            </div>

            <div className="access-list">
              <div className="access-list__row">
                <div>
                  <strong>Jane Doe (You)</strong>
                  <span>Owner</span>
                </div>
                <em>Full access</em>
              </div>
              <div className="access-list__row">
                <div>
                  <strong>Marketing Team</strong>
                  <span>5 members</span>
                </div>
                <em>Can view</em>
              </div>
            </div>
          </section>

          <section className="surface-card security-card">
            <h2>Enterprise Security</h2>
            <p>
              Shared links and exported assets inherit the active workspace permissions. Only authorized users can view or download the report outputs.
            </p>
          </section>
        </div>
      </section>
    </div>
  )
}

export default ReportsPage
