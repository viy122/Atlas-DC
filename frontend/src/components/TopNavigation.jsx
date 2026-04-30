import { NavLink } from 'react-router-dom'
import { useAtlas } from '../context/AtlasContext'

const LINKS = [
  { to: '/dataset', label: 'Upload' },
  { to: '/profiling', label: 'Profile' },
  { to: '/cleaning', label: 'Clean' },
  { to: '/analysis', label: 'Analyze' },
  { to: '/visualization', label: 'Visualize' },
  { to: '/reports', label: 'Docs' },
]

function TopNavigation() {
  const { fileName } = useAtlas()

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <NavLink to="/dataset" className="top-nav__brand">
          ATLAS
        </NavLink>

        <nav className="top-nav__links" aria-label="Workflow">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? 'top-nav__link top-nav__link--active' : 'top-nav__link'
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="top-nav__dataset" title={fileName || 'No active dataset'}>
          {fileName || 'No dataset'}
        </div>
      </div>
    </header>
  )
}

export default TopNavigation
