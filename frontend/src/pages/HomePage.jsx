import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'

const ENTRY_STEPS = [
  { label: 'Upload', detail: 'CSV or Excel input' },
  { label: 'Profile', detail: 'Types and missing values' },
  { label: 'Clean', detail: 'Configurable audit rules' },
  { label: 'Analyze', detail: 'Statistics and patterns' },
  { label: 'Visualize', detail: 'Interactive dashboard' },
]

function HomePage() {
  const { workflow, fileName } = useAtlas()

  return (
    <div className="welcome-workbench">
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="welcome-kicker">ATLAS Data Cleaning and Analytics System</span>
          <h1>Welcome. Start cleaning your dataset.</h1>
          <p>
            Prepare raw tabular data, review quality issues, apply explainable cleaning rules,
            and turn the cleaned result into analysis-ready visuals.
          </p>

          <div className="welcome-actions">
            <Link to="/dataset" className="primary-button welcome-start-button">
              Start Cleaning
            </Link>
          </div>
        </div>

        <aside className="welcome-status-panel">
          <span>Current Workspace</span>
          <strong>{fileName || 'No dataset loaded'}</strong>
          <div className="welcome-status-grid">
            <div className={workflow.uploaded ? 'welcome-status-item is-ready' : 'welcome-status-item'}>
              Uploaded
            </div>
            <div className={workflow.cleaned ? 'welcome-status-item is-ready' : 'welcome-status-item'}>
              Cleaned
            </div>
            <div className={workflow.dashboardReady ? 'welcome-status-item is-ready' : 'welcome-status-item'}>
              Dashboard
            </div>
          </div>
        </aside>
      </section>

      <section className="welcome-flow-panel">
        {ENTRY_STEPS.map((step, index) => (
          <article key={step.label} className="welcome-flow-step">
            <em>{String(index + 1).padStart(2, '0')}</em>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </article>
        ))}
      </section>
    </div>
  )
}

export default HomePage
