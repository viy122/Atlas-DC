import { NavLink, useLocation } from 'react-router-dom'
import { AtlasLogo } from './AtlasBrand'
import { useAtlas } from '../context/AtlasContext'

const LINKS = [
  { to: '/dataset', label: 'Upload' },
  { to: '/profiling', label: 'Profile' },
  { to: '/cleaning', label: 'Clean' },
  { to: '/analysis', label: 'Analyze' },
  { to: '/visualization', label: 'Visualize' },
]

function TopNavigation() {
  const { fileName } = useAtlas()
  const location = useLocation()
  const isWelcomePage = location.pathname === '/'

  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <NavLink to="/" className="top-nav__brand">
          <AtlasLogo compact />
          <span className="top-nav__brand-name">ATLAS</span>
        </NavLink>

        {!isWelcomePage ? (
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
        ) : (
          <div className="top-nav__welcome">Enterprise Data Workbench</div>
        )}

        <div className="top-nav__dataset" title={fileName || 'No active dataset'}>
          {fileName || 'No dataset'}
        </div>
      </div>
    </header>
  )
}

export default TopNavigation
