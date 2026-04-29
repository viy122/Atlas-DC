import { Link } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'

function HomePage() {
  const { workflow } = useAtlas()

  return (
    <div className="page-grid">
      <section className="panel hero-panel">
        <p className="hero-kicker">Simplified Power BI Flow</p>
        <h2>UPLOAD TO CLEAN TO DASHBOARD</h2>
        <p>
          Focus tayo sa practical workflow: automatic cleaning muna, then mabilis na dashboard
          generation using your cleaned data.
        </p>
        <div className="hero-actions">
          <Link to="/dataset" className="action-button">
            Start Data Cleaning
          </Link>
          <Link to="/dashboard-builder" className="action-button secondary">
            Open Dashboard
          </Link>
        </div>
      </section>

      <section className="panel info-grid-panel">
        <article className="info-card">
          <h3>1. Upload</h3>
          <p>Mag-load ng CSV o Excel at makita agad ang preview ng dataset.</p>
        </article>
        <article className="info-card">
          <h3>2. Auto Clean</h3>
          <p>Tanggal duplicates, fill missing values, at auto date conversion.</p>
        </article>
        <article className="info-card">
          <h3>3. Dashboard</h3>
          <p>
            Generate charts and summary metrics para presentable agad tulad ng simple BI view.
          </p>
        </article>
      </section>

      <section className="panel workflow-panel">
        <h3>Current Progress</h3>
        <div className="workflow-pill-row">
          <span className={workflow.uploaded ? 'workflow-pill on' : 'workflow-pill'}>
            Uploaded
          </span>
          <span className={workflow.cleaned ? 'workflow-pill on' : 'workflow-pill'}>
            Cleaned
          </span>
          <span className={workflow.dashboardReady ? 'workflow-pill on' : 'workflow-pill'}>
            Dashboard Ready
          </span>
        </div>
      </section>
    </div>
  )
}

export default HomePage
