import { NavLink } from 'react-router-dom'
import { AtlasIcon, AtlasLogo } from './AtlasBrand'
import { useAtlas } from '../context/AtlasContext'

const MAIN_LINKS = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/dataset', label: 'Upload', icon: 'upload' },
  { to: '/profiling', label: 'Profile', icon: 'profile' },
  { to: '/cleaning', label: 'Clean', icon: 'clean' },
]

const INSIGHT_LINKS = [
  { to: '/analysis', label: 'Analyze', icon: 'analyze' },
  { to: '/visualization', label: 'Visualize', icon: 'visualize' },
]

const ROUTE_REQUIREMENTS = {
  '/profiling': 'uploaded',
  '/cleaning': 'profiled',
  '/analysis': 'cleaned',
  '/visualization': 'analyzed',
}

function applyWorkflowLocks(links, workflow) {
  return links.map((link) => ({
    ...link,
    disabled: ROUTE_REQUIREMENTS[link.to] ? !workflow[ROUTE_REQUIREMENTS[link.to]] : false,
  }))
}

function Sidebar() {
  const { datasetId, fileName, workflow } = useAtlas()
  const completedCount = [
    workflow.uploaded,
    workflow.profiled,
    workflow.cleaned,
    workflow.analyzed,
    workflow.visualized,
  ].filter(Boolean).length

  return (
    <aside className="app-sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand-panel">
        <NavLink to="/" className="sidebar-brand-link" aria-label="ATLAS home">
          <AtlasLogo compact />
          <span className="sidebar-brand-text">ATLAS</span>
        </NavLink>
        <span className="sidebar-collapse-button" aria-hidden="true">
          <AtlasIcon name="chevron-left" />
        </span>
      </div>

      <nav className="sidebar-nav-panel" data-tour="workflow-nav">
        <SidebarSection title="Main" links={applyWorkflowLocks(MAIN_LINKS, workflow)} />
        <SidebarSection title="Insights" links={applyWorkflowLocks(INSIGHT_LINKS, workflow)} />
      </nav>

      <div className="sidebar-status-panel">
        <div className="sidebar-status-ring">
          <span>{completedCount}/5</span>
        </div>
        <div>
          <p className="sidebar-status-title">Workflow</p>
          <p className="sidebar-status-copy">{datasetId ? 'Dataset active' : 'No dataset loaded'}</p>
        </div>
      </div>

      <div className="sidebar-user-panel">
        <span className="sidebar-user-avatar">A</span>
        <div>
          <strong>{fileName || 'ATLAS Workspace'}</strong>
          <span>{datasetId ? 'Backend session ready' : 'Ready to import'}</span>
        </div>
      </div>
    </aside>
  )
}

function SidebarSection({ title, links }) {
  return (
    <section className="sidebar-section">
      <p className="sidebar-section-title">{title}</p>
      <div className="sidebar-nav-list">
        {links.map((link) => {
          const content = (
            <>
              <AtlasIcon name={link.icon} />
              <span>{link.label}</span>
            </>
          )

          if (link.disabled) {
            return (
              <span
                key={link.to}
                className="sidebar-link sidebar-link-disabled"
                aria-disabled="true"
                title="Finish the previous step first"
              >
                {content}
              </span>
            )
          }

          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
            >
              {content}
            </NavLink>
          )
        })}
      </div>
    </section>
  )
}

export default Sidebar
