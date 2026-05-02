import { NavLink } from 'react-router-dom'
import { AtlasLogo } from './AtlasBrand'
import { useAtlas } from '../context/AtlasContext'

const LINKS = [
  { to: '/dataset', label: 'Upload', step: '01' },
  { to: '/profiling', label: 'Profile', step: '02' },
  { to: '/cleaning', label: 'Clean', step: '03' },
  { to: '/analysis', label: 'Analyze', step: '04' },
  { to: '/visualization', label: 'Visualize', step: '05' },
  { to: '/reports', label: 'Docs', step: '06' },
]

function Sidebar() {
  const { datasetId, fileName, workflow } = useAtlas()

  const workflowItems = [
    { label: 'Uploaded', active: workflow.uploaded },
    { label: 'Profiled', active: workflow.profiled },
    { label: 'Cleaned', active: workflow.cleaned },
    { label: 'Analyzed', active: workflow.analyzed },
    { label: 'Visualized', active: workflow.visualized },
  ]

  return (
    <aside className="app-sidebar">
      <div className="sidebar-panel sidebar-brand-panel">
        <AtlasLogo compact />
        <div>
          <p className="sidebar-eyebrow">ATLAS Workspace</p>
          <h1 className="sidebar-title">Data Cleaning and Analytics</h1>
          <p className="sidebar-copy">
            Calm, focused workspace for uploading, profiling, cleaning, and reading datasets.
          </p>
        </div>
      </div>

      <nav className="sidebar-panel sidebar-nav-panel" aria-label="Primary">
        <p className="sidebar-section-title">Workflow</p>
        <div className="sidebar-nav-list">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
            >
              <span className="sidebar-link-step">{link.step}</span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <section className="sidebar-panel sidebar-status-panel">
        <div className="sidebar-panel-head">
          <p className="sidebar-section-title">Dataset Status</p>
          <span className={datasetId ? 'sidebar-live-dot on' : 'sidebar-live-dot'} />
        </div>

        <div className="sidebar-status-grid">
          {workflowItems.map((item) => (
            <div key={item.label} className={item.active ? 'status-tile on' : 'status-tile'}>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="dataset-card-mini">
          <p className="dataset-card-label">Active Dataset</p>
          <strong>{fileName || 'No file loaded'}</strong>
          <span>{datasetId ? 'Connected to backend session' : 'Upload a file to begin'}</span>
        </div>
      </section>
    </aside>
  )
}

export default Sidebar
